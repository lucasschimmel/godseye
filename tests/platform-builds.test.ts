import {
  CONTROL_API_HEADER,
  CONTROL_API_VERSION,
  PlatformBuilds as PlatformBuildsContract,
  type PlatformBuildView,
} from "@godseye/contracts";
import {
  InfrastructureEngine,
  type PlatformBuildSource,
  PlatformBuilds,
  PlatformBuildsError,
} from "@godseye/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../apps/control-api/src/app.js";
import { loadConfiguration } from "../apps/control-api/src/config.js";
import { JenkinsClient } from "../apps/control-api/src/delivery/jenkins-client.js";
import { JenkinsPlatformBuildSource } from "../apps/control-api/src/delivery/platform-builds-source.js";
import { type OwnerAuthFixture, ownerAuthFixture } from "./owner-auth-fixture.js";

const NOW = new Date("2026-11-16T12:00:00.000Z");
const owner = { id: "owner", kind: "owner", projectIds: [] } as const;
const service = { id: "svc", kind: "service", projectIds: [] } as const;
const BASE = "http://10.20.1.10:8080";

const build = (number: number, patch: Partial<PlatformBuildView> = {}): PlatformBuildView => ({
  number,
  result: "SUCCESS",
  building: false,
  startedAt: "2026-11-16T11:00:00.000Z",
  durationMs: 61_000,
  branch: null,
  commitSha: null,
  url: `${BASE}/job/godseye-platform/${number}/`,
  ...patch,
});

describe("PlatformBuilds", () => {
  it("reports an explicit not-connected state in local mode and never calls the source", async () => {
    const source: PlatformBuildSource = {
      recentBuilds: async () => {
        throw new Error("must not be called");
      },
    };
    const view = await new PlatformBuilds({ mode: "local", source }).observe(owner);
    expect(view).toEqual({ state: "not_connected", reason: "LOCAL_MODE" });
  });

  it("reports NOT_CONFIGURED in server mode without a binding", async () => {
    const builds = new PlatformBuilds({ mode: "server" });
    expect(builds.configured).toBe(false);
    expect(await builds.observe(owner)).toEqual({
      state: "not_connected",
      reason: "NOT_CONFIGURED",
    });
  });

  it("lists recent builds per job and isolates one failing job", async () => {
    const source: PlatformBuildSource = {
      recentBuilds: async (job) => {
        if (job === "godseye-platform-candidate") throw new PlatformBuildsError("TIMEOUT");
        return [build(2, { result: null, building: true, durationMs: null }), build(1)];
      },
    };
    const builds = new PlatformBuilds({ mode: "server", source, now: () => NOW });
    expect(builds.configured).toBe(true);
    const view = PlatformBuildsContract.parse(await builds.observe(owner));
    expect(view).toMatchObject({ state: "connected", observedAt: NOW.toISOString() });
    if (view.state !== "connected") throw new Error("expected connected");
    expect(view.jobs[0]).toMatchObject({ name: "godseye-platform", state: "observed" });
    expect(view.jobs[1]).toEqual({
      name: "godseye-platform-candidate",
      state: "unavailable",
      reason: "TIMEOUT",
    });
  });

  it("maps an unclassified source failure to ERROR without leaking its message", async () => {
    const source: PlatformBuildSource = {
      recentBuilds: async () => {
        throw new Error("secret-ish detail");
      },
    };
    const view = await new PlatformBuilds({ mode: "server", source }).observe(owner);
    expect(JSON.stringify(view)).not.toContain("secret-ish");
    expect(view).toMatchObject({ jobs: [{ reason: "ERROR" }, { reason: "ERROR" }] });
  });

  it("refuses a non-owner actor", async () => {
    await expect(new PlatformBuilds({ mode: "server" }).observe(service)).rejects.toMatchObject({
      status: 403,
    });
  });
});

describe("JenkinsPlatformBuildSource", () => {
  const jsonResponse = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  const sourceFor = (request: typeof fetch, timeoutMs = 50) =>
    new JenkinsPlatformBuildSource(
      new JenkinsClient(
        { baseUrl: BASE, user: "reader", apiToken: "placeholder", jobName: "x" },
        request,
      ),
      BASE,
      timeoutMs,
    );

  it("maps builds, reads BRANCH, hides duration while running and requests a bounded window", async () => {
    const requested: string[] = [];
    const source = sourceFor(async (input) => {
      requested.push(String(input));
      return jsonResponse({
        builds: [
          {
            number: 5,
            result: null,
            building: true,
            timestamp: 1_790_000_000_000,
            duration: 0,
            actions: [{ parameters: [{ name: "BRANCH", value: "feat/x" }] }, {}],
          },
          {
            number: 4,
            result: "FAILURE",
            building: false,
            timestamp: 1_789_000_000_000,
            duration: 5_000,
            actions: [],
          },
        ],
      });
    });
    const builds = await source.recentBuilds("godseye-platform-candidate", 8);
    expect(builds[0]).toMatchObject({
      number: 5,
      result: null,
      building: true,
      durationMs: null,
      branch: "feat/x",
      url: `${BASE}/job/godseye-platform-candidate/5/`,
    });
    expect(builds[1]).toMatchObject({ result: "FAILURE", durationMs: 5_000, branch: null });
    expect(requested[0]).toContain("/job/godseye-platform-candidate/api/json?tree=");
    expect(decodeURIComponent(requested[0] ?? "")).toContain("{0,8}");
  });

  it.each([
    [401, "UNAUTHORIZED"],
    [403, "UNAUTHORIZED"],
    [404, "NOT_FOUND"],
    [503, "ERROR"],
  ])("classifies HTTP %i as %s", async (status, reason) => {
    const source = sourceFor(async () => jsonResponse({}, status));
    await expect(source.recentBuilds("j", 8)).rejects.toMatchObject({ reason });
  });

  it("classifies a refused connection as UNREACHABLE", async () => {
    const source = sourceFor(async () => {
      throw new TypeError("fetch failed");
    });
    await expect(source.recentBuilds("j", 8)).rejects.toMatchObject({ reason: "UNREACHABLE" });
  });

  it("classifies a silent controller as TIMEOUT within the short deadline", async () => {
    const source = sourceFor(
      (_input, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
        }),
    );
    await expect(source.recentBuilds("j", 8)).rejects.toMatchObject({ reason: "TIMEOUT" });
  });

  it("classifies a malformed body or unknown result as INVALID", async () => {
    await expect(
      sourceFor(async () => jsonResponse({ nope: true })).recentBuilds("j", 8),
    ).rejects.toMatchObject({ reason: "INVALID" });
    const unknown = jsonResponse({
      builds: [
        { number: 1, result: "WEIRD", building: false, timestamp: 1, duration: 1, actions: [] },
      ],
    });
    await expect(sourceFor(async () => unknown).recentBuilds("j", 8)).rejects.toMatchObject({
      reason: "INVALID",
    });
  });
});

describe("GET /infrastructure/jenkins", () => {
  let fixture: OwnerAuthFixture;
  let headers: Headers;
  const appFor = (platform: PlatformBuilds) =>
    createApp(
      fixture.core,
      loadConfiguration({ GODSEYE_MODE: "local" }),
      fixture.identity,
      undefined,
      undefined,
      new InfrastructureEngine(fixture.store),
      undefined,
      platform,
    );
  const get = (app: ReturnType<typeof createApp>, path: string, h: HeadersInit = headers) =>
    app.request(new URL(`/api/v1${path}`, fixture.origin), { headers: h });
  beforeEach(async () => {
    fixture = await ownerAuthFixture();
    headers = (await fixture.session()).headers;
    headers.set(CONTROL_API_HEADER, CONTROL_API_VERSION);
  });
  afterEach(async () => fixture.close());

  it("serves a contract-valid connected view to the signed-in owner only", async () => {
    const app = appFor(
      new PlatformBuilds({
        mode: "server",
        now: () => NOW,
        source: { recentBuilds: async () => [build(1)] },
      }),
    );
    const response = await get(app, "/infrastructure/jenkins");
    expect(response.status).toBe(200);
    const view = PlatformBuildsContract.parse(await response.json());
    expect(view.state).toBe("connected");
    const anonymous = await get(app, "/infrastructure/jenkins", {
      origin: fixture.origin,
      host: new URL(fixture.origin).host,
    });
    expect(anonymous.status).toBe(401);
  });

  it("answers not_connected in local mode, never fake builds", async () => {
    const response = await get(
      appFor(new PlatformBuilds({ mode: "local" })),
      "/infrastructure/jenkins",
    );
    expect(await response.json()).toEqual({ state: "not_connected", reason: "LOCAL_MODE" });
  });

  it("answers unavailable per job when Jenkins is unreachable", async () => {
    const app = appFor(
      new PlatformBuilds({
        mode: "server",
        source: {
          recentBuilds: async () => {
            throw new PlatformBuildsError("UNREACHABLE");
          },
        },
      }),
    );
    const view = PlatformBuildsContract.parse(
      await (await get(app, "/infrastructure/jenkins")).json(),
    );
    expect(view).toMatchObject({
      state: "connected",
      jobs: [
        { state: "unavailable", reason: "UNREACHABLE" },
        { state: "unavailable", reason: "UNREACHABLE" },
      ],
    });
  });

  it("flips the overview Jenkins capability only when a binding exists", async () => {
    const capability = async (platform: PlatformBuilds) => {
      const overview = (await (await get(appFor(platform), "/overview")).json()) as {
        capabilities: { id: string; status: string }[];
      };
      return overview.capabilities.find((item) => item.id === "jenkins")?.status;
    };
    expect(await capability(new PlatformBuilds({ mode: "local" }))).toBe("unconfigured");
    expect(await capability(new PlatformBuilds({ mode: "server" }))).toBe("unconfigured");
    expect(
      await capability(
        new PlatformBuilds({ mode: "server", source: { recentBuilds: async () => [] } }),
      ),
    ).toBe("configured");
  });
});
