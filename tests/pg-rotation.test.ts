import { randomUUID } from "node:crypto";
import type { RotateDatabaseRoleInput } from "@godseye/contracts";
import { schema } from "@godseye/store";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type RotationFixture, rotationFixture } from "./rotation-helpers.js";

describe("database role rotation with durable intent and reconciliation", () => {
  let fixture: RotationFixture;
  beforeEach(async () => {
    fixture = await rotationFixture();
  });
  afterEach(async () => {
    await fixture.store.close();
  });
  const input = (role: RotateDatabaseRoleInput["role"] = "api"): RotateDatabaseRoleInput => ({
    projectId: fixture.allocation.projectId,
    environmentId: fixture.allocation.environmentId,
    allocationId: fixture.allocation.id,
    role,
    slotId: null,
    expectedGeneration: fixture.allocation.generation,
  });
  const rotate = (value = input(), key = randomUUID()) =>
    fixture.infrastructure.rotation.rotate(fixture.freshOwner(), value, key);
  const overview = () => fixture.infrastructure.rotation.overview(fixture.freshOwner());

  it("rotates a role password, records fingerprints and never returns the secret", async () => {
    const before = await fixture.cluster.verifier(fixture.roleNames.api);

    const record = await rotate();

    const after = await fixture.cluster.verifier(fixture.roleNames.api);
    expect(record.state).toBe("succeeded");
    expect(after).not.toBe(before);
    expect(record.previousVerifier).not.toBe(record.nextVerifier);
    const secret = fixture.sink.staged.get(record.id) ?? "";
    expect(secret.length).toBeGreaterThan(30);
    const persisted = JSON.stringify([
      record,
      await overview(),
      await fixture.store.db.select().from(schema.databaseRotations),
      await fixture.store.db.select().from(schema.audit),
    ]);
    expect(persisted).not.toContain(secret);
    expect(fixture.sink.committed).toEqual([record.id]);
  });

  it("replays an idempotency key without repeating the physical effect", async () => {
    const key = randomUUID();
    const first = await rotate(input(), key);
    const afterFirst = await fixture.cluster.verifier(fixture.roleNames.api);

    const second = await rotate(input(), key);

    expect(second.id).toBe(first.id);
    expect(await fixture.cluster.verifier(fixture.roleNames.api)).toBe(afterFirst);
  });

  it("reconciles a lost commit acknowledgment to succeeded by inspecting the durable marker", async () => {
    fixture.cluster.loseCommitAck = true;

    const record = await rotate();

    expect(record.state).toBe("succeeded");
    expect(fixture.sink.committed).toEqual([record.id]);
  });

  it("fails certainly when the change never applied and discards the staged material", async () => {
    fixture.cluster.failOn = "alter";

    const record = await rotate();

    expect(record).toMatchObject({ state: "failed", reason: "ROTATION_NOT_APPLIED" });
    expect(fixture.sink.discarded).toEqual([record.id]);
    expect(await fixture.cluster.verifier(fixture.roleNames.api)).toContain("SCRAM-SHA-256");
  });

  it("fails certainly without dispatch when the pre-check inspection is unavailable", async () => {
    fixture.cluster.failOn = "inspect";

    const record = await rotate();

    expect(record).toMatchObject({ state: "failed", reason: "PRECHECK_UNAVAILABLE" });
    expect(fixture.sink.staged.size).toBe(0);
  });

  it("blocks a second rotation while an earlier one is unresolved and reconciles after recovery", async () => {
    fixture.sink.failCommit = true;
    const unresolved = await rotate();
    expect(unresolved).toMatchObject({ state: "unknown", reason: "MATERIAL_HANDOFF_UNCERTAIN" });

    await expect(rotate()).rejects.toMatchObject({ code: "ROTATION_IN_PROGRESS" });

    fixture.sink.failCommit = false;
    const reconciled = await fixture.infrastructure.rotation.reconcile(
      fixture.freshOwner(),
      unresolved.id,
      randomUUID(),
    );
    expect(reconciled.state).toBe("succeeded");
    expect((await rotate()).state).toBe("succeeded");
  });

  it("refuses rotation without a configured provider", async () => {
    const bare = await rotationFixture({ rotation: false });
    try {
      await expect(
        bare.infrastructure.rotation.rotate(
          bare.freshOwner(),
          {
            ...input(),
            allocationId: bare.allocation.id,
            projectId: bare.allocation.projectId,
            environmentId: bare.allocation.environmentId,
            expectedGeneration: bare.allocation.generation,
          },
          randomUUID(),
        ),
      ).rejects.toMatchObject({ status: 503 });
      expect((await bare.infrastructure.rotation.overview(bare.freshOwner())).execution).toBe(
        "unconfigured",
      );
    } finally {
      await bare.store.close();
    }
  });

  it("requires a recent owner step-up and the current allocation generation", async () => {
    await expect(
      fixture.infrastructure.rotation.rotate(
        { ...fixture.freshOwner(), authenticatedAt: "2020-01-01T00:00:00.000Z" },
        input(),
        randomUUID(),
      ),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      rotate({ ...input(), expectedGeneration: fixture.allocation.generation + 1 }),
    ).rejects.toMatchObject({ code: "REVISION_CONFLICT" });
  });

  it("rejects a slot from another project environment", async () => {
    await expect(rotate({ ...input(), slotId: randomUUID() })).rejects.toMatchObject({
      status: 403,
    });
  });

  it("stays readable and reports unavailable when the provider qualification fails", async () => {
    await rotate();
    fixture.cluster.qualificationDown = true;

    const view = await overview();

    expect(view.execution).toBe("unavailable");
    expect(view.roles.find((item) => item.role === "api")?.state).toBe("succeeded");
    expect((await fixture.infrastructure.database.overview(fixture.freshOwner())).rotation).toBe(
      "unavailable",
    );
  });

  it("assembles every role with its latest state for the allocation", async () => {
    await rotate(input("worker"));

    const roles = (await overview()).roles;

    expect(roles).toHaveLength(8);
    expect(roles.find((item) => item.role === "worker")?.state).toBe("succeeded");
    expect(roles.find((item) => item.role === "api")?.state).toBe("never-rotated");
    expect((await fixture.infrastructure.database.overview(fixture.freshOwner())).rotation).toBe(
      "healthy",
    );
  });
});
