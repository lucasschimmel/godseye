import {
  PLATFORM_BUILD_RESULTS,
  type PlatformBuildUnavailableReason,
  type PlatformBuildView,
} from "@godseye/contracts";
import { type PlatformBuildSource, PlatformBuildsError } from "@godseye/core";
import { z } from "zod";
import { readPrivateJson, readPrivateText } from "../private-json.js";
import { JenkinsClient, JenkinsHttpError, type JenkinsRecentBuild } from "./jenkins-client.js";

/** The owner is waiting on a page: an unreachable controller must fail fast, not hang the panel. */
export const PLATFORM_BUILDS_TIMEOUT_MS = 4_000;
const BRANCH_PARAMETER = "BRANCH";

const Path = z.string().min(1).max(512);
/** Private binding file, same shape conventions as the delivery binding's `jenkins` block. */
const Binding = z
  .object({
    baseUrl: z.string().url().max(256),
    user: z.string().min(1).max(64),
    tokenPath: Path,
  })
  .strict();
const Parameters = z.array(
  z.object({ parameters: z.array(z.object({ name: z.string(), value: z.unknown() })).optional() }),
);

function branchOf(actions: unknown[]): string | null {
  for (const action of actions) {
    const parsed = Parameters.element.safeParse(action);
    const found = parsed.success
      ? parsed.data.parameters?.find((p) => p.name === BRANCH_PARAMETER)
      : undefined;
    if (typeof found?.value === "string" && found.value.length > 0 && found.value.length <= 200)
      return found.value;
  }
  return null;
}

function classify(error: unknown): PlatformBuildUnavailableReason {
  if (error instanceof JenkinsHttpError) {
    if (error.status === 401 || error.status === 403) return "UNAUTHORIZED";
    if (error.status === 404) return "NOT_FOUND";
    return "ERROR";
  }
  if (error instanceof z.ZodError || error instanceof SyntaxError) return "INVALID";
  if (error instanceof DOMException && error.name === "TimeoutError") return "TIMEOUT";
  if (error instanceof Error && error.name === "TimeoutError") return "TIMEOUT";
  if (error instanceof TypeError) return "UNREACHABLE";
  return "ERROR";
}

/** Read-only adapter from the private Jenkins controller to the platform build list. */
export class JenkinsPlatformBuildSource implements PlatformBuildSource {
  constructor(
    private readonly client: JenkinsClient,
    private readonly baseUrl: string,
    private readonly timeoutMs = PLATFORM_BUILDS_TIMEOUT_MS,
  ) {}

  async recentBuilds(job: string, limit: number): Promise<PlatformBuildView[]> {
    try {
      const view = await this.client.recentBuilds(job, limit, this.timeoutMs);
      return view.builds.slice(0, limit).map((build) => this.build(job, build));
    } catch (error) {
      if (error instanceof PlatformBuildsError) throw error;
      throw new PlatformBuildsError(classify(error));
    }
  }

  private build(job: string, build: JenkinsRecentBuild): PlatformBuildView {
    const result = PLATFORM_BUILD_RESULTS.find((value) => value === build.result) ?? null;
    // A finished build whose result this contract does not know must not be shown as running.
    if (!build.building && build.result !== null && result === null)
      throw new PlatformBuildsError("INVALID");
    return {
      number: build.number,
      result,
      building: build.building,
      startedAt: new Date(build.timestamp).toISOString(),
      durationMs: build.building ? null : build.duration,
      branch: branchOf(build.actions),
      url: `${this.baseUrl.replace(/\/+$/, "")}/job/${encodeURIComponent(job)}/${build.number}/`,
    };
  }
}

/**
 * Optional private binding. Without GODSEYE_PLATFORM_JENKINS_BINDING (absolute path to a private
 * JSON file with baseUrl, user and tokenPath) the platform build list stays honestly unconfigured.
 */
export function configuredPlatformBuildSource(
  env: NodeJS.ProcessEnv,
): PlatformBuildSource | undefined {
  if (!env.GODSEYE_PLATFORM_JENKINS_BINDING) return undefined;
  const binding = Binding.parse(readPrivateJson(env.GODSEYE_PLATFORM_JENKINS_BINDING));
  const client = new JenkinsClient({
    baseUrl: binding.baseUrl,
    user: binding.user,
    apiToken: readPrivateText(binding.tokenPath).trim(),
    jobName: "unused-platform-builds-reader",
  });
  return new JenkinsPlatformBuildSource(client, binding.baseUrl);
}
