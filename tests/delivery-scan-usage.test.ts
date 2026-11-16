import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { assertScanGate } from "../packages/core/src/delivery-scan.js";
import { type DeliveryFixture, deliveryFixture } from "./delivery-helpers.js";

describe("E05.S01 structured scanner evidence and E05.S03 local usage", () => {
  let fixture: DeliveryFixture;
  beforeEach(async () => {
    fixture = await deliveryFixture();
  });
  afterEach(async () => {
    await fixture.store.close();
  });
  const view = () => fixture.infrastructure.delivery.overview(fixture.freshOwner());
  async function attemptBuild(threshold?: "critical" | "high" | "medium" | "low") {
    const policy = await fixture.createPolicy(threshold ? { scanThreshold: threshold } : {}),
      ci = await fixture.push(),
      preparation = await fixture.prepare({ policyId: policy.id, ciRunId: ci.id, intent: "build" }),
      run = await fixture.admit(preparation);
    await fixture.infrastructure.foundation.tick("scan-gate-worker");
    const current = await view();
    return { current, run: current.deployments.find((item) => item.id === run.id) };
  }
  const evidence = (findings: Partial<Record<string, number>>) => ({
    scannerId: "unit",
    version: "1",
    databaseDigest: `sha256:${"d".repeat(64)}` as const,
    artifactDigest: `sha256:${"a".repeat(64)}` as const,
    findings: { critical: 0, high: 0, medium: 0, low: 0, unknown: 0, ...findings },
  });
  it.each([
    ["critical", { critical: 1 }],
    ["high", { high: 1 }],
    ["medium", { medium: 1 }],
    ["low", { low: 1 }],
  ] as const)(
    "T-AC-46 gate throws SCAN_GATE_FAILED for a %s finding at its own threshold",
    (threshold, findings) => {
      expect(() => assertScanGate(evidence(findings), threshold)).toThrow(
        expect.objectContaining({ code: "SCAN_GATE_FAILED" }),
      );
    },
  );
  it("T-AC-46 gate tolerates findings below the threshold", () => {
    expect(() => assertScanGate(evidence({ medium: 5, low: 9 }), "high")).not.toThrow();
  });
  it("T-AC-46 stores scanner id, version, database digest, severity summary and artifact binding", async () => {
    const { current } = await attemptBuild();
    expect(current.artifacts[0]?.scanner).toEqual({
      scannerId: "fixture-scanner",
      version: "1.0.0",
      databaseDigest: `sha256:${"d".repeat(64)}`,
      artifactDigest: current.artifacts[0]?.digest,
      findings: { critical: 0, high: 0, medium: 0, low: 0, unknown: 0 },
    });
  });
  it("T-AC-46 keeps the legacy scan field on the artifact", async () => {
    const { current } = await attemptBuild();
    expect(current.artifacts[0]?.scan).toBe("passed");
  });
  it("T-AC-46 refuses a high finding under the default threshold and stores no artifact", async () => {
    fixture.provider.findings = { critical: 0, high: 1, medium: 0, low: 0, unknown: 0 };
    const { current, run } = await attemptBuild();
    expect(run?.state).toBe("unknown");
    expect(current.artifacts).toEqual([]);
    expect(current.artifacts).toEqual([]);
  });
  it("T-AC-46 accepts the same high finding when the policy threshold is critical", async () => {
    fixture.provider.findings = { critical: 0, high: 1, medium: 0, low: 0, unknown: 0 };
    const { run } = await attemptBuild("critical");
    expect(run?.state).toBe("built");
  });
  it("T-AC-46 refuses a low finding when the policy threshold is low", async () => {
    fixture.provider.findings = { critical: 0, high: 0, medium: 0, low: 2, unknown: 0 };
    const { current, run } = await attemptBuild("low");
    expect(run?.state).toBe("unknown");
    expect(current.artifacts).toEqual([]);
  });
  it("T-AC-46 never treats unclassified findings as success even at the loosest threshold", async () => {
    fixture.provider.findings = { critical: 0, high: 0, medium: 0, low: 0, unknown: 1 };
    const { current, run } = await attemptBuild("critical");
    expect(run?.state).toBe("unknown");
    expect(current.artifacts).toEqual([]);
  });
  it("T-AC-46 refuses scanner evidence bound to another artifact digest", async () => {
    fixture.provider.buildResult = (evidence) => ({
      ...evidence,
      scanner: { ...evidence.scanner, artifactDigest: `sha256:${"a".repeat(64)}` },
    });
    const { current, run } = await attemptBuild();
    expect(run?.state).toBe("unknown");
    expect(current.artifacts).toEqual([]);
  });
  it("T-AC-52 records cpu, memory, disk and duration per run with zero unbilled cost", async () => {
    const policy = await fixture.createPolicy(),
      ci = await fixture.push(),
      built = await fixture.build(policy.id, ci.id);
    await fixture.release(policy.id, ci.id, built.artifact.id);
    const usage = (await view()).usage;
    expect(usage.map((item) => item.intent).sort()).toEqual(["build", "release"]);
    expect(usage[0]).toMatchObject({
      cpuMilliSeconds: 1200,
      peakMemoryMiB: 96,
      diskMiB: 24,
      durationMs: 350,
      costMicros: 0,
      billing: "local-unbilled",
    });
  });
  it("T-AC-52 records usage for an isolated preview environment", async () => {
    const policy = await fixture.createPolicy(),
      ci = await fixture.pull(),
      built = await fixture.build(policy.id, ci.id);
    await fixture.release(policy.id, ci.id, built.artifact.id);
    const current = await view();
    const preview = current.previews[0];
    expect(
      current.usage.filter((item) => item.environmentId === preview?.environmentId),
    ).toHaveLength(2);
  });
  it("T-AC-52 stores no usage when the provider reports none", async () => {
    fixture.provider.usage = undefined;
    const { current } = await attemptBuild();
    expect(current.usage).toEqual([]);
  });
});
