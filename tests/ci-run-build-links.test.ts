import type { PlatformBuildView } from "@godseye/contracts";
import { PlatformBuilds, PlatformBuildsError, withBuildLinks } from "@godseye/core";
import { describe, expect, it } from "vitest";
import { JenkinsClient } from "../apps/control-api/src/delivery/jenkins-client.js";
import { JenkinsPlatformBuildSource } from "../apps/control-api/src/delivery/platform-builds-source.js";

const NOW = new Date("2026-11-16T12:00:00.000Z");
const owner = { id: "owner", kind: "owner", projectIds: [] } as const;
const BASE = "http://10.20.1.10:8080";
const SHA_A = "a".repeat(40);
const SHA_B = "b".repeat(40);

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

function linksFor(builds: PlatformBuildView[], origin: string | null = BASE) {
  const source = {
    ...(origin ? { origin } : {}),
    recentBuilds: async (job: string) => (job === "godseye-platform" ? builds : []),
  };
  return new PlatformBuilds({ mode: "server", source, now: () => NOW }).buildLinks(owner);
}

describe("buildLinks", () => {
  it("links a commit to the Jenkins build that reports having built it", async () => {
    const links = await linksFor([build(7, { commitSha: SHA_A })]);

    expect(links.get(SHA_A)).toBe(`${BASE}/job/godseye-platform/7/`);
  });

  it("offers no link for a build that does not report its commit", async () => {
    const links = await linksFor([build(7)]);

    expect(links.size).toBe(0);
  });

  it("refuses a build URL outside the configured Jenkins origin", async () => {
    const links = await linksFor([
      build(7, { commitSha: SHA_A, url: "http://evil.example.org/job/godseye-platform/7/" }),
    ]);

    expect(links.size).toBe(0);
  });

  it("offers no link when the source declares no origin", async () => {
    const links = await linksFor([build(7, { commitSha: SHA_A })], null);

    expect(links.size).toBe(0);
  });

  it("prefers the most recently started build of the same commit", async () => {
    const links = await linksFor([
      build(8, { commitSha: SHA_A, startedAt: "2026-11-16T11:30:00.000Z" }),
      build(9, { commitSha: SHA_A, startedAt: "2026-11-16T11:45:00.000Z" }),
    ]);

    expect(links.get(SHA_A)).toBe(`${BASE}/job/godseye-platform/9/`);
  });

  it("offers no link when Jenkins cannot be read", async () => {
    const builds = new PlatformBuilds({
      mode: "server",
      source: {
        origin: BASE,
        recentBuilds: async () => {
          throw new PlatformBuildsError("UNREACHABLE");
        },
      },
    });

    expect((await builds.buildLinks(owner)).size).toBe(0);
  });
});

describe("withBuildLinks", () => {
  it("fills a missing providerRef but never overwrites a recorded one", () => {
    const links = new Map([
      [SHA_A, `${BASE}/job/godseye-platform/7/`],
      [SHA_B, `${BASE}/job/godseye-platform/8/`],
    ]);
    const runs = [
      { commitSha: SHA_A, providerRef: null },
      { commitSha: SHA_B, providerRef: "https://recorded.example/1" },
      { commitSha: "c".repeat(40), providerRef: null },
    ];

    const refs = withBuildLinks(runs, links).map((run) => run.providerRef);

    expect(refs).toEqual([`${BASE}/job/godseye-platform/7/`, "https://recorded.example/1", null]);
  });
});

describe("Jenkins platform source commit", () => {
  const read = async (sha: string) => {
    const body = {
      builds: [
        {
          number: 3,
          result: "SUCCESS",
          building: false,
          timestamp: 1_790_000_000_000,
          duration: 10,
          actions: [{ lastBuiltRevision: { SHA1: sha } }],
        },
      ],
    };
    const client = new JenkinsClient(
      { baseUrl: BASE, user: "reader", apiToken: "placeholder", jobName: "x" },
      async () => new Response(JSON.stringify(body), { status: 200 }),
    );
    const builds = await new JenkinsPlatformBuildSource(client, BASE).recentBuilds("j", 8);
    return builds[0]?.commitSha;
  };

  it("reads the commit from the git plugin revision", async () => {
    expect(await read(SHA_A)).toBe(SHA_A);
  });

  it("ignores a revision that is not a full SHA-1", async () => {
    expect(await read("not-a-sha")).toBeNull();
  });
});
