import { randomUUID } from "node:crypto";
import { InfrastructureEngine } from "@godseye/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type DeliveryFixture, deliveryFixture } from "./delivery-helpers.js";

const hash = "e".repeat(64);
describe("E05.S04 migration lock, promotion gate and rollback eligibility", () => {
  let fixture: DeliveryFixture;
  beforeEach(async () => {
    fixture = await deliveryFixture();
  });
  afterEach(async () => {
    await fixture.store.close();
  });
  const view = () => fixture.infrastructure.delivery.overview(fixture.freshOwner());
  const declare = (klass: "none" | "compatible" | "reversible" | "destructive") => {
    fixture.provider.migration = { class: klass, hash };
  };
  async function preparedRelease(klass: "none" | "compatible" | "reversible" | "destructive") {
    declare(klass);
    const policy = await fixture.createPolicy(),
      ci = await fixture.push(),
      built = await fixture.build(policy.id, ci.id),
      preparation = await fixture.prepare({
        policyId: policy.id,
        ciRunId: ci.id,
        intent: "release",
        artifactId: built.artifact.id,
      });
    return { policy, ci, built, preparation };
  }
  const admitApproved = (
    preparation: { id: string; hash: string },
    approveMigrationHash?: string,
  ) =>
    fixture.infrastructure.delivery.admit(
      fixture.freshOwner(),
      { preparationId: preparation.id, expectedHash: preparation.hash, approveMigrationHash },
      randomUUID(),
    );

  it("T-AC-48 binds the declared migration class and exact hash into the prepared release", async () => {
    const { preparation, built } = await preparedRelease("compatible");
    expect(built.artifact.migration).toEqual({ class: "compatible", hash });
    expect(preparation.migration).toEqual({ class: "compatible", hash });
  });
  it("T-AC-48 holds the fenced lock through promotion and releases it on the active outcome", async () => {
    const { preparation } = await preparedRelease("reversible");
    const observed: string[] = [];
    fixture.provider.beforeAction = async (action) => {
      if (action === "promote")
        observed.push(
          ...(await view()).migrationLocks.map((lock) => `${lock.state}:${lock.migration.class}`),
        );
    };
    await admitApproved(preparation);
    await fixture.infrastructure.foundation.tick("migration-lock-worker");
    expect(observed).toEqual(["held:reversible"]);
    const current = await view();
    expect(current.migrationLocks.map((lock) => lock.state)).toEqual(["released"]);
    expect(current.deployments.filter((run) => run.state === "active")).toHaveLength(1);
  });
  it("T-AC-48 takes no migration lane for a release that declares no migration", async () => {
    const { preparation } = await preparedRelease("none");
    await admitApproved(preparation);
    await fixture.infrastructure.foundation.tick("no-migration-worker");
    expect((await view()).migrationLocks).toEqual([]);
  });
  it("T-AC-48 stages and checks readiness before the lane-protected traffic switch", async () => {
    const { preparation } = await preparedRelease("compatible");
    await admitApproved(preparation);
    await fixture.infrastructure.foundation.tick("ordering-worker");
    expect(fixture.provider.effects.map((effect) => effect.action)).toEqual([
      "build",
      "stage",
      "promote",
    ]);
  });
  it("T-AC-48 refuses a destructive migration without the exact owner approval hash", async () => {
    const { preparation } = await preparedRelease("destructive");
    await expect(admitApproved(preparation)).rejects.toMatchObject({
      code: "MIGRATION_APPROVAL_REQUIRED",
    });
    await expect(admitApproved(preparation, "f".repeat(64))).rejects.toMatchObject({
      code: "MIGRATION_APPROVAL_REQUIRED",
    });
    expect(fixture.provider.effects.map((effect) => effect.action)).toEqual(["build"]);
  });
  it("T-AC-48 promotes a destructive migration only after fresh exact approval and then frees the lane", async () => {
    const { preparation } = await preparedRelease("destructive");
    await admitApproved(preparation, hash);
    await fixture.infrastructure.foundation.tick("approved-destructive-worker");
    const current = await view();
    expect(current.deployments.some((run) => run.state === "active")).toBe(true);
    expect(current.migrationLocks.map((lock) => lock.state)).toEqual(["released"]);
  });
  it("T-AC-48 rejects approval supplied for a non-destructive migration", async () => {
    const { preparation } = await preparedRelease("compatible");
    await expect(admitApproved(preparation, hash)).rejects.toMatchObject({
      code: "MIGRATION_APPROVAL_UNEXPECTED",
    });
  });
  it("T-AC-48 never lets standing autoDeploy authority promote a destructive migration", async () => {
    const { preparation } = await preparedRelease("destructive");
    await fixture.infrastructure.delivery.tick();
    await fixture.infrastructure.foundation.tick("standing-destructive-worker");
    const current = await view();
    expect(current.deployments.some((run) => run.preparationId === preparation.id)).toBe(false);
    expect(fixture.provider.effects.filter((effect) => effect.action === "promote")).toHaveLength(
      0,
    );
  });
  it("T-AC-50 keeps the lock uncertain and visible when the traffic-switch acknowledgment is lost, then frees it by reconciliation", async () => {
    const { preparation } = await preparedRelease("compatible");
    const run = await admitApproved(preparation);
    fixture.provider.lostAcknowledgments.add("promote");
    await fixture.infrastructure.foundation.tick("lost-migration-ack-worker");
    expect((await view()).migrationLocks.map((lock) => lock.state)).toEqual(["uncertain"]);
    const restarted = new InfrastructureEngine(fixture.store, fixture.configuration);
    await restarted.foundation.reconcile(fixture.freshOwner(), run.runId, randomUUID());
    const current = await restarted.delivery.overview(fixture.freshOwner());
    expect(current.migrationLocks.map((lock) => lock.state)).toEqual(["released"]);
    expect(current.deployments.find((item) => item.id === run.id)?.state).toBe("active");
  });
  it("T-AC-50 retains the lock as uncertain after a crash before the stage effect and blocks another migration", async () => {
    const { preparation, policy, ci, built } = await preparedRelease("compatible");
    fixture.provider.beforeAction = async (action) => {
      if (action === "stage") throw new Error("Controller crashed after taking the migration lane");
    };
    await admitApproved(preparation);
    await fixture.infrastructure.foundation.tick("crash-after-lock-worker");
    expect((await view()).migrationLocks.map((lock) => lock.state)).toEqual(["uncertain"]);
    const second = await fixture.prepare({
      policyId: policy.id,
      ciRunId: ci.id,
      intent: "release",
      artifactId: built.artifact.id,
    });
    await expect(admitApproved(second)).rejects.toMatchObject({
      code: expect.stringMatching(/^(MIGRATION_LOCKED|DELIVERY_BUSY)$/),
    });
  });
  it("T-AC-48 excludes rollback to an image when a later release applied a non-backward-compatible migration", async () => {
    const policy = await fixture.createPolicy(),
      first = await fixture.push(),
      a = await fixture.build(policy.id, first.id),
      releaseA = await fixture.release(policy.id, first.id, a.artifact.id);
    declare("reversible");
    fixture.source.head = "b".repeat(40);
    const second = await fixture.push(),
      b = await fixture.build(policy.id, second.id);
    await fixture.release(policy.id, second.id, b.artifact.id);
    await expect(
      fixture.prepare({
        policyId: policy.id,
        ciRunId: second.id,
        intent: "rollback",
        deploymentId: releaseA.run.id,
      }),
    ).rejects.toMatchObject({ code: "MIGRATION_NOT_BACKWARD_COMPATIBLE" });
    expect((await view()).rollbackBlocked).toContain(releaseA.run.id);
  });
  it("T-AC-48 keeps rollback eligible when the later migration is backward compatible", async () => {
    const policy = await fixture.createPolicy(),
      first = await fixture.push(),
      a = await fixture.build(policy.id, first.id),
      releaseA = await fixture.release(policy.id, first.id, a.artifact.id);
    declare("compatible");
    fixture.source.head = "b".repeat(40);
    const second = await fixture.push(),
      b = await fixture.build(policy.id, second.id);
    await fixture.release(policy.id, second.id, b.artifact.id);
    await expect(
      fixture.prepare({
        policyId: policy.id,
        ciRunId: second.id,
        intent: "rollback",
        deploymentId: releaseA.run.id,
      }),
    ).resolves.toMatchObject({ intent: "rollback" });
    expect((await view()).rollbackBlocked).toEqual([]);
  });
});
