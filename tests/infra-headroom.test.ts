import { randomUUID } from "node:crypto";
import { HEAVY_TASK_LIMITS, INFRASTRUCTURE_PRESSURE } from "@godseye/contracts";
import { FoundationEngine } from "@godseye/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { gateAdmission, isProtectiveCommand } from "../packages/core/src/infra-admission.js";
import { classifyPressure, worstPressure } from "../packages/core/src/infra-headroom.js";
import {
  defaultHeavyPolicy,
  heavySlotFree,
  isHeavyCommand,
} from "../packages/core/src/infra-heavy.js";
import {
  closeFixture,
  deferred,
  type FoundationFixture,
  fixturePlan,
  foundationFixture,
} from "./foundations-helpers.js";
import { owner } from "./helpers.js";
import { type InfrastructureFixture, infrastructureFixture } from "./infra-helpers.js";

const STALE_MS = 301_000;
const resource = (
  view: Awaited<ReturnType<InfrastructureFixture["infrastructure"]["headroom"]>>,
  scope: "host" | "pool",
  name: string,
) => {
  const found = view.scopes
    .find((s) => s.scope === scope)
    ?.resources.find((r) => r.resource === name);
  if (!found) throw new Error(`Missing ${scope}/${name}`);
  return found;
};

describe("pressure classification", () => {
  it("T36 uses documented inclusive thresholds and never reports unknown as healthy", () => {
    const { warnUtilization, criticalUtilization } = INFRASTRUCTURE_PRESSURE;
    expect(classifyPressure(100, warnUtilization * 100 - 1, 0)).toBe("ok");
    expect(classifyPressure(100, warnUtilization * 100, 0)).toBe("warn");
    expect(classifyPressure(100, criticalUtilization * 100 - 1, 0)).toBe("warn");
    expect(classifyPressure(100, criticalUtilization * 100, 0)).toBe("critical");
    expect(classifyPressure(100, 90, 20)).toBe("critical");
    expect(classifyPressure(0, 0, 0)).toBe("critical");
    expect(worstPressure(["ok", "unknown"])).toBe("unknown");
    expect(worstPressure(["unknown", "warn", "ok"])).toBe("warn");
    expect(worstPressure([])).toBe("ok");
  });
  it("T05 classifies heavy work and protective commands explicitly", () => {
    const id = randomUUID();
    const hash = "a".repeat(64);
    expect(
      isHeavyCommand({
        kind: "database.recovery",
        intent: "restore",
        manifestRef: id,
        manifestHash: hash,
      }),
    ).toBe(true);
    expect(
      isHeavyCommand({
        kind: "database.recovery",
        intent: "check",
        manifestRef: id,
        manifestHash: hash,
      }),
    ).toBe(false);
    expect(isProtectiveCommand({ kind: "cell.lifecycle", intent: "stop", manifestRef: id })).toBe(
      true,
    );
    expect(
      isProtectiveCommand({ kind: "cell.lifecycle", intent: "provision", manifestRef: id }),
    ).toBe(false);
    expect(isProtectiveCommand({ kind: "agent.cancel", runId: id })).toBe(true);
  });
});

describe("headroom view", () => {
  let fixture: InfrastructureFixture;
  beforeEach(async () => {
    fixture = await infrastructureFixture();
  });
  afterEach(async () => {
    await closeFixture(fixture);
  });

  it("T05 reports committed, free and protected values from observation and reservations", async () => {
    const before = await fixture.infrastructure.headroom(fixture.freshOwner());
    expect(resource(before, "pool", "cpu")).toMatchObject({
      state: "known",
      capacity: 4000,
      committed: 0,
      protectedReserve: 500,
      free: 3500,
      pressure: "ok",
    });
    await fixture.admit();
    const after = await fixture.infrastructure.headroom(fixture.freshOwner());
    expect(resource(after, "pool", "cpu")).toMatchObject({ committed: 500, free: 3000 });
    expect(resource(after, "pool", "memory")).toMatchObject({
      committed: 144,
      free: 8192 - 512 - 144,
    });
    expect(resource(after, "pool", "disk")).toMatchObject({ committed: 2, free: 100 - 10 - 2 });
    expect(resource(after, "pool", "pids")).toMatchObject({ committed: 32 });
    expect(resource(after, "pool", "wal")).toMatchObject({ committed: 0, capacity: 100 });
    expect(resource(after, "host", "cpu")).toMatchObject({
      capacity: 8000,
      committed: 7000,
      protectedReserve: 1000,
      free: 0,
      pressure: "critical",
    });
    expect(after.pressure).toBe("critical");
    expect(after.admission.state).toBe("open");
  });

  it("T36 shows stale evidence as unknown while keeping reservations visible", async () => {
    await fixture.admit();
    fixture.clock.advance(STALE_MS);
    const view = await fixture.infrastructure.headroom(fixture.freshOwner());
    expect(view.observationState).toBe("stale");
    expect(view.pressure).toBe("unknown");
    expect(resource(view, "pool", "cpu")).toMatchObject({
      state: "unknown",
      free: null,
      capacity: null,
      committed: 500,
      pressure: "unknown",
    });
  });

  it("T36 does not treat a development-controller observation as the professional pool", async () => {
    fixture.collector.observation = {
      ...fixture.collector.observation,
      target: "development-controller",
      hostCapacity: null,
      observedAt: fixture.clock.now().toISOString(),
      expiresAt: new Date(fixture.clock.now().getTime() + 60_000).toISOString(),
    };
    await fixture.infrastructure.refreshInventory(
      fixture.freshOwner(),
      { expectedRevision: 1 },
      randomUUID(),
    );
    const view = await fixture.infrastructure.headroom(fixture.freshOwner());
    expect(view.observationState).toBe("observed");
    expect(resource(view, "pool", "cpu")).toMatchObject({ state: "unknown", pressure: "unknown" });
    expect(resource(view, "host", "disk")).toMatchObject({ state: "unknown", free: null });
  });

  it("T05 marks a PID capacity the collector does not measure as unknown", async () => {
    fixture.collector.observation = {
      ...fixture.collector.observation,
      capacity: { ...fixture.collector.observation.capacity, pids: null },
    };
    await fixture.infrastructure.refreshInventory(
      fixture.freshOwner(),
      { expectedRevision: 1 },
      randomUUID(),
    );
    const view = await fixture.infrastructure.headroom(fixture.freshOwner());
    expect(resource(view, "pool", "pids")).toMatchObject({ state: "unknown", free: null });
    expect(resource(view, "pool", "cpu").state).toBe("known");
  });

  it("T05 requires the owner", async () => {
    await expect(
      fixture.infrastructure.headroom({ id: "service", kind: "service", projectIds: [] }),
    ).rejects.toMatchObject({ status: 403 });
  });
});

describe("owner admission pause", () => {
  let fixture: InfrastructureFixture;
  beforeEach(async () => {
    fixture = await infrastructureFixture();
  });
  afterEach(async () => {
    await closeFixture(fixture);
  });

  it("T05 blocks new admission while reads continue and resumes with revision and idempotency protection", async () => {
    const preparation = await fixture.prepare();
    const input = { preparationId: preparation.id, expectedHash: preparation.hash };
    await expect(
      fixture.infrastructure.setAdmission(
        fixture.freshOwner(),
        { expectedRevision: 0, state: "paused" },
        randomUUID(),
      ),
    ).rejects.toBeDefined();
    const key = randomUUID();
    const pause = { expectedRevision: 0, state: "paused" as const, reason: "Disque à vérifier" };
    const paused = await fixture.infrastructure.setAdmission(fixture.freshOwner(), pause, key);
    expect(paused).toMatchObject({ state: "paused", revision: 1, reason: "Disque à vérifier" });
    expect(await fixture.infrastructure.setAdmission(fixture.freshOwner(), pause, key)).toEqual(
      paused,
    );
    await expect(
      fixture.infrastructure.setAdmission(fixture.freshOwner(), pause, randomUUID()),
    ).rejects.toMatchObject({ code: "REVISION_CONFLICT" });

    await expect(
      fixture.infrastructure.admit(fixture.freshOwner(), input, randomUUID()),
    ).rejects.toMatchObject({ code: "ADMISSION_PAUSED", status: 409 });
    const overview = await fixture.infrastructure.overview(fixture.freshOwner());
    expect(overview.executionAvailable).toBe(false);
    expect(overview.executionReasons.join(" ")).toContain("paused");
    expect(overview.allocations).toHaveLength(0);
    expect((await fixture.infrastructure.headroom(fixture.freshOwner())).admission.state).toBe(
      "paused",
    );

    await fixture.infrastructure.setAdmission(
      fixture.freshOwner(),
      { expectedRevision: 1, state: "open" },
      randomUUID(),
    );
    const allocation = await fixture.infrastructure.admit(
      fixture.freshOwner(),
      input,
      randomUUID(),
    );
    expect(allocation.state).toBe("reserved");
  });

  it("T05 lets a paused platform still run queued protective reconciliation work", async () => {
    const { allocation } = await fixture.admit();
    await fixture.infrastructure.setAdmission(
      fixture.freshOwner(),
      { expectedRevision: 0, state: "paused", reason: "Maintenance" },
      randomUUID(),
    );
    // Work admitted before the pause is still consumed and settled; only new intake is held.
    await fixture.infrastructure.foundation.tick("infrastructure-fixture-worker");
    const state = (await fixture.infrastructure.overview(fixture.freshOwner())).allocations.find(
      (row) => row.id === allocation.id,
    );
    expect(state?.state).toBe("verified");
  });
});

describe("bounded heavy-task class in the Foundation queue", () => {
  let fixture: FoundationFixture;
  let engine: FoundationEngine;
  const policy = {
    ...defaultHeavyPolicy(),
    maxConcurrent: HEAVY_TASK_LIMITS.maxConcurrent,
    maxQueued: 1,
    classify: (command: { kind: string }) => command.kind === "deployment.release",
  };
  const plan = (cost: number) => fixturePlan(fixture, { maxCostMicros: cost });
  beforeEach(async () => {
    fixture = await foundationFixture();
    engine = new FoundationEngine(fixture.store, {
      adapters: [fixture.provider.adapter],
      now: fixture.clock.now,
      leaseMs: 60_000,
      admission: (tx, row, runId) => gateAdmission(policy, tx, row.command, runId),
      claimGate: (tx, row, runId) => heavySlotFree(tx, policy, row.command, runId),
    });
  });
  afterEach(async () => {
    await closeFixture(fixture);
  });

  it("T36 refuses past concurrency plus queue depth with a typed error and no leaked reservation", async () => {
    await engine.enqueue(owner, (await plan(10)).id, randomUUID());
    await engine.enqueue(owner, (await plan(11)).id, randomUUID());
    await expect(engine.enqueue(owner, (await plan(12)).id, randomUUID())).rejects.toMatchObject({
      code: "HEAVY_QUEUE_FULL",
      status: 429,
    });
    expect(await engine.listRuns(owner)).toHaveLength(2);
    expect(await engine.getBudget(owner, fixture.project.id)).toMatchObject({ reservedMicros: 21 });
  });

  it("T36 never runs more heavy tasks than the concurrency cap and frees the slot afterwards", async () => {
    const gate = deferred<{ status: "succeeded"; evidenceRef: string; costMicros: number }>();
    fixture.provider.executeWith(() => gate.promise);
    await engine.enqueue(owner, (await plan(10)).id, randomUUID());
    await engine.enqueue(owner, (await plan(11)).id, randomUUID());

    const first = engine.tick("heavy-worker-a");
    await expect.poll(() => fixture.provider.executions.length).toBe(1);
    expect(await engine.tick("heavy-worker-b")).toBe(false);
    expect(fixture.provider.executions).toHaveLength(1);

    gate.resolve({ status: "succeeded", evidenceRef: "fixture:receipt", costMicros: 1 });
    await first;
    fixture.provider.executeWith(async () => ({
      status: "succeeded",
      evidenceRef: "fixture:receipt",
      costMicros: 1,
    }));
    expect(await engine.tick("heavy-worker-b")).toBe(true);
    expect(fixture.provider.executions).toHaveLength(2);
  });
});
