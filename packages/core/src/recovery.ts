import type {
  AdmitRecoveryInput,
  ExecutionContext,
  PrepareArchiveCheckInput,
  PrepareBackupInput,
  PrepareRestoreInput,
} from "@godseye/contracts";
import { RecoveryBackup } from "@godseye/contracts";
import { type DatabaseAccess, type Store, schema } from "@godseye/store";
import { eq } from "drizzle-orm";
import { DomainError } from "./errors.js";
import { currentEpoch, environmentFor } from "./foundation-data.js";
import type { FoundationEngine } from "./foundations.js";
import { type Actor, assertOwner } from "./policy.js";
import { admitRecovery, reserveRecovery } from "./recovery-admission.js";
import { executeRecovery } from "./recovery-execution.js";
import { prepareArchiveCheck, prepareBackup, prepareRestore } from "./recovery-preparation.js";
import type { RecoveryMetadata, RecoveryProvider } from "./recovery-provider.js";
import {
  qualifyRecovery,
  RECOVERY_ADAPTER_ID,
  type RecoveryState,
  recoveryPreparationView,
  recoveryRunView,
  recoveryScope,
} from "./recovery-state.js";

export * from "./recovery-material.js";
export * from "./recovery-pgbackrest-info.js";
export * from "./recovery-pgbackrest-policy.js";
export * from "./recovery-pgbackrest-provider.js";
export * from "./recovery-postgres-policy.js";
export * from "./recovery-provider.js";
export { RECOVERY_ADAPTER_ID, RECOVERY_DESTINATION } from "./recovery-state.js";
/** Recovery composes the existing Foundation queue and its exact private execution authority. */
export class RecoveryEngine {
  private state!: RecoveryState;
  constructor(
    private readonly store: Store,
    private readonly options: { now: () => Date; provider?: RecoveryProvider },
  ) {}
  bind(foundation: FoundationEngine) {
    this.state = {
      store: this.store,
      now: this.options.now,
      provider: this.options.provider,
      foundation,
      qualifications: new Map(),
    };
  }
  get adapter() {
    const self = this;
    return {
      id: RECOVERY_ADAPTER_ID,
      get qualified() {
        return !!self.options.provider;
      },
      execute: (context: ExecutionContext) => executeRecovery(self.state, context),
      reconcile: (context: ExecutionContext) => executeRecovery(self.state, context, true),
    };
  }
  prepareBackup(actor: Actor, input: PrepareBackupInput, key: string) {
    return prepareBackup(this.state, actor, input, key);
  }
  prepareArchiveCheck(actor: Actor, input: PrepareArchiveCheckInput, key: string) {
    return prepareArchiveCheck(this.state, actor, input, key);
  }
  prepareRestore(actor: Actor, input: PrepareRestoreInput, key: string) {
    return prepareRestore(this.state, actor, input, key);
  }
  admit(actor: Actor, input: AdmitRecoveryInput, key: string) {
    return admitRecovery(this.state, actor, input, key);
  }
  reserve(
    tx: DatabaseAccess,
    plan: typeof schema.executionPlans.$inferSelect,
    runId: string,
    actor: Actor,
  ) {
    return reserveRecovery(this.state, tx, plan, runId, actor);
  }
  async releaseQueued(tx: DatabaseAccess, runId: string) {
    const [step] = await tx
      .select()
      .from(schema.recoverySteps)
      .where(eq(schema.recoverySteps.runId, runId));
    if (step)
      throw new DomainError(
        "RECONCILIATION_REQUIRED",
        "Physical recovery intention retains reservations",
        409,
      );
    await tx
      .update(schema.recoveryRuns)
      .set({ state: "released", updatedAt: this.options.now() })
      .where(eq(schema.recoveryRuns.runId, runId));
  }
  async settlement(tx: DatabaseAccess, runId: string, status: string) {
    const [row] = await tx
      .select()
      .from(schema.recoveryRuns)
      .where(eq(schema.recoveryRuns.runId, runId));
    if (!row) return;
    await tx
      .update(schema.recoveryRuns)
      .set({
        state:
          status === "succeeded" && row.evidence
            ? row.kind === "restore"
              ? "restore-verified"
              : row.kind === "check"
                ? "archive-checked"
                : "backup-created"
            : "unknown",
        updatedAt: this.options.now(),
      })
      .where(eq(schema.recoveryRuns.id, row.id));
  }
  async uncertainty(tx: DatabaseAccess, runId: string) {
    await tx
      .update(schema.recoveryRuns)
      .set({ state: "unknown", reason: "RECONCILIATION_REQUIRED", updatedAt: this.options.now() })
      .where(eq(schema.recoveryRuns.runId, runId));
  }
  async overview(actor: Actor) {
    assertOwner(actor);
    const preparations = await this.store.db.select().from(schema.recoveryPreparations);
    const runs = await this.store.db.select().from(schema.recoveryRuns);
    const backups = await this.store.db.select().from(schema.recoveryBackups);
    let execution: "qualified" | "unconfigured" = "unconfigured";
    for (const preparation of preparations.slice(-1)) {
      try {
        await qualifyRecovery(
          this.state,
          await recoveryScope(
            this.store.db,
            preparation,
            await currentEpoch(this.store.db, preparation.sourceEnvironmentId),
          ),
        );
        execution = "qualified";
      } catch (error) {
        if (!(error instanceof DomainError)) throw error;
      }
    }
    return {
      execution,
      activation: "blocked" as const,
      schedule: "prepared-only" as const,
      preparations: preparations.map(recoveryPreparationView),
      runs: runs.map(recoveryRunView),
      backups: backups.map((row) => {
        const metadata = row.metadata as unknown as RecoveryMetadata;
        const policy = preparations.find((item) => item.id === row.preparationId)?.policy;
        const stale =
          !policy ||
          this.options.now().getTime() - Date.parse(metadata.archiveCheckedAt) >
            policy.maxArchiveAgeSeconds * 1000;
        return RecoveryBackup.parse({
          id: row.id,
          preparationId: row.preparationId,
          projectId: row.projectId,
          environmentId: row.environmentId,
          sourceAllocationId: row.sourceAllocationId,
          kind: row.kind,
          status:
            execution !== "qualified"
              ? "unavailable"
              : stale
                ? "stale"
                : row.verifiedAt
                  ? "restore-verified"
                  : metadata.archiveContinuous
                    ? "archive-healthy"
                    : "backup-created",
          createdAt: row.createdAt.toISOString(),
          verifiedAt: row.verifiedAt?.toISOString() ?? null,
          archiveCheckedAt: metadata.archiveCheckedAt,
          recoverableFrom: metadata.archiveContinuous ? metadata.recoverableFrom : null,
          recoverableTo: metadata.archiveContinuous ? metadata.recoverableTo : null,
          coverage: {
            databaseAt: metadata.completedAt,
            filesAt: null,
            authAt: null,
            configAt: null,
            missing: ["files", "auth", "config", "effect-history", "producer-fencing"],
          },
          reason:
            execution !== "qualified" ? "PROVIDER_UNAVAILABLE" : stale ? "ARCHIVE_STALE" : null,
        });
      }),
    };
  }
  async assessActivation(actor: Actor, environmentId: string) {
    assertOwner(actor);
    const [env] = await this.store.db
      .select()
      .from(schema.environments)
      .where(eq(schema.environments.id, environmentId));
    if (!env) throw new DomainError("NOT_FOUND", "Recovery environment not found", 404);
    await environmentFor(this.store.db, actor, env.projectId, env.id, true);
    if (!env.recoveryHold)
      throw new DomainError("RECOVERY_HOLD", "Environment is not held for recovery", 409);
    return {
      environmentId,
      recoveryHold: true as const,
      activation: "blocked" as const,
      reasons: [
        "PRODUCER_FENCING_UNQUALIFIED",
        "NON_REWOUND_BUSINESS_EFFECT_COVERAGE_UNQUALIFIED",
        "FILES_SNAPSHOT_MISSING",
        "AUTH_SNAPSHOT_MISSING",
        "CONFIG_SNAPSHOT_MISSING",
        "RUNTIME_ACCESS_UNQUALIFIED",
      ],
    };
  }
}
