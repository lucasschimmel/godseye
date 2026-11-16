import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  closeFixture,
  type FoundationFixture,
  fixturePlan,
  foundationFixture,
} from "./foundations-helpers.js";
import { owner } from "./helpers.js";

describe("atomic budget and task authority", () => {
  let fixture: FoundationFixture;
  beforeEach(async () => {
    fixture = await foundationFixture({ budgetMicros: 80 });
  });
  afterEach(async () => {
    await closeFixture(fixture);
  });

  it("T26 admits at most one of two concurrent reservations that exceed the remaining budget", async () => {
    const plans = await Promise.all([fixturePlan(fixture), fixturePlan(fixture)]);

    const results = await Promise.allSettled(
      plans.map((plan) => fixture.engine.enqueue(owner, plan.id, randomUUID())),
    );

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    expect(await fixture.engine.getBudget(owner, fixture.project.id)).toMatchObject({
      limitMicros: 80,
      reservedMicros: 50,
      spentMicros: 0,
    });
  });

  it("T26 settles actual usage once and returns the unused reservation after the consumer succeeds", async () => {
    const plan = await fixturePlan(fixture);
    const run = await fixture.engine.enqueue(owner, plan.id, randomUUID());

    await fixture.engine.tick("budget-worker");
    await fixture.engine.tick("budget-worker");

    expect(await fixture.engine.getRun(owner, run.id)).toMatchObject({ status: "succeeded" });
    expect(await fixture.engine.getBudget(owner, fixture.project.id)).toMatchObject({
      reservedMicros: 0,
      spentMicros: 20,
    });
    expect(fixture.provider.executions).toHaveLength(1);
  });

  it("T24 T26 holds a reservation and reports actual overshoot until definitive reconciliation", async () => {
    fixture.provider.executeWith(async () => ({
      status: "succeeded",
      evidenceRef: "fixture:overshoot",
      costMicros: 70,
    }));
    fixture.provider.reconcileWith(async () => ({
      status: "succeeded",
      evidenceRef: "fixture:overshoot",
      costMicros: 70,
    }));
    const plan = await fixturePlan(fixture);
    const run = await fixture.engine.enqueue(owner, plan.id, randomUUID());
    await fixture.engine.tick("overrun-worker");

    expect(await fixture.engine.getRun(owner, run.id)).toMatchObject({ status: "unknown" });
    expect(await fixture.engine.getBudget(owner, fixture.project.id)).toMatchObject({
      reservedMicros: 50,
      spentMicros: 70,
    });
    fixture.provider.reconcileWith(async () => ({ status: "succeeded", costMicros: 70 }));
    expect(await fixture.engine.reconcile(owner, run.id, randomUUID())).toMatchObject({
      status: "unknown",
    });
    expect(await fixture.engine.getBudget(owner, fixture.project.id)).toMatchObject({
      reservedMicros: 50,
      spentMicros: 70,
    });
    fixture.provider.reconcileWith(async () => ({
      status: "succeeded",
      evidenceRef: "fixture:overshoot",
      costMicros: 70,
    }));
    expect(await fixture.engine.reconcile(owner, run.id, randomUUID())).toMatchObject({
      status: "succeeded",
      errorCode: "BUDGET_OVERRUN",
    });
    expect(await fixture.engine.getBudget(owner, fixture.project.id)).toMatchObject({
      reservedMicros: 0,
      spentMicros: 70,
    });
    expect(fixture.provider.executions).toHaveLength(1);
  });

  it("T-AC-09 T22 binds a grant to the current worker, tool and destination without granting authority by ID alone", async () => {
    const plan = await fixturePlan(fixture);
    await fixture.engine.enqueue(owner, plan.id, randomUUID());
    const context = await fixture.engine.claim("authorized-worker");
    if (!context) throw new Error("Execution context fixture missing");

    for (const request of [
      {
        actorId: "another-worker",
        tool: "fixture.publish",
        destination: "fixture.invalid",
        costMicros: 10,
      },
      {
        actorId: "authorized-worker",
        tool: "shell.root",
        destination: "fixture.invalid",
        costMicros: 10,
      },
      {
        actorId: "authorized-worker",
        tool: "fixture.publish",
        destination: "http://127.0.0.1",
        costMicros: 10,
      },
    ]) {
      await expect(fixture.engine.authorizeGrant(context, request)).rejects.toMatchObject({
        status: 403,
      });
    }
    for (const forged of [
      { ...context, projectId: randomUUID() },
      { ...context, environmentId: randomUUID() },
      { ...context, effectKey: "forged-logical-effect" },
      {
        ...context,
        command: { ...fixture.planInput.command, artifactDigest: `sha256:${"b".repeat(64)}` },
      },
    ]) {
      await expect(
        fixture.engine.authorizeGrant(forged, {
          actorId: "authorized-worker",
          tool: "fixture.publish",
          destination: "fixture.invalid",
          costMicros: 1,
        }),
      ).rejects.toMatchObject({ status: 409 });
    }
    await expect(
      fixture.engine.authorizeGrant(context, {
        actorId: "authorized-worker",
        tool: "fixture.publish",
        destination: "fixture.invalid",
        costMicros: 20,
      }),
    ).resolves.toBeUndefined();
  });

  it("T26 checks cumulative authorized usage rather than allowing every tool call to spend the full reservation", async () => {
    const plan = await fixturePlan(fixture);
    await fixture.engine.enqueue(owner, plan.id, randomUUID());
    const context = await fixture.engine.claim("metered-worker");
    if (!context) throw new Error("Execution context fixture missing");
    const request = {
      actorId: "metered-worker",
      tool: "fixture.publish",
      destination: "fixture.invalid",
      costMicros: 30,
    };
    await fixture.engine.authorizeGrant(context, request);

    await expect(fixture.engine.authorizeGrant(context, request)).rejects.toMatchObject({
      status: 409,
    });
    await fixture.engine.finish(context, {
      status: "succeeded",
      evidenceRef: "fixture:metered",
      costMicros: 20,
    });
    expect(await fixture.engine.getBudget(owner, fixture.project.id)).toMatchObject({
      reservedMicros: 0,
      spentMicros: 30,
    });
  });

  it("T24 cancellation revokes a running task's grant without claiming an uncertain effect was undone", async () => {
    const plan = await fixturePlan(fixture);
    const run = await fixture.engine.enqueue(owner, plan.id, randomUUID());
    const context = await fixture.engine.claim("cancelled-worker");
    if (!context) throw new Error("Execution context fixture missing");

    const cancelled = await fixture.engine.cancel(owner, run.id, randomUUID());

    expect(cancelled).toMatchObject({ status: "unknown", cleanupState: "pending" });
    await expect(
      fixture.engine.authorizeGrant(context, {
        actorId: "cancelled-worker",
        tool: "fixture.publish",
        destination: "fixture.invalid",
        costMicros: 1,
      }),
    ).rejects.toMatchObject({ status: 409 });
    expect(await fixture.engine.getBudget(owner, fixture.project.id)).toMatchObject({
      reservedMicros: 50,
      spentMicros: 0,
    });
    expect(await fixture.engine.tick("replacement-worker")).toBe(false);
  });
});
