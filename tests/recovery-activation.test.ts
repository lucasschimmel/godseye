import { randomUUID } from "node:crypto";
import {
  ACTIVATION_ACKNOWLEDGEMENTS,
  type ActivateRestoreInput,
  ActivationAssessment,
  RestoreActivation,
} from "@godseye/contracts";
import { schema } from "@godseye/store";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { fixtureProfile } from "./pg-helpers.js";
import { type RecoveryFixture, recoveryFixture } from "./recovery-helpers.js";

describe("owner-confirmed restore activation fences the source and promotes only on proof", () => {
  let fixture: RecoveryFixture;
  beforeEach(async () => {
    fixture = await recoveryFixture();
  });
  afterEach(async () => {
    await fixture.store.close();
  });

  async function verifiedRestore(promotion = true) {
    if (promotion) fixture.recoveryProvider.enablePromotion();
    const { backup, run: backupRun } = await fixture.backup();
    const preparation = await fixture.prepareRestore(backup.id);
    await fixture.admitRecovery(preparation);
    await fixture.infrastructure.foundation.tick("activation-restore-worker");
    return { preparation, backupRun };
  }
  async function project() {
    return fixture.core.getProject(fixture.freshOwner(), fixture.project.id);
  }
  async function confirmation(
    environmentId: string,
    overrides: Partial<ActivateRestoreInput> = {},
  ): Promise<ActivateRestoreInput> {
    const current = await project();
    const environment = current.environments.find((item) => item.id === environmentId);
    if (!environment) throw new Error("Restored environment fixture missing");
    return {
      expectedProjectRevision: current.revision,
      expectedEnvironmentRevision: environment.revision,
      confirmName: environment.name,
      acknowledged: [...ACTIVATION_ACKNOWLEDGEMENTS],
      ...overrides,
    };
  }
  const activate = (environmentId: string, input: ActivateRestoreInput, key = randomUUID()) =>
    fixture.infrastructure.recovery.activate(fixture.freshOwner(), environmentId, input, key);
  const kinds = async (...ids: string[]) => {
    const current = await project();
    return ids.map((id) => {
      const environment = current.environments.find((item) => item.id === id);
      return { kind: environment?.kind, recoveryHold: environment?.recoveryHold };
    });
  };
  const sourceEpoch = async () =>
    (
      await fixture.store.db
        .select()
        .from(schema.activationEpochs)
        .where(eq(schema.activationEpochs.environmentId, fixture.development.id))
    )[0]?.epoch ?? 1;

  it("T-AC-40 T-AC-45 reports a verified restore ready and names every coverage gap the owner must accept", async () => {
    const { preparation } = await verifiedRestore();
    const assessment = ActivationAssessment.parse(
      await fixture.infrastructure.recovery.assessActivation(
        fixture.freshOwner(),
        preparation.environmentId,
      ),
    );
    expect(assessment).toMatchObject({
      activation: "ready",
      reasons: [],
      sourceEnvironmentId: fixture.development.id,
      requiredAcknowledgements: [...ACTIVATION_ACKNOWLEDGEMENTS],
      pending: null,
    });
  });

  it("T-AC-40 T-AC-45 fences the source, promotes and designates the restore active only after the confirmed step", async () => {
    const { preparation } = await verifiedRestore();
    const before = await sourceEpoch();
    const activation = RestoreActivation.parse(
      await activate(preparation.environmentId, await confirmation(preparation.environmentId)),
    );
    expect(activation).toMatchObject({
      state: "activated",
      environmentId: preparation.environmentId,
      sourceEnvironmentId: fixture.development.id,
      reason: null,
    });
    expect(await kinds(preparation.environmentId, fixture.development.id)).toEqual([
      { kind: "development", recoveryHold: false },
      { kind: "recovery", recoveryHold: true },
    ]);
    expect(await sourceEpoch()).toBe(before + 1);
    expect(fixture.recoveryProvider.effects.filter((e) => e.action === "promote")).toHaveLength(1);
  });

  it("T-AC-40 keeps the retained source unusable for ordinary authority after activation", async () => {
    const { preparation } = await verifiedRestore();
    await activate(preparation.environmentId, await confirmation(preparation.environmentId));
    const current = await project();
    const source = current.environments.find((item) => item.id === fixture.development.id);
    if (!source) throw new Error("Retained source environment missing");
    await expect(
      fixture.infrastructure.database.prepare(
        fixture.freshOwner(),
        {
          projectId: current.id,
          environmentId: source.id,
          expectedProjectRevision: current.revision,
          expectedEnvironmentRevision: source.revision,
          profile: fixtureProfile,
        },
        randomUUID(),
      ),
    ).rejects.toMatchObject({ code: "RECOVERY_HOLD" });
  });

  it("T-AC-40 refuses an activated environment a second time without another physical effect", async () => {
    const { preparation } = await verifiedRestore();
    const input = await confirmation(preparation.environmentId);
    await activate(preparation.environmentId, input);
    await expect(
      activate(preparation.environmentId, await confirmation(preparation.environmentId)),
    ).rejects.toMatchObject({ code: "RECOVERY_HOLD" });
    expect(fixture.recoveryProvider.effects.filter((e) => e.action === "promote")).toHaveLength(1);
  });

  it("T-AC-38 replays one exact activation request without a second promotion", async () => {
    const { preparation } = await verifiedRestore();
    const input = await confirmation(preparation.environmentId),
      key = randomUUID();
    const first = await activate(preparation.environmentId, input, key);
    expect(await activate(preparation.environmentId, input, key)).toEqual(first);
    await expect(
      activate(preparation.environmentId, { ...input, confirmName: "another-name" }, key),
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
    expect(fixture.recoveryProvider.effects.filter((e) => e.action === "promote")).toHaveLength(1);
  });

  describe("refusals leave both environments untouched", () => {
    async function expectUntouched(preparation: { environmentId: string }, before: number) {
      expect(await kinds(preparation.environmentId, fixture.development.id)).toEqual([
        { kind: "recovery", recoveryHold: true },
        { kind: "development", recoveryHold: false },
      ]);
      expect(await sourceEpoch()).toBe(before);
      expect(fixture.recoveryProvider.effects.some((e) => e.action === "promote")).toBe(false);
      expect(await fixture.store.db.select().from(schema.recoveryActivations)).toEqual([]);
    }

    it("T-AC-42 requires a recent verified owner passkey session", async () => {
      const { preparation } = await verifiedRestore();
      const before = await sourceEpoch();
      await expect(
        fixture.infrastructure.recovery.activate(
          { ...fixture.freshOwner(), authenticatedAt: "2026-11-11T10:00:00.000Z" },
          preparation.environmentId,
          await confirmation(preparation.environmentId),
          randomUUID(),
        ),
      ).rejects.toMatchObject({ code: "STEP_UP_REQUIRED" });
      await expectUntouched(preparation, before);
    });

    it("T-AC-42 refuses a service actor", async () => {
      const { preparation } = await verifiedRestore();
      const before = await sourceEpoch();
      await expect(
        fixture.infrastructure.recovery.activate(
          { id: "service", kind: "service", projectIds: [fixture.project.id] },
          preparation.environmentId,
          await confirmation(preparation.environmentId),
          randomUUID(),
        ),
      ).rejects.toMatchObject({ status: 403 });
      await expectUntouched(preparation, before);
    });

    it.each([
      [
        "a typed name that differs",
        { confirmName: "not-the-environment" },
        "CONFIRMATION_MISMATCH",
      ],
      ["a missing acknowledgement", { acknowledged: [] }, "ACKNOWLEDGEMENT_REQUIRED"],
      [
        "a duplicated acknowledgement",
        {
          acknowledged: [...ACTIVATION_ACKNOWLEDGEMENTS, "FILES_SNAPSHOT_MISSING" as const],
        },
        "ACKNOWLEDGEMENT_REQUIRED",
      ],
      ["a stale project revision", { expectedProjectRevision: 0 }, "REVISION_CONFLICT"],
      ["a stale environment revision", { expectedEnvironmentRevision: 99 }, "REVISION_CONFLICT"],
    ] as const)("T-AC-42 refuses %s", async (_label, overrides, code) => {
      const { preparation } = await verifiedRestore();
      const before = await sourceEpoch();
      await expect(
        activate(
          preparation.environmentId,
          await confirmation(preparation.environmentId, {
            ...overrides,
          } as Partial<ActivateRestoreInput>),
        ),
      ).rejects.toMatchObject({ code });
      await expectUntouched(preparation, before);
    });

    it("T-AC-40 names a missing provider promotion capability instead of designating an unreachable database", async () => {
      const { preparation } = await verifiedRestore(false);
      const before = await sourceEpoch();
      expect(
        await fixture.infrastructure.recovery.assessActivation(
          fixture.freshOwner(),
          preparation.environmentId,
        ),
      ).toMatchObject({ activation: "blocked", reasons: ["PROMOTION_UNAVAILABLE"] });
      await expect(
        activate(preparation.environmentId, await confirmation(preparation.environmentId)),
      ).rejects.toMatchObject({ code: "ACTIVATION_BLOCKED" });
      await expectUntouched(preparation, before);
    });

    it("T-AC-41 refuses a restore whose physical verification never completed", async () => {
      fixture.recoveryProvider.enablePromotion();
      const { backup } = await fixture.backup();
      const preparation = await fixture.prepareRestore(backup.id);
      const before = await sourceEpoch();
      expect(
        (
          await fixture.infrastructure.recovery.assessActivation(
            fixture.freshOwner(),
            preparation.environmentId,
          )
        ).reasons,
      ).toContain("RESTORE_NOT_VERIFIED");
      await expect(
        activate(preparation.environmentId, await confirmation(preparation.environmentId)),
      ).rejects.toMatchObject({ code: "ACTIVATION_BLOCKED" });
      await expectUntouched(preparation, before);
    });

    it("T-AC-41 refuses while the source still has unfinished work", async () => {
      const { preparation, backupRun } = await verifiedRestore();
      const before = await sourceEpoch();
      await fixture.store.db
        .update(schema.executionRuns)
        .set({ terminalAt: null })
        .where(eq(schema.executionRuns.id, backupRun.runId));
      expect(
        (
          await fixture.infrastructure.recovery.assessActivation(
            fixture.freshOwner(),
            preparation.environmentId,
          )
        ).reasons,
      ).toContain("SOURCE_WORK_IN_FLIGHT");
      await expect(
        activate(preparation.environmentId, await confirmation(preparation.environmentId)),
      ).rejects.toMatchObject({ code: "ACTIVATION_BLOCKED" });
      await expectUntouched(preparation, before);
    });

    it("T-AC-41 refuses while a source effect is unresolved and never reads a missing journal as complete", async () => {
      const { preparation, backupRun } = await verifiedRestore();
      const before = await sourceEpoch();
      await fixture.store.db
        .update(schema.effects)
        .set({ status: "unknown" })
        .where(eq(schema.effects.runId, backupRun.runId));
      expect(
        (
          await fixture.infrastructure.recovery.assessActivation(
            fixture.freshOwner(),
            preparation.environmentId,
          )
        ).reasons,
      ).toContain("UNRECONCILED_EFFECTS");
      await expect(
        activate(preparation.environmentId, await confirmation(preparation.environmentId)),
      ).rejects.toMatchObject({ code: "ACTIVATION_BLOCKED" });
      await expectUntouched(preparation, before);
    });

    it("T-AC-40 keeps requiring the effect-coverage acknowledgement when the whole journal is empty", async () => {
      const { preparation } = await verifiedRestore();
      await fixture.store.db.delete(schema.effects);
      const assessment = await fixture.infrastructure.recovery.assessActivation(
        fixture.freshOwner(),
        preparation.environmentId,
      );
      expect(assessment.requiredAcknowledgements).toContain(
        "NON_REWOUND_BUSINESS_EFFECT_COVERAGE_UNQUALIFIED",
      );
      await expect(
        activate(
          preparation.environmentId,
          await confirmation(preparation.environmentId, {
            acknowledged: ACTIVATION_ACKNOWLEDGEMENTS.filter(
              (item) => item !== "NON_REWOUND_BUSINESS_EFFECT_COVERAGE_UNQUALIFIED",
            ),
          }),
        ),
      ).rejects.toMatchObject({ code: "ACKNOWLEDGEMENT_REQUIRED" });
    });

    it("T-AC-41 refuses a suspended project", async () => {
      const { preparation } = await verifiedRestore();
      const before = await sourceEpoch();
      const current = await project();
      await fixture.infrastructure.lifecycle.suspend(
        fixture.freshOwner(),
        current.id,
        { expectedRevision: current.revision, reason: "Pause before activation" },
        randomUUID(),
      );
      expect(
        (
          await fixture.infrastructure.recovery.assessActivation(
            fixture.freshOwner(),
            preparation.environmentId,
          )
        ).reasons,
      ).toContain("PROJECT_NOT_ACTIVE");
      await expect(
        activate(preparation.environmentId, await confirmation(preparation.environmentId)),
      ).rejects.toMatchObject({ code: "ACTIVATION_BLOCKED" });
      await expectUntouched(preparation, before);
    });
  });

  describe("an uncertain promotion never designates the restore", () => {
    it("T-AC-41 accepts a lost promotion acknowledgment only after independent physical proof", async () => {
      const { preparation } = await verifiedRestore();
      fixture.recoveryProvider.lostAcknowledgments.add("promote");
      const activation = await activate(
        preparation.environmentId,
        await confirmation(preparation.environmentId),
      );
      expect(activation.state).toBe("activated");
      expect(fixture.recoveryProvider.effects.filter((e) => e.action === "promote")).toHaveLength(
        1,
      );
    });

    it("T-AC-41 leaves both environments held when the provider proves nothing, then resumes without refencing", async () => {
      const { preparation } = await verifiedRestore();
      fixture.recoveryProvider.beforeAction = async (action) => {
        if (action === "promote") throw new Error("Fixture promotion refused");
      };
      const input = await confirmation(preparation.environmentId);
      const first = await activate(preparation.environmentId, input);
      expect(first).toMatchObject({ state: "unknown", reason: "PROMOTION_UNPROVEN" });
      expect(await kinds(preparation.environmentId, fixture.development.id)).toEqual([
        { kind: "recovery", recoveryHold: true },
        { kind: "development", recoveryHold: true },
      ]);
      const fenced = await sourceEpoch();
      expect(
        await fixture.infrastructure.recovery.assessActivation(
          fixture.freshOwner(),
          preparation.environmentId,
        ),
      ).toMatchObject({ activation: "ready", pending: "unknown" });
      fixture.recoveryProvider.beforeAction = undefined;
      const resumed = await activate(
        preparation.environmentId,
        await confirmation(preparation.environmentId),
      );
      expect(resumed).toMatchObject({ id: first.id, state: "activated", epoch: first.epoch });
      expect(await sourceEpoch()).toBe(fenced);
      expect(await kinds(preparation.environmentId, fixture.development.id)).toEqual([
        { kind: "development", recoveryHold: false },
        { kind: "recovery", recoveryHold: true },
      ]);
    });

    it.each([
      [
        "allocation",
        (value: { allocationId: string }) => Object.assign(value, { allocationId: randomUUID() }),
      ],
      [
        "recovery state",
        (value: { inRecovery: boolean }) => Object.assign(value, { inRecovery: true }),
      ],
      [
        "runtime access",
        (value: { runtimeAccessBlocked: boolean }) =>
          Object.assign(value, { runtimeAccessBlocked: true }),
      ],
      [
        "scope",
        (value: { scopeHash: string }) => Object.assign(value, { scopeHash: "f".repeat(64) }),
      ],
    ])("T-AC-41 rejects a promotion proof with a foreign %s", async (_label, tamper) => {
      const { preparation } = await verifiedRestore();
      fixture.recoveryProvider.promotionResult = (result) =>
        tamper(result as never) as typeof result;
      const activation = await activate(
        preparation.environmentId,
        await confirmation(preparation.environmentId),
      );
      expect(activation.state).toBe("unknown");
      expect(await kinds(preparation.environmentId)).toEqual([
        { kind: "recovery", recoveryHold: true },
      ]);
    });

    it("T-AC-40 refuses to finish when the activation epoch moved while the provider worked", async () => {
      const { preparation } = await verifiedRestore();
      fixture.recoveryProvider.afterAction = async (action) => {
        if (action === "promote")
          await fixture.store.db
            .update(schema.activationEpochs)
            .set({ epoch: 99 })
            .where(eq(schema.activationEpochs.environmentId, fixture.development.id));
      };
      const activation = await activate(
        preparation.environmentId,
        await confirmation(preparation.environmentId),
      );
      expect(activation).toMatchObject({ state: "unknown", reason: "FENCED" });
      expect(await kinds(preparation.environmentId)).toEqual([
        { kind: "recovery", recoveryHold: true },
      ]);
    });
  });

  it("T-AC-40 keeps backup status readable after the source environment is fenced", async () => {
    const { preparation } = await verifiedRestore();
    await activate(preparation.environmentId, await confirmation(preparation.environmentId));
    const overview = await fixture.infrastructure.recovery.overview(fixture.freshOwner());
    expect(overview.activation).toBe("owner-confirmed");
    expect(overview.backups.length).toBeGreaterThan(0);
  });
});
