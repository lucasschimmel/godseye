import { createHash } from "node:crypto";
import { assertBuildEvidence } from "@godseye/core";
import { describe, expect, it } from "vitest";
import { JenkinsBuildBackend } from "../apps/control-api/src/delivery/build-backend.js";
import { JenkinsClient } from "../apps/control-api/src/delivery/jenkins-client.js";
import { RegistryClient } from "../apps/control-api/src/delivery/registry-client.js";
import { deliveryLabManifest } from "./delivery-lab-manifest.js";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const manifestBytes = JSON.stringify({
  schemaVersion: 2,
  config: { size: 100 },
  layers: [{ size: 900 }, { size: 24 }],
});
const imageDigest = `sha256:${createHash("sha256").update(manifestBytes).digest("hex")}`;

interface Build {
  number: number;
  result: string | null;
  params: Record<string, string>;
}
/** Minimal stateful Jenkins + registry; `loseSubmitAck` queues the build yet answers 500. */
function lab() {
  const state = {
    queue: [] as Record<string, string>[],
    builds: [] as Build[],
    posts: 0,
    loseSubmitAck: false,
    evidence: undefined as unknown,
    registryHasImage: true,
  };
  const actions = (params: Record<string, string>) => [
    { parameters: Object.entries(params).map(([name, value]) => ({ name, value })) },
  ];
  const request = (async (input: string, init: RequestInit = {}) => {
    const url = new URL(input);
    if (url.hostname === "registry.internal") {
      return state.registryHasImage && url.pathname.endsWith(imageDigest)
        ? new Response(manifestBytes)
        : new Response("", { status: 404 });
    }
    if (url.pathname.endsWith("/buildWithParameters")) {
      state.posts += 1;
      state.queue.push(Object.fromEntries(new URLSearchParams(String(init.body))));
      return new Response("", { status: state.loseSubmitAck ? 500 : 201 });
    }
    if (url.pathname === "/queue/api/json")
      return json({ items: state.queue.map((p, id) => ({ id, actions: actions(p) })) });
    if (url.pathname.endsWith("/artifact/evidence.json")) return json(state.evidence);
    const buildMatch = /\/job\/[^/]+\/(\d+)\/api\/json$/.exec(url.pathname);
    if (buildMatch) {
      const build = state.builds.find((b) => b.number === Number(buildMatch[1]));
      return json({ actions: actions(build?.params ?? {}) });
    }
    if (url.pathname.endsWith("/api/json"))
      return json({
        builds: state.builds.map((b) => ({
          number: b.number,
          building: b.result === null,
          result: b.result,
          actions: actions(b.params),
        })),
      });
    return new Response("", { status: 404 });
  }) as unknown as typeof fetch;
  const jenkins = new JenkinsClient(
    {
      baseUrl: "http://jenkins.internal:8080",
      user: "svc",
      apiToken: "t",
      jobName: "godseye-app-build",
    },
    request,
  );
  const registry = new RegistryClient(
    { baseUrl: "http://registry.internal:5000", repositoryPrefix: "apps" },
    request,
  );
  /** Moves the queued build to a finished state, like an agent picking it up. */
  const run = (result: string) => {
    const params = state.queue.shift() as Record<string, string>;
    state.builds.push({ number: state.builds.length + 1, result, params });
  };
  return { state, jenkins, registry, run };
}
const evidenceFor = (
  checks: string[],
  findings = { critical: 0, high: 0, medium: 0, low: 0, unknown: 0 },
) => ({
  version: 1,
  imageDigest,
  checks: checks.map((name) => ({ name, passed: true })),
  scanner: {
    scannerId: "trivy",
    version: "0.58.0",
    databaseDigest: `sha256:${"e".repeat(64)}`,
    artifactDigest: imageDigest,
    findings,
  },
  migration: { class: "none", hash: "f".repeat(64) },
  builderId: "jenkins:godseye-app-build",
});

describe("Jenkins build backend", () => {
  it("submits once per scope token even when asked repeatedly", async () => {
    const { jenkins, state } = lab();
    const token = "a".repeat(64);
    await Promise.all([jenkins.submit(token, { X: "1" }), jenkins.submit(token, { X: "1" })]);
    await jenkins.submit(token, { X: "1" });
    expect(state.posts).toBe(1);
  });

  it("reconciles a lost submit acknowledgment to the queued build instead of failing", async () => {
    const { jenkins, state } = lab();
    state.loseSubmitAck = true;
    const found = await jenkins.submit("b".repeat(64), {});
    expect(found.state).toBe("queued");
  });

  it("turns a finished build into verified BuildEvidence accepted by the core gate", async () => {
    const { jenkins, registry, state, run } = lab();
    const { manifest, scope } = deliveryLabManifest();
    manifest.maxArtifactMiB = 1;
    state.evidence = evidenceFor(manifest.requiredChecks);
    let polls = 0;
    const backend = new JenkinsBuildBackend(jenkins, registry, {
      sleep: async () => {
        polls += 1;
        run("SUCCESS");
      },
    });
    const evidence = await backend.build(scope, manifest, async () => undefined);
    expect(() => assertBuildEvidence(evidence, scope, manifest)).not.toThrow();
    expect(evidence).toMatchObject({ digest: imageDigest, sizeBytes: 1024, scan: "passed" });
    expect(polls).toBe(1);
    expect(state.posts).toBe(1);
  });

  it("returns null from inspectBuild until a successful build exists, without resubmitting", async () => {
    const { jenkins, registry, state } = lab();
    const { manifest, scope } = deliveryLabManifest();
    const backend = new JenkinsBuildBackend(jenkins, registry);
    expect(await backend.inspectBuild(scope, manifest)).toBeNull();
    expect(state.posts).toBe(0);
  });

  it("rejects evidence whose image is absent from the registry", async () => {
    const { jenkins, registry, state, run } = lab();
    const { manifest, scope } = deliveryLabManifest();
    state.evidence = evidenceFor(manifest.requiredChecks);
    state.registryHasImage = false;
    const backend = new JenkinsBuildBackend(jenkins, registry, {
      sleep: async () => run("SUCCESS"),
    });
    await expect(backend.build(scope, manifest, async () => undefined)).rejects.toThrow(
      "verifiable evidence",
    );
  });

  it("does not accept a build that ran with different parameters than the admitted scope", async () => {
    const { jenkins, registry, state } = lab();
    const { manifest, scope } = deliveryLabManifest();
    const backend = new JenkinsBuildBackend(jenkins, registry);
    const { buildToken } = await import("../apps/control-api/src/delivery/build-backend.js");
    state.evidence = evidenceFor(manifest.requiredChecks);
    state.builds.push({
      number: 1,
      result: "SUCCESS",
      params: { IDEMPOTENCY_TOKEN: buildToken(scope, manifest), SOURCE_COMMIT: "9".repeat(40) },
    });
    expect(await backend.inspectBuild(scope, manifest)).toBeNull();
  });

  it("reports a deadline as an unknown outcome and stops polling", async () => {
    const { jenkins, registry } = lab();
    const { manifest, scope } = deliveryLabManifest();
    let clock = 0;
    const backend = new JenkinsBuildBackend(jenkins, registry, {
      deadlineMs: 1000,
      now: () => clock,
      sleep: async () => {
        clock += 600;
      },
    });
    await expect(backend.build(scope, manifest, async () => undefined)).rejects.toThrow("deadline");
  });
});
