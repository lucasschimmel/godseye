import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { FoundationEngine } from "@godseye/core";
import { openStore, type Store } from "@godseye/store";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  closeFixture,
  FoundationClock,
  type FoundationFixture,
  fixtureAdapter,
  fixturePlan,
  foundationFixture,
} from "./foundations-helpers.js";
import { owner } from "./helpers.js";

describe("leased durable execution", () => {
  let fixture: FoundationFixture;
  beforeEach(async () => {
    fixture = await foundationFixture({ leaseMs: 1000 });
  });
  afterEach(async () => {
    await closeFixture(fixture);
  });

  it("T18 executes a committed intention once through the actual consumer", async () => {
    const plan = await fixturePlan(fixture);
    const run = await fixture.engine.enqueue(owner, plan.id, randomUUID());

    expect(await fixture.engine.tick("consumer-worker")).toBe(true);
    expect(await fixture.engine.tick("consumer-worker")).toBe(false);

    expect(await fixture.engine.getRun(owner, run.id)).toMatchObject({
      status: "succeeded",
      cleanupState: "complete",
    });
    expect(fixture.provider.executions).toHaveLength(1);
    expect(fixture.provider.executions[0]).toMatchObject({
      runId: run.id,
      planId: plan.id,
      projectId: fixture.project.id,
    });
  });

  it("T-AC-08 T23 records a thrown adapter submission as unknown and reconciles evidence without resubmitting", async () => {
    fixture.provider.executeWith(async () => {
      throw new Error("Fixture lost delivery acknowledgement");
    });
    const plan = await fixturePlan(fixture);
    const run = await fixture.engine.enqueue(owner, plan.id, randomUUID());
    await fixture.engine.tick("uncertain-worker");

    expect(await fixture.engine.getRun(owner, run.id)).toMatchObject({ status: "unknown" });
    expect(await fixture.engine.tick("retry-worker")).toBe(false);
    const reconciliationKey = randomUUID();
    const reconciled = await fixture.engine.reconcile(owner, run.id, reconciliationKey);
    const replay = await fixture.engine.reconcile(owner, run.id, reconciliationKey);
    expect(reconciled.status).toBe("succeeded");
    expect(replay.id).toBe(reconciled.id);
    expect(replay.status).toBe("succeeded");
    expect(fixture.provider.reconciliations).toHaveLength(1);
    expect(fixture.provider.executions).toHaveLength(1);
    expect(fixture.provider.reconciliations[0]?.effectKey).toBe(
      fixture.provider.executions[0]?.effectKey,
    );
    expect(await fixture.engine.getBudget(owner, fixture.project.id)).toMatchObject({
      reservedMicros: 0,
      spentMicros: 20,
    });
  });

  it("T23 T26 treats whitespace proof as uncertainty while preserving known cost until a real receipt arrives", async () => {
    fixture.provider.executeWith(async () => ({
      status: "succeeded",
      evidenceRef: "   ",
      costMicros: 20,
    }));
    fixture.provider.reconcileWith(async () => ({
      status: "succeeded",
      evidenceRef: "   ",
      costMicros: 20,
    }));
    const plan = await fixturePlan(fixture);
    const run = await fixture.engine.enqueue(owner, plan.id, randomUUID());

    await fixture.engine.tick("missing-proof-worker");

    expect(await fixture.engine.getRun(owner, run.id)).toMatchObject({ status: "unknown" });
    expect(await fixture.engine.getBudget(owner, fixture.project.id)).toMatchObject({
      reservedMicros: 50,
      spentMicros: 20,
    });
    expect(await fixture.engine.reconcile(owner, run.id, randomUUID())).toMatchObject({
      status: "unknown",
    });
    expect(await fixture.engine.getBudget(owner, fixture.project.id)).toMatchObject({
      reservedMicros: 50,
      spentMicros: 20,
    });
    fixture.provider.reconcileWith(async () => ({
      status: "succeeded",
      evidenceRef: "fixture:verified-proof",
      costMicros: 20,
    }));
    expect(await fixture.engine.reconcile(owner, run.id, randomUUID())).toMatchObject({
      status: "succeeded",
    });
    expect(await fixture.engine.getBudget(owner, fixture.project.id)).toMatchObject({
      reservedMicros: 0,
      spentMicros: 20,
    });
    expect(fixture.provider.executions).toHaveLength(1);
  });

  it("T23 T37 fences a completion after its lease expires and keeps the external result uncertain", async () => {
    const plan = await fixturePlan(fixture);
    const run = await fixture.engine.enqueue(owner, plan.id, randomUUID());
    const context = await fixture.engine.claim("expired-worker");
    if (!context) throw new Error("Execution context fixture missing");
    fixture.clock.advance(1001);
    expect(await fixture.engine.reconcileExpired()).toBe(1);

    await expect(
      fixture.engine.finish(context, {
        status: "succeeded",
        evidenceRef: "fixture:too-late",
        costMicros: 20,
      }),
    ).rejects.toMatchObject({ status: 409 });
    expect(await fixture.engine.getRun(owner, run.id)).toMatchObject({
      status: "unknown",
      cleanupState: "pending",
    });
    expect(await fixture.engine.tick("replacement-worker")).toBe(false);
  });

  it("T23 heartbeats extend the active lease but cannot preserve it forever without another heartbeat", async () => {
    const plan = await fixturePlan(fixture);
    const run = await fixture.engine.enqueue(owner, plan.id, randomUUID());
    const context = await fixture.engine.claim("heartbeat-worker");
    if (!context) throw new Error("Execution context fixture missing");
    fixture.clock.advance(600);
    await fixture.engine.heartbeat(context);
    fixture.clock.advance(500);

    expect(await fixture.engine.reconcileExpired()).toBe(0);
    expect(await fixture.engine.getRun(owner, run.id)).toMatchObject({ status: "running" });
    fixture.clock.advance(501);
    expect(await fixture.engine.reconcileExpired()).toBe(1);
    expect(await fixture.engine.getRun(owner, run.id)).toMatchObject({ status: "unknown" });
  });

  it("T07 fences a prior activation epoch before accepting any late worker completion", async () => {
    const plan = await fixturePlan(fixture);
    const run = await fixture.engine.enqueue(owner, plan.id, randomUUID());
    const context = await fixture.engine.claim("old-cell-worker");
    if (!context) throw new Error("Execution context fixture missing");

    const epoch = await fixture.engine.advanceEpoch(
      fixture.freshOwner(),
      fixture.development.id,
      randomUUID(),
    );

    expect(epoch).toBeGreaterThan(context.epoch);
    await expect(
      fixture.engine.finish(context, {
        status: "succeeded",
        evidenceRef: "fixture:old-cell",
        costMicros: 20,
      }),
    ).rejects.toMatchObject({ status: 409 });
    expect(await fixture.engine.getRun(owner, run.id)).toMatchObject({ status: "unknown" });
    expect(await fixture.engine.tick("new-cell-worker")).toBe(false);
  });

  it("T24 cancels an unclaimed intention without executing an adapter or retaining its budget", async () => {
    const plan = await fixturePlan(fixture);
    const run = await fixture.engine.enqueue(owner, plan.id, randomUUID());

    const cancelled = await fixture.engine.cancel(owner, run.id, randomUUID());

    expect(cancelled).toMatchObject({ status: "cancelled", cleanupState: "complete" });
    expect(await fixture.engine.getBudget(owner, fixture.project.id)).toMatchObject({
      reservedMicros: 0,
      spentMicros: 0,
    });
    expect(await fixture.engine.tick("cancel-check-worker")).toBe(false);
    expect(fixture.provider.executions).toHaveLength(0);
  });
});

describe("consumer restart", () => {
  it("T18 resumes an acknowledged queued intention after reopening persistent storage", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "godseye-foundation-restart-"));
    const absolute = resolve(dataDir);
    if (!absolute.startsWith(`${resolve(tmpdir())}${sep}godseye-foundation-restart-`))
      throw new Error("Unexpected fixture directory");
    let store: Store | undefined;
    try {
      const fixture = await foundationFixture({ dataDir });
      store = fixture.store;
      const plan = await fixturePlan(fixture);
      const run = await fixture.engine.enqueue(owner, plan.id, randomUUID());
      await store.close();
      store = undefined;
      store = await openStore({ dataDir });
      const provider = fixtureAdapter();
      const clock = new FoundationClock();
      const engine = new FoundationEngine(store, { adapters: [provider.adapter], now: clock.now });

      await engine.tick("restarted-worker");

      expect(await engine.getRun(owner, run.id)).toMatchObject({ status: "succeeded" });
      expect(provider.executions).toHaveLength(1);
      expect(await engine.getBudget(owner, fixture.project.id)).toMatchObject({
        reservedMicros: 0,
        spentMicros: 20,
      });
    } finally {
      await store?.close();
      await rm(absolute, { recursive: true, force: true });
    }
  });
});
