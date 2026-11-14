import { randomUUID } from "node:crypto";
import { InfrastructureEngine } from "@godseye/core";
import { schema } from "@godseye/store";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type RecoveryFixture, recoveryFixture } from "./recovery-helpers.js";
import { NotifierFixture, type RotationFixture, rotationFixture } from "./rotation-helpers.js";

describe("scoped archive and headroom incidents", () => {
  let fixture: RecoveryFixture;
  let notifier: NotifierFixture;
  let engine: InfrastructureEngine;
  beforeEach(async () => {
    fixture = await recoveryFixture();
    notifier = new NotifierFixture();
    engine = fixture.infrastructure;
  });
  afterEach(async () => {
    await fixture.store.close();
  });
  const evaluate = (target = engine) =>
    target.incidents.evaluate(fixture.freshOwner(), randomUUID());
  const withNotifier = () =>
    new InfrastructureEngine(fixture.store, {
      ...fixture.configuration,
      incidentNotifier: notifier,
    });
  async function patchMetadata(change: Record<string, unknown>) {
    const [row] = await fixture.store.db.select().from(schema.recoveryBackups);
    if (!row) throw new Error("Backup fixture missing");
    await fixture.store.db
      .update(schema.recoveryBackups)
      .set({ metadata: { ...row.metadata, ...change } })
      .where(eq(schema.recoveryBackups.id, row.id));
  }
  async function only() {
    const incident = (await evaluate()).incidents[0];
    if (!incident) throw new Error("Expected one incident");
    return incident;
  }

  it("raises nothing while the archive is healthy", async () => {
    await fixture.backup();

    expect((await evaluate()).incidents).toEqual([]);
  });

  it("raises a project, environment and cell scoped archive-lag incident and reports delivery unconfigured", async () => {
    await fixture.backup();
    fixture.clock.advance(301_000);

    const result = await evaluate();

    expect(result.notifier).toBe("unconfigured");
    expect(result.incidents).toHaveLength(1);
    expect(result.incidents[0]).toMatchObject({
      kind: "archive-lag",
      severity: "warning",
      state: "open",
      projectId: fixture.project.id,
      environmentId: fixture.development.id,
      allocationId: fixture.source.id,
      delivery: { state: "unconfigured", attempts: 0, lastAttemptAt: null },
    });
  });

  it("deduplicates repeated evaluations by stable key and escalates severity in place", async () => {
    await fixture.backup();
    fixture.clock.advance(301_000);
    const first = await only();

    fixture.clock.advance(600_000);
    const second = await only();

    expect(second.id).toBe(first.id);
    expect(second).toMatchObject({ occurrences: 2, severity: "critical" });
    expect((await engine.incidents.overview(fixture.freshOwner())).incidents).toHaveLength(1);
  });

  it("raises an unknown-archive incident instead of assuming health when the provider is degraded", async () => {
    await fixture.backup();
    fixture.recoveryProvider.qualificationResult = () => null;

    const incident = await only();

    expect(incident).toMatchObject({ kind: "archive-lag", reason: "ARCHIVE_STATUS_UNKNOWN" });
  });

  it("raises a critical headroom incident when archive free space is below policy", async () => {
    await fixture.backup();
    await patchMetadata({ archiveFreeGiB: 0.25 });

    const incident = await only();

    expect(incident).toMatchObject({
      kind: "headroom",
      severity: "critical",
      reason: "HEADROOM_LOW",
    });
  });

  it("clears an incident automatically when the condition disappears", async () => {
    await fixture.backup();
    await patchMetadata({ archiveFreeGiB: 0.25 });
    const raised = await only();

    await patchMetadata({ archiveFreeGiB: 2 });
    const after = (await evaluate()).incidents.find((item) => item.id === raised.id);

    expect(after).toMatchObject({ state: "resolved", resolution: "cleared" });
  });

  it("acknowledges once, rejects a stale revision and replays the same key", async () => {
    await fixture.backup();
    await patchMetadata({ archiveFreeGiB: 0.25 });
    const raised = await only();
    const key = randomUUID();

    const acknowledged = await engine.incidents.acknowledge(
      fixture.freshOwner(),
      raised.id,
      { expectedRevision: raised.revision },
      key,
    );
    const replay = await engine.incidents.acknowledge(
      fixture.freshOwner(),
      raised.id,
      { expectedRevision: raised.revision },
      key,
    );

    expect(acknowledged).toMatchObject({ state: "acknowledged", revision: raised.revision + 1 });
    expect(replay.revision).toBe(acknowledged.revision);
    await expect(
      engine.incidents.acknowledge(
        fixture.freshOwner(),
        raised.id,
        { expectedRevision: raised.revision },
        randomUUID(),
      ),
    ).rejects.toMatchObject({ code: "REVISION_CONFLICT" });
  });

  it("mutes until an expiry, then shows the incident unmuted again", async () => {
    await fixture.backup();
    await patchMetadata({ archiveFreeGiB: 0.25 });
    const raised = await only();
    const until = new Date(fixture.clock.now().getTime() + 3_600_000).toISOString();

    const muted = await engine.incidents.mute(
      fixture.freshOwner(),
      raised.id,
      { expectedRevision: raised.revision, until },
      randomUUID(),
    );
    fixture.clock.advance(3_600_001);
    const later = (await engine.incidents.overview(fixture.freshOwner())).incidents[0];

    expect(muted).toMatchObject({ muted: true, mutedUntil: until });
    expect(later).toMatchObject({ muted: false, state: "open" });
  });

  it("rejects a past or over-long mute expiry", async () => {
    await fixture.backup();
    await patchMetadata({ archiveFreeGiB: 0.25 });
    const raised = await only();
    const mute = (until: string) =>
      engine.incidents.mute(
        fixture.freshOwner(),
        raised.id,
        { expectedRevision: raised.revision, until },
        randomUUID(),
      );

    await expect(
      mute(new Date(fixture.clock.now().getTime() - 1000).toISOString()),
    ).rejects.toMatchObject({
      status: 422,
    });
    await expect(
      mute(new Date(fixture.clock.now().getTime() + 31 * 86_400_000).toISOString()),
    ).rejects.toMatchObject({
      status: 422,
    });
  });

  it("keeps a manually resolved incident immutable and opens a new one while the condition persists", async () => {
    await fixture.backup();
    await patchMetadata({ archiveFreeGiB: 0.25 });
    const raised = await only();

    const resolved = await engine.incidents.resolve(
      fixture.freshOwner(),
      raised.id,
      { expectedRevision: raised.revision },
      randomUUID(),
    );
    const again = (await evaluate()).incidents.filter((item) => item.state !== "resolved");

    expect(resolved).toMatchObject({ state: "resolved", resolution: "manual" });
    expect(again).toHaveLength(1);
    expect(again[0]?.id).not.toBe(raised.id);
    await expect(
      engine.incidents.acknowledge(
        fixture.freshOwner(),
        raised.id,
        { expectedRevision: resolved.revision },
        randomUUID(),
      ),
    ).rejects.toMatchObject({ code: "INCIDENT_RESOLVED" });
  });

  it("marks delivery notified only after the injected notifier acknowledges", async () => {
    await fixture.backup();
    await patchMetadata({ archiveFreeGiB: 0.25 });
    const configured = withNotifier();

    const incident = (await evaluate(configured)).incidents[0];

    expect(incident?.delivery).toMatchObject({ state: "notified", attempts: 1 });
    expect(notifier.sent).toEqual([incident?.id]);
  });

  it("keeps a failed delivery visible and bounds retries", async () => {
    await fixture.backup();
    await patchMetadata({ archiveFreeGiB: 0.25 });
    let rejections = 0;
    const configured = new InfrastructureEngine(fixture.store, {
      ...fixture.configuration,
      incidentNotifier: {
        async notify() {
          rejections += 1;
          return { state: "failed" as const };
        },
      },
    });

    for (let index = 0; index < 5; index += 1) await evaluate(configured);
    const incident = (await configured.incidents.overview(fixture.freshOwner())).incidents[0];

    expect(incident?.delivery).toMatchObject({ state: "failed", attempts: 3 });
    expect(rejections).toBe(3);
  });

  it("does not notify a muted incident", async () => {
    await fixture.backup();
    await patchMetadata({ archiveFreeGiB: 0.25 });
    const configured = withNotifier();
    const raised = (await evaluate()).incidents[0];
    if (!raised) throw new Error("Expected incident");
    await configured.incidents.mute(
      fixture.freshOwner(),
      raised.id,
      {
        expectedRevision: raised.revision,
        until: new Date(fixture.clock.now().getTime() + 3_600_000).toISOString(),
      },
      randomUUID(),
    );

    await evaluate(configured);

    expect(notifier.sent).toEqual([]);
  });
});

describe("rotation-failure incidents", () => {
  let fixture: RotationFixture;
  beforeEach(async () => {
    fixture = await rotationFixture({ notifier: new NotifierFixture() });
  });
  afterEach(async () => {
    await fixture.store.close();
  });
  const request = () => ({
    projectId: fixture.allocation.projectId,
    environmentId: fixture.allocation.environmentId,
    allocationId: fixture.allocation.id,
    role: "api" as const,
    slotId: null,
    expectedGeneration: fixture.allocation.generation,
  });

  it("raises a role-scoped incident for a failed rotation and clears it after a later success", async () => {
    fixture.cluster.failOn = "alter";
    await fixture.infrastructure.rotation.rotate(fixture.freshOwner(), request(), randomUUID());

    const raised = (
      await fixture.infrastructure.incidents.evaluate(fixture.freshOwner(), randomUUID())
    ).incidents[0];
    fixture.cluster.failOn = null;
    await fixture.infrastructure.rotation.rotate(fixture.freshOwner(), request(), randomUUID());
    const after = (
      await fixture.infrastructure.incidents.evaluate(fixture.freshOwner(), randomUUID())
    ).incidents.find((item) => item.id === raised?.id);

    expect(raised).toMatchObject({
      kind: "rotation-failure",
      subject: "api",
      reason: "ROTATION_FAILED",
      allocationId: fixture.allocation.id,
    });
    expect(after).toMatchObject({ state: "resolved", resolution: "cleared" });
  });

  it("raises a critical incident for an uncertain rotation and clears it after reconciliation", async () => {
    fixture.sink.failCommit = true;
    const unknown = await fixture.infrastructure.rotation.rotate(
      fixture.freshOwner(),
      request(),
      randomUUID(),
    );

    const raised = (
      await fixture.infrastructure.incidents.evaluate(fixture.freshOwner(), randomUUID())
    ).incidents[0];
    fixture.sink.failCommit = false;
    await fixture.infrastructure.rotation.reconcile(fixture.freshOwner(), unknown.id, randomUUID());
    const after = (
      await fixture.infrastructure.incidents.evaluate(fixture.freshOwner(), randomUUID())
    ).incidents[0];

    expect(raised).toMatchObject({ severity: "critical", reason: "ROTATION_OUTCOME_UNKNOWN" });
    expect(after).toMatchObject({ id: raised?.id, state: "resolved" });
  });
});
