import type { MigrationBindingView } from "@godseye/contracts";
import { type DatabaseAccess, schema } from "@godseye/store";
import { and, eq, inArray } from "drizzle-orm";
import type { DeliveryManifest } from "./delivery-provider.js";
import { DomainError } from "./errors.js";

type RunRow = typeof schema.deliveryRuns.$inferSelect;
const BLOCKING_STATES = ["active", "retired", "staged", "unknown", "quarantined"];
/** The previous image still runs on the migrated schema only for these classes. */
export const migrationBackwardCompatible = (migration: MigrationBindingView | null | undefined) =>
  !migration || migration.class === "none" || migration.class === "compatible";
/** Only a release that declared a schema change takes the serialized environment migration lane. */
export const migrationNeedsLock = (manifest: DeliveryManifest) =>
  manifest.intent === "release" && !!manifest.migration && manifest.migration.class !== "none";
export const migrationNeedsApproval = (manifest: DeliveryManifest) =>
  manifest.intent === "release" && manifest.migration?.class === "destructive";

/** Admission-time promotion gate: destructive migrations require the exact hash from a fresh owner. */
export function assertMigrationAdmission(
  manifest: DeliveryManifest,
  approvedHash: string | undefined,
  delegated: boolean,
) {
  if (!migrationNeedsApproval(manifest)) {
    if (approvedHash)
      throw new DomainError(
        "MIGRATION_APPROVAL_UNEXPECTED",
        "Migration approval was supplied for a delivery that declares no destructive migration",
        422,
      );
    return;
  }
  if (delegated || approvedHash !== manifest.migration?.hash)
    throw new DomainError(
      "MIGRATION_APPROVAL_REQUIRED",
      "A destructive or incompatible migration requires fresh exact owner approval of its hash",
      409,
    );
}
export async function recordMigrationApproval(
  tx: DatabaseAccess,
  planId: string,
  preparationId: string,
  manifest: DeliveryManifest,
  now: Date,
) {
  if (!migrationNeedsApproval(manifest) || !manifest.migration) return;
  await tx
    .insert(schema.deliveryMigrationApprovals)
    .values({ planId, preparationId, migrationHash: manifest.migration.hash, approvedAt: now })
    .onConflictDoNothing();
}
/** Re-checked at reservation and at every dispatch; a missing or different approval fences the run. */
export async function assertMigrationApproved(
  tx: DatabaseAccess,
  planId: string,
  manifest: DeliveryManifest,
) {
  if (!migrationNeedsApproval(manifest)) return;
  const [approval] = await tx
    .select()
    .from(schema.deliveryMigrationApprovals)
    .where(eq(schema.deliveryMigrationApprovals.planId, planId));
  const [command] = await tx
    .select()
    .from(schema.deliveryCommands)
    .where(eq(schema.deliveryCommands.planId, planId));
  if (
    !approval ||
    approval.migrationHash !== manifest.migration?.hash ||
    approval.preparationId !== manifest.preparationId ||
    command?.authority !== "owner"
  )
    throw new DomainError(
      "MIGRATION_APPROVAL_REQUIRED",
      "Destructive migration lacks its exact owner approval",
      409,
    );
}

export async function currentMigrationLock(tx: DatabaseAccess, environmentId: string) {
  const [row] = await tx
    .select()
    .from(schema.deliveryMigrationLocks)
    .where(eq(schema.deliveryMigrationLocks.environmentId, environmentId));
  return row;
}
/** Reservation refuses to queue behind a held or uncertain migration of another run. */
export async function assertMigrationLaneFree(tx: DatabaseAccess, manifest: DeliveryManifest) {
  if (manifest.intent === "cleanup" || manifest.intent === "build") return;
  const lock = await currentMigrationLock(tx, manifest.environmentId);
  if (lock && lock.state !== "released")
    throw new DomainError(
      "MIGRATION_LOCKED",
      "A migration of this environment is held or uncertain and must be reconciled first",
      409,
    );
}
export async function acquireMigrationLock(
  tx: DatabaseAccess,
  manifest: DeliveryManifest,
  delivery: Pick<RunRow, "runId" | "generation">,
  now: Date,
) {
  if (!migrationNeedsLock(manifest) || !manifest.migration || manifest.migration.class === "none")
    return;
  const lock = await currentMigrationLock(tx, manifest.environmentId);
  const sameHolder = lock?.runId === delivery.runId && lock.fence === delivery.generation;
  if (lock && lock.state !== "released" && !(sameHolder && lock.state === "held"))
    throw new DomainError("MIGRATION_LOCKED", "Environment migration lane is not free", 409);
  const values = {
    environmentId: manifest.environmentId,
    runId: delivery.runId,
    preparationId: manifest.preparationId,
    migrationClass: manifest.migration.class,
    migrationHash: manifest.migration.hash,
    fence: delivery.generation,
    state: "held" as const,
    updatedAt: now,
  };
  await tx
    .insert(schema.deliveryMigrationLocks)
    .values(values)
    .onConflictDoUpdate({ target: schema.deliveryMigrationLocks.environmentId, set: values });
}
/** Fenced check immediately before traffic selection: only the current holder may promote. */
export async function assertMigrationLockHeld(
  tx: DatabaseAccess,
  manifest: DeliveryManifest,
  delivery: Pick<RunRow, "runId" | "generation">,
) {
  if (!migrationNeedsLock(manifest)) return;
  const lock = await currentMigrationLock(tx, manifest.environmentId);
  if (
    lock?.state !== "held" ||
    lock.runId !== delivery.runId ||
    lock.fence !== delivery.generation ||
    lock.migrationHash !== manifest.migration?.hash
  )
    throw new DomainError("FENCED", "Migration lock is no longer held by this delivery", 409);
}
/** Terminal success or a proven no-effect failure frees the lane; an unknown outcome keeps it. */
export async function releaseMigrationLock(tx: DatabaseAccess, runId: string, now: Date) {
  await tx
    .update(schema.deliveryMigrationLocks)
    .set({ state: "released", updatedAt: now })
    .where(
      and(
        eq(schema.deliveryMigrationLocks.runId, runId),
        inArray(schema.deliveryMigrationLocks.state, ["held", "uncertain"]),
      ),
    );
}
export async function markMigrationUncertain(tx: DatabaseAccess, runId: string, now: Date) {
  await tx
    .update(schema.deliveryMigrationLocks)
    .set({ state: "uncertain", updatedAt: now })
    .where(
      and(
        eq(schema.deliveryMigrationLocks.runId, runId),
        eq(schema.deliveryMigrationLocks.state, "held"),
      ),
    );
}

/**
 * A prior image is rollback-eligible only when every release applied after it declared a
 * backward-compatible migration. Restoring data is a separate, separately authorized operation.
 */
export function rollbackMigrationBlocker(
  runs: RunRow[],
  migrationOf: (preparationId: string) => MigrationBindingView | null | undefined,
  prior: Pick<RunRow, "artifactId" | "generation" | "environmentId">,
) {
  const origins = runs.filter(
    (run) =>
      run.environmentId === prior.environmentId &&
      run.intent === "release" &&
      !!prior.artifactId &&
      run.artifactId === prior.artifactId,
  );
  const baseline = Math.min(prior.generation, ...origins.map((run) => run.generation));
  return (
    runs.find(
      (run) =>
        run.environmentId === prior.environmentId &&
        run.intent === "release" &&
        run.generation > baseline &&
        BLOCKING_STATES.includes(run.state) &&
        !migrationBackwardCompatible(migrationOf(run.preparationId)),
    ) ?? null
  );
}
export async function migrationBindingsByPreparation(tx: DatabaseAccess, environmentId?: string) {
  const rows = environmentId
    ? await tx
        .select()
        .from(schema.deliveryPreparations)
        .where(eq(schema.deliveryPreparations.environmentId, environmentId))
    : await tx.select().from(schema.deliveryPreparations);
  const map = new Map<string, MigrationBindingView | null>();
  for (const row of rows) {
    const value = (row.manifest as { migration?: MigrationBindingView | null }).migration;
    map.set(row.id, value ?? null);
  }
  return map;
}
export async function assertRollbackMigrationCompatible(
  tx: DatabaseAccess,
  prior: Pick<RunRow, "artifactId" | "generation" | "environmentId">,
) {
  const runs = await tx
    .select()
    .from(schema.deliveryRuns)
    .where(eq(schema.deliveryRuns.environmentId, prior.environmentId));
  const bindings = await migrationBindingsByPreparation(tx, prior.environmentId);
  if (rollbackMigrationBlocker(runs, (id) => bindings.get(id), prior))
    throw new DomainError(
      "MIGRATION_NOT_BACKWARD_COMPATIBLE",
      "A later release applied a migration the earlier image cannot tolerate; restore data explicitly instead",
      409,
    );
}
