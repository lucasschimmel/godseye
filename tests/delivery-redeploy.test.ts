import { randomUUID } from "node:crypto";
import { schema } from "@godseye/store";
import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import { type DeliveryFixture, deliveryFixture } from "./delivery-helpers.js";

async function released(fixture: DeliveryFixture) {
  const policy = await fixture.createPolicy(),
    ci = await fixture.push(),
    built = await fixture.build(policy.id, ci.id),
    active = await fixture.release(policy.id, ci.id, built.artifact.id);
  return { policy, ci, built, active };
}
async function revisionOf(fixture: DeliveryFixture, environmentId: string) {
  const [row] = await fixture.store.db
    .select()
    .from(schema.environments)
    .where(eq(schema.environments.id, environmentId));
  if (!row) throw new Error("Environment missing");
  return row.revision;
}
const redeploy = async (fixture: DeliveryFixture, key = randomUUID()) =>
  fixture.infrastructure.delivery.redeploy(
    fixture.freshOwner(),
    {
      environmentId: fixture.development.id,
      expectedEnvironmentRevision: await revisionOf(fixture, fixture.development.id),
    },
    key,
  );

describe("redeploy of the current release", () => {
  let fixture: DeliveryFixture;
  afterEach(async () => {
    await fixture.store.close();
  });

  it("prepares a release of the same artifact digest without a new build and audits it", async () => {
    fixture = await deliveryFixture();
    const { built, ci } = await released(fixture);
    const before = await fixture.store.db.select().from(schema.deliveryArtifacts);

    const preparation = await redeploy(fixture);

    expect(preparation).toMatchObject({
      intent: "release",
      artifactId: built.artifact.id,
      ciRunId: ci.id,
      environmentId: fixture.development.id,
    });
    expect(await fixture.store.db.select().from(schema.deliveryArtifacts)).toHaveLength(
      before.length,
    );
    const audit = await fixture.store.db.select().from(schema.audit);
    expect(audit.some((entry) => entry.action === "delivery.redeploy.prepared")).toBe(true);
  });

  it("executes through the ordinary admission and keeps the same digest active", async () => {
    fixture = await deliveryFixture();
    const { built } = await released(fixture);
    const preparation = await redeploy(fixture);

    await fixture.admit(preparation);
    await fixture.infrastructure.foundation.tick("delivery-release-worker");

    expect(fixture.provider.active.get(fixture.development.id)).toBe(built.artifact.digest);
  });

  it("replays the same key without creating a second preparation", async () => {
    fixture = await deliveryFixture();
    await released(fixture);
    const key = randomUUID();
    const first = await redeploy(fixture, key);
    const count = (await fixture.store.db.select().from(schema.deliveryPreparations)).length;

    const second = await redeploy(fixture, key);

    expect(second).toEqual(first);
    expect(await fixture.store.db.select().from(schema.deliveryPreparations)).toHaveLength(count);
  });

  it("refuses a key that already identifies another request", async () => {
    fixture = await deliveryFixture();
    const { policy, ci, built } = await released(fixture);
    const key = randomUUID();
    await fixture.prepare({ policyId: policy.id, ciRunId: ci.id, intent: "build" }, key);
    expect(built.artifact.id).toBeTruthy();

    await expect(redeploy(fixture, key)).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
  });

  it("rejects a stale environment revision with 409", async () => {
    fixture = await deliveryFixture();
    await released(fixture);

    await expect(
      fixture.infrastructure.delivery.redeploy(
        fixture.freshOwner(),
        {
          environmentId: fixture.development.id,
          expectedEnvironmentRevision: (await revisionOf(fixture, fixture.development.id)) + 1,
        },
        randomUUID(),
      ),
    ).rejects.toMatchObject({ code: "REVISION_CONFLICT", status: 409 });
  });

  it("denies a non-owner actor with 403", async () => {
    fixture = await deliveryFixture();
    await released(fixture);
    const service = {
      id: "source-agent",
      kind: "service" as const,
      projectIds: [fixture.project.id],
    };

    await expect(
      fixture.infrastructure.delivery.redeploy(
        service,
        { environmentId: fixture.development.id, expectedEnvironmentRevision: 0 },
        randomUUID(),
      ),
    ).rejects.toMatchObject({ status: 403 });
  });

  it("denies an owner whose passkey confirmation is stale", async () => {
    fixture = await deliveryFixture();
    await released(fixture);

    await expect(
      fixture.infrastructure.delivery.redeploy(
        { ...fixture.freshOwner(), authenticatedAt: "2026-11-11T11:00:00.000Z" },
        { environmentId: fixture.development.id, expectedEnvironmentRevision: 0 },
        randomUUID(),
      ),
    ).rejects.toMatchObject({ status: 403 });
  });

  it("refuses an environment with no current release", async () => {
    fixture = await deliveryFixture();
    await fixture.createPolicy();

    await expect(redeploy(fixture)).rejects.toMatchObject({ code: "NO_CURRENT_RELEASE" });
  });

  it("refuses when no current delivery policy remains", async () => {
    fixture = await deliveryFixture();
    const { policy } = await released(fixture);
    await fixture.infrastructure.delivery.revokePolicy(
      fixture.freshOwner(),
      policy.id,
      policy.revision,
      randomUUID(),
    );

    await expect(redeploy(fixture)).rejects.toMatchObject({ code: "POLICY_REQUIRED" });
  });

  it("refuses an environment under recovery hold", async () => {
    fixture = await deliveryFixture();
    await released(fixture);
    await fixture.store.db
      .update(schema.environments)
      .set({ recoveryHold: true })
      .where(eq(schema.environments.id, fixture.development.id));

    await expect(redeploy(fixture)).rejects.toMatchObject({ code: "RECOVERY_HOLD", status: 409 });
  });

  it("refuses an expired preview under delivery hold", async () => {
    fixture = await deliveryFixture();
    const policy = await fixture.createPolicy(),
      pull = await fixture.pull();
    const preparation = await fixture.prepare({
      policyId: policy.id,
      ciRunId: pull.id,
      intent: "build",
    });
    fixture.clock.advance(policy.previewTtlHours * 3_600_000 + 1);

    await expect(
      fixture.infrastructure.delivery.redeploy(
        fixture.freshOwner(),
        { environmentId: preparation.environmentId, expectedEnvironmentRevision: 0 },
        randomUUID(),
      ),
    ).rejects.toMatchObject({ code: "DELIVERY_HOLD", status: 409 });
  });

  it("refuses when delivery execution is unconfigured", async () => {
    fixture = await deliveryFixture({ noProvider: true });
    await fixture.createPolicy();

    await expect(redeploy(fixture)).rejects.toMatchObject({ code: "CAPABILITY_UNAVAILABLE" });
  });
});
