import type { PlatformBuildsView, PlatformBuildView } from "@godseye/contracts";
import { CI_QUEUE_STALL_MS, ciHealthFindings, PlatformBuilds } from "@godseye/core";
import { describe, expect, it } from "vitest";
import { JenkinsClient } from "../apps/control-api/src/delivery/jenkins-client.js";
import { JenkinsPlatformBuildSource } from "../apps/control-api/src/delivery/platform-builds-source.js";

const BASE = "http://10.20.1.10:8080";
const build = (number: number, patch: Partial<PlatformBuildView> = {}): PlatformBuildView => ({
  number,
  result: "SUCCESS",
  building: false,
  startedAt: "2026-11-18T04:40:00.000Z",
  durationMs: 1000,
  branch: null,
  commitSha: null,
  url: `${BASE}/job/x/${number}/`,
  ...patch,
});
const view = (patch: Partial<Extract<PlatformBuildsView, { state: "connected" }>>) =>
  ({
    state: "connected",
    observedAt: "2026-11-18T05:00:00.000Z",
    jobs: [{ name: "godseye-platform", state: "observed", builds: [build(2)] }],
    ...patch,
  }) as PlatformBuildsView;

describe("ciHealthFindings", () => {
  it("raises a critical finding when the latest finished release build failed", () => {
    const result = ciHealthFindings(
      view({
        jobs: [
          {
            name: "godseye-platform",
            state: "observed",
            builds: [build(4, { result: null, building: true }), build(3, { result: "FAILURE" })],
          },
        ],
      }),
    );
    expect(result.findings).toMatchObject([
      { key: "ci:build:godseye-platform", severity: "critical", reason: "CI_BUILD_FAILED" },
    ]);
  });

  it("covers the build key once the latest finished build succeeded", () => {
    const result = ciHealthFindings(view({}));
    expect(result.findings).toEqual([]);
    expect(result.coveredKeys).toContain("ci:build:godseye-platform");
  });

  it("does not clear or raise on an aborted latest build", () => {
    const result = ciHealthFindings(
      view({
        jobs: [
          {
            name: "godseye-platform",
            state: "observed",
            builds: [build(5, { result: "ABORTED" })],
          },
        ],
      }),
    );
    expect(result.findings).toEqual([]);
    expect(result.coveredKeys).not.toContain("ci:build:godseye-platform");
  });

  it("raises a warning for an offline agent and a stalled queue", () => {
    const result = ciHealthFindings(
      view({
        infrastructure: {
          state: "observed",
          agents: [
            { name: "godseye-work", online: false, executors: 2, busy: false, offlineReason: null },
          ],
          queue: { length: 1, stuck: 0, oldestWaitMs: CI_QUEUE_STALL_MS + 1 },
        },
      }),
    );
    expect(result.findings.map((f) => f.key).sort()).toEqual([
      "ci:agent:godseye-work",
      "ci:queue:stalled",
    ]);
  });

  it("reports an unreadable controller and never clears its keys on unavailable evidence", () => {
    const result = ciHealthFindings(
      view({
        jobs: [{ name: "godseye-platform", state: "unavailable", reason: "UNREACHABLE" }],
      }),
    );
    expect(result.findings).toMatchObject([{ key: "ci:jenkins:unreachable" }]);
    expect(result.coveredKeys).toEqual([]);
  });

  it("produces nothing when Jenkins is not connected", () => {
    const result = ciHealthFindings({ state: "not_connected", reason: "NOT_CONFIGURED" });
    expect(result).toEqual({ findings: [], coveredKinds: [], coveredKeys: [] });
  });
});

describe("JenkinsPlatformBuildSource", () => {
  const json = (body: unknown) =>
    new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } });
  const client = (route: (path: string) => unknown) =>
    new JenkinsClient(
      { baseUrl: BASE, user: "reader", apiToken: "token", jobName: "unused" },
      (async (input: RequestInfo | URL) =>
        json(route(decodeURIComponent(String(input))))) as typeof fetch,
    );

  it("reports the workspace checkout, not the pipeline definition, when two revisions exist", async () => {
    const first = "1".repeat(40);
    const last = "a".repeat(40);
    const source = new JenkinsPlatformBuildSource(
      client(() => ({
        builds: [
          {
            number: 7,
            result: "SUCCESS",
            building: false,
            timestamp: 1_794_000_000_000,
            duration: 1000,
            actions: [
              { lastBuiltRevision: { SHA1: first } },
              { lastBuiltRevision: { SHA1: last } },
            ],
          },
        ],
      })),
      BASE,
    );
    const [only] = await source.recentBuilds("godseye-platform-candidate", 1);
    expect(only?.commitSha).toBe(last);
  });

  it("lists agents, hides the executor-less built-in node and summarises the queue", async () => {
    const source = new JenkinsPlatformBuildSource(
      client((path) =>
        path.includes("/computer/")
          ? {
              computer: [
                { displayName: "Built-In Node", offline: false, numExecutors: 0, idle: true },
                {
                  displayName: "godseye-work",
                  offline: true,
                  offlineCauseReason: "Disconnected",
                  numExecutors: 2,
                  idle: true,
                },
              ],
            }
          : { items: [{ stuck: true }, {}] },
      ),
      BASE,
    );
    expect(await source.infrastructure()).toEqual({
      state: "observed",
      agents: [
        {
          name: "godseye-work",
          online: false,
          executors: 2,
          busy: false,
          offlineReason: "Disconnected",
        },
      ],
      queue: { length: 2, stuck: 1, oldestWaitMs: null },
    });
  });

  it("marks infrastructure unavailable in the view when the controller cannot be read", async () => {
    const builds = new PlatformBuilds({
      mode: "server",
      source: {
        recentBuilds: async () => [],
        infrastructure: async () => {
          throw new Error("boom");
        },
      },
    });
    const observed = await builds.observeSystem();
    expect(observed).toMatchObject({
      state: "connected",
      infrastructure: { state: "unavailable", reason: "ERROR" },
    });
  });
});
