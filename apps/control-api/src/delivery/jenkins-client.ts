import { z } from "zod";

const RESPONSE_LIMIT_BYTES = 1024 * 1024;
const REQUEST_TIMEOUT_MS = 15000;
/** Recent builds inspected when looking up an idempotency token; older runs are reconciled as absent. */
const BUILD_WINDOW = 100;
const TOKEN_PARAMETER = "IDEMPOTENCY_TOKEN";

export interface JenkinsConfig {
  /** Private controller URL; never a caller-supplied host. */
  baseUrl: string;
  user: string;
  /** Jenkins API token (not a password); API-token Basic auth needs no CSRF crumb. */
  apiToken: string;
  jobName: string;
  evidenceArtifact?: string;
}
export type JenkinsParameters = Readonly<Record<string, string>>;
export type JenkinsBuildState =
  | { state: "absent" }
  | { state: "queued"; queueId: number }
  | { state: "running"; number: number }
  | { state: "finished"; number: number; result: string };

const Parameters = z.array(
  z.object({ parameters: z.array(z.object({ name: z.string(), value: z.unknown() })).optional() }),
);
const hasToken = (actions: unknown, token: string) =>
  Parameters.safeParse(actions).success &&
  (actions as z.infer<typeof Parameters>).some((action) =>
    action.parameters?.some((p) => p.name === TOKEN_PARAMETER && p.value === token),
  );
const JobView = z.object({
  builds: z.array(
    z.object({
      number: z.number().int().positive(),
      building: z.boolean(),
      result: z.string().nullable(),
      actions: z.array(z.unknown()),
    }),
  ),
});
const RecentBuildsView = z.object({
  builds: z.array(
    z.object({
      number: z.number().int().positive(),
      result: z.string().nullable(),
      building: z.boolean(),
      timestamp: z.number().int().nonnegative(),
      duration: z.number().int().nonnegative(),
      actions: z.array(z.unknown()),
    }),
  ),
});
export type JenkinsRecentBuild = z.infer<typeof RecentBuildsView>["builds"][number];
/** A non-success HTTP status from Jenkins, kept distinct so callers can classify it. */
export class JenkinsHttpError extends Error {
  constructor(readonly status: number) {
    super(`Jenkins request failed (${status})`);
    this.name = "JenkinsHttpError";
  }
}
const QueueView = z.object({
  items: z.array(z.object({ id: z.number().int(), actions: z.array(z.unknown()) })),
});

/** Small Jenkins remote-API client with durable idempotency through the token build parameter. */
export class JenkinsClient {
  private readonly inflight = new Map<string, Promise<JenkinsBuildState>>();
  constructor(
    private readonly config: JenkinsConfig,
    private readonly request: typeof fetch = fetch,
  ) {}
  private url(path: string) {
    return `${this.config.baseUrl.replace(/\/+$/, "")}${path}`;
  }
  private async call(path: string, init: RequestInit = {}, timeoutMs = REQUEST_TIMEOUT_MS) {
    const auth = Buffer.from(`${this.config.user}:${this.config.apiToken}`).toString("base64");
    const response = await this.request(this.url(path), {
      ...init,
      redirect: "manual",
      headers: { authorization: `Basic ${auth}`, ...(init.headers ?? {}) },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (response.status >= 300 && response.status < 400 && init.method !== "POST")
      throw new Error("Jenkins unexpectedly redirected");
    return response;
  }
  private async json<T>(path: string, schema: z.ZodType<T>, timeoutMs = REQUEST_TIMEOUT_MS) {
    const response = await this.call(path, { headers: { accept: "application/json" } }, timeoutMs);
    if (!response.ok) throw new JenkinsHttpError(response.status);
    return schema.parse(JSON.parse(await boundedText(response)));
  }
  /** Read-only list of the newest builds of any job on this controller, with a short deadline. */
  async recentBuilds(jobName: string, limit: number, timeoutMs: number) {
    const tree = `builds[number,result,building,timestamp,duration,actions[parameters[name,value]]]{0,${limit}}`;
    return this.json(
      `/job/${encodeURIComponent(jobName)}/api/json?tree=${encodeURIComponent(tree)}`,
      RecentBuildsView,
      timeoutMs,
    );
  }
  private jobPath() {
    return `/job/${encodeURIComponent(this.config.jobName)}`;
  }
  /** Locates the build or queue item that carries `token`, reading no mutable local state. */
  async find(token: string): Promise<JenkinsBuildState> {
    const queue = await this.json(
      "/queue/api/json?tree=items[id,actions[parameters[name,value]]]",
      QueueView,
    );
    const queued = queue.items.find((item) => hasToken(item.actions, token));
    if (queued) return { state: "queued", queueId: queued.id };
    const view = await this.json(
      `${this.jobPath()}/api/json?tree=builds[number,building,result,actions[parameters[name,value]]]{0,${BUILD_WINDOW}}`,
      JobView,
    );
    const build = view.builds.find((candidate) => hasToken(candidate.actions, token));
    if (!build) return { state: "absent" };
    if (build.building || build.result === null) return { state: "running", number: build.number };
    return { state: "finished", number: build.number, result: build.result };
  }
  /** Submits at most one build per token: an existing queue item or build is returned instead. */
  submit(token: string, parameters: JenkinsParameters): Promise<JenkinsBuildState> {
    if (!/^[a-f0-9]{64}$/.test(token)) throw new Error("Jenkins idempotency token is invalid");
    let pending = this.inflight.get(token);
    if (!pending) {
      pending = this.submitOnce(token, parameters).finally(() => this.inflight.delete(token));
      this.inflight.set(token, pending);
    }
    return pending;
  }
  private async submitOnce(token: string, parameters: JenkinsParameters) {
    const existing = await this.find(token);
    if (existing.state !== "absent") return existing;
    const body = new URLSearchParams({ ...parameters, [TOKEN_PARAMETER]: token });
    const response = await this.call(`${this.jobPath()}/buildWithParameters`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
    });
    if (response.status !== 201) {
      // An unacknowledged submit may still have been queued; reconcile before reporting failure.
      const after = await this.find(token).catch(() => ({ state: "absent" }) as const);
      if (after.state !== "absent") return after;
      throw new Error(`Jenkins rejected the build submission (${response.status})`);
    }
    return this.find(token);
  }
  /** Reads the archived evidence document of a finished build. */
  async evidence(number: number): Promise<unknown> {
    const name = this.config.evidenceArtifact ?? "evidence.json";
    const response = await this.call(
      `${this.jobPath()}/${number}/artifact/${encodeURIComponent(name)}`,
    );
    if (!response.ok) throw new Error(`Jenkins evidence is unavailable (${response.status})`);
    return JSON.parse(await boundedText(response));
  }
  /** Parameters the build actually ran with (server-side record, not the agent's own claim). */
  async buildParameters(number: number): Promise<Record<string, string>> {
    const view = await this.json(
      `${this.jobPath()}/${number}/api/json?tree=actions[parameters[name,value]]`,
      z.object({ actions: z.array(z.unknown()) }),
    );
    const out: Record<string, string> = {};
    for (const action of view.actions) {
      const parsed = Parameters.element.safeParse(action);
      for (const p of parsed.success ? (parsed.data.parameters ?? []) : [])
        if (typeof p.value === "string") out[p.name] = p.value;
    }
    return out;
  }
}
async function boundedText(response: Response) {
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Jenkins response body is missing");
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let bytes = 0,
    text = "";
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > RESPONSE_LIMIT_BYTES) {
        await reader.cancel();
        throw new Error("Jenkins response exceeds its limit");
      }
      text += decoder.decode(chunk.value, { stream: true });
    }
    return text + decoder.decode();
  } finally {
    reader.releaseLock();
  }
}
