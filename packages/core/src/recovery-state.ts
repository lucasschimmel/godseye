import { RecoveryPreparation, RecoveryRun } from "@godseye/contracts";
import { type DatabaseAccess, type Store, schema } from "@godseye/store";
import { eq } from "drizzle-orm";
import type { DatabaseProviderScope } from "./database-provider.js";
import { compiledDatabase, databasePreparationFor } from "./database-state.js";
import { DomainError } from "./errors.js";
import { assertFresh, environmentFor, foundationState } from "./foundation-data.js";
import type { FoundationEngine } from "./foundations.js";
import { immutableSnapshot } from "./infra-policy.js";
import { inventoryFor, observationReasons, validatePoolCapacity } from "./infra-state.js";
import { fingerprint } from "./journal.js";
import type { Actor } from "./policy.js";
import { recoveryAdditionalCapacity } from "./recovery-capacity.js";
import type {
  RecoveryMetadata,
  RecoveryProvider,
  RecoveryQualification,
  RecoveryScope,
} from "./recovery-provider.js";
export const RECOVERY_ADAPTER_ID = "local.recovery";
export const RECOVERY_DESTINATION = "recovery.private";
export interface RecoveryState {
  store: Store;
  now: () => Date;
  foundation: FoundationEngine;
  provider?: RecoveryProvider;
  qualifications: Map<string, RecoveryQualification>;
}
export const recoveryFresh = (state: RecoveryState, actor: Actor) =>
  assertFresh(actor, foundationState(state.store, { now: state.now }));
export type RecoveryPreparationRow = typeof schema.recoveryPreparations.$inferSelect;
export const recoveryPreparationView = (row: RecoveryPreparationRow) =>
  RecoveryPreparation.parse({
    id: row.id,
    projectId: row.projectId,
    sourceEnvironmentId: row.sourceEnvironmentId,
    sourceAllocationId: row.sourceAllocationId,
    environmentId: row.environmentId,
    allocationId: row.allocationId,
    kind: row.kind,
    backupId: row.backupId,
    targetTime: row.targetTime,
    name: row.name,
    expectedProjectRevision: row.expectedProjectRevision,
    expectedEnvironmentRevision: row.expectedEnvironmentRevision,
    policy: row.policy,
    policyVersion: row.policyVersion,
    hash: row.hash,
    createdAt: row.createdAt.toISOString(),
  });
export const recoveryRunView = (row: typeof schema.recoveryRuns.$inferSelect) =>
  RecoveryRun.parse({
    id: row.id,
    preparationId: row.preparationId,
    runId: row.runId,
    projectId: row.projectId,
    environmentId: row.environmentId,
    allocationId: row.allocationId,
    kind: row.kind,
    state: row.state,
    recoveryHold: row.kind === "restore",
    reason: row.reason,
    updatedAt: row.updatedAt.toISOString(),
  });
export const recoveryPreparationHash = (
  row: Omit<RecoveryPreparationRow, "hash"> & { hash?: string },
) => {
  const { id: _id, createdAt: _at, hash: _hash, ...content } = row;
  return fingerprint(content);
};
export async function recoveryPreparationFor(tx: DatabaseAccess, id: string) {
  const [row] = await tx
    .select()
    .from(schema.recoveryPreparations)
    .where(eq(schema.recoveryPreparations.id, id));
  if (!row) throw new DomainError("NOT_FOUND", "Recovery preparation not found", 404);
  const { hash, ...content } = row;
  if (recoveryPreparationHash(content) !== hash)
    throw new DomainError("PLAN_TAMPERED", "Recovery preparation digest differs", 409);
  return row;
}
export async function recoverySource(
  tx: DatabaseAccess,
  actor: Actor,
  projectId: string,
  environmentId: string,
  allocationId: string,
) {
  const env = await environmentFor(tx, actor, projectId, environmentId);
  const [allocation] = await tx
    .select()
    .from(schema.databaseAllocations)
    .where(eq(schema.databaseAllocations.id, allocationId));
  if (
    !allocation ||
    allocation.projectId !== projectId ||
    allocation.environmentId !== env.id ||
    allocation.state !== "ready" ||
    !allocation.systemIdentifier ||
    !allocation.verifiedScope ||
    !allocation.providerRef
  )
    throw new DomainError(
      "SOURCE_UNAVAILABLE",
      "Exact verified running source allocation is required",
      409,
    );
  const preparation = await databasePreparationFor(tx, allocation.preparationId);
  const catalog = compiledDatabase(preparation);
  const scope = allocation.verifiedScope as unknown as DatabaseProviderScope;
  if (
    scope.allocationId !== allocation.id ||
    scope.environmentId !== env.id ||
    scope.projectId !== projectId ||
    scope.preparationHash !== preparation.hash
  )
    throw new DomainError("SOURCE_UNAVAILABLE", "Source physical lineage is inconsistent", 409);
  const hash = fingerprint({
    id: allocation.id,
    systemIdentifier: allocation.systemIdentifier,
    scope,
    catalog,
    providerRef: allocation.providerRef,
  });
  return { env, allocation, catalog, scope, hash };
}
export async function recoveryScope(
  tx: DatabaseAccess,
  row: RecoveryPreparationRow,
  epoch: number,
): Promise<RecoveryScope> {
  const source = await recoverySource(
    tx,
    { id: "recovery", kind: "service", projectIds: [row.projectId] },
    row.projectId,
    row.sourceEnvironmentId,
    row.sourceAllocationId,
  );
  if (source.hash !== row.sourceHash)
    throw new DomainError("SOURCE_CHANGED", "Source physical scope changed", 409);
  let backup: RecoveryMetadata | null = null;
  if (row.backupId) {
    const [item] = await tx
      .select()
      .from(schema.recoveryBackups)
      .where(eq(schema.recoveryBackups.id, row.backupId));
    if (
      !item ||
      item.projectId !== row.projectId ||
      item.sourceAllocationId !== row.sourceAllocationId ||
      item.repositoryId !== row.repositoryId
    )
      throw new DomainError("FORBIDDEN", "Backup lineage differs from the preparation", 403);
    if (!row.backupSnapshot)
      throw new DomainError("PLAN_TAMPERED", "Recovery backup snapshot is missing", 409);
    backup = row.backupSnapshot as unknown as RecoveryMetadata;
  }
  return immutableSnapshot({
    preparationId: row.id,
    preparationHash: row.hash,
    projectId: row.projectId,
    sourceEnvironmentId: row.sourceEnvironmentId,
    sourceAllocationId: row.sourceAllocationId,
    repositoryId: row.repositoryId,
    environmentId: row.environmentId,
    allocationId: row.allocationId,
    epoch,
    kind: row.kind,
    policy: row.policy,
    sourceScope: source.scope,
    sourceCatalog: source.catalog,
    sourceSystemIdentifier: source.allocation.systemIdentifier ?? "",
    backup,
    targetTime: row.targetTime,
  });
}
export function assertRecoveryQualification(
  state: RecoveryState,
  scope: RecoveryScope,
  proof: RecoveryQualification | null,
) {
  const now = state.now().getTime();
  if (
    !proof ||
    !state.provider ||
    proof.scopeHash !== fingerprint(scope) ||
    fingerprint(state.provider.binding) !==
      fingerprint({
        providerId: proof.providerId,
        targetId: proof.targetId,
        version: proof.version,
        generation: proof.generation,
      }) ||
    proof.encryptedRepository !== true ||
    proof.independentRepository !== true ||
    proof.capacityEnforced !== true ||
    proof.privateNetwork !== true ||
    proof.isolatedRestore !== true ||
    !proof.evidence?.trim() ||
    !Number.isFinite(Date.parse(proof.observedAt)) ||
    Date.parse(proof.observedAt) > now ||
    !Number.isFinite(Date.parse(proof.expiresAt)) ||
    Date.parse(proof.expiresAt) <= now ||
    Date.parse(proof.expiresAt) - Date.parse(proof.observedAt) > 300000
  )
    throw new DomainError(
      "CAPABILITY_UNAVAILABLE",
      "Exact fresh independently qualified recovery provider is required",
      503,
    );
}
export async function qualifyRecovery(state: RecoveryState, scope: RecoveryScope) {
  let proof: RecoveryQualification | null;
  try {
    proof = state.provider ? immutableSnapshot(await state.provider.qualification(scope)) : null;
  } catch {
    throw new DomainError(
      "CAPABILITY_UNAVAILABLE",
      "Recovery provider qualification is unavailable",
      503,
    );
  }
  assertRecoveryQualification(state, scope, proof);
  if (proof) state.qualifications.set(scope.preparationId, proof);
  return proof;
}
export async function validateRecovery(
  state: RecoveryState,
  tx: DatabaseAccess,
  row: RecoveryPreparationRow,
  actor: Actor,
  existingId?: string,
  reconcile = false,
) {
  const env = await environmentFor(tx, actor, row.projectId, row.sourceEnvironmentId);
  const [project] = await tx
    .select()
    .from(schema.projects)
    .where(eq(schema.projects.id, row.projectId));
  if (
    !reconcile &&
    (project?.revision !== row.expectedProjectRevision ||
      env.revision !== row.expectedEnvironmentRevision)
  )
    throw new DomainError("REVISION_CONFLICT", "Project or source environment changed", 409);
  if (fingerprint(row.binding) !== fingerprint(state.provider?.binding ?? null))
    throw new DomainError("CAPABILITY_UNAVAILABLE", "Recovery provider binding changed", 503);
  const inventory = await inventoryFor(tx);
  if (
    !inventory.desired ||
    !inventory.observation ||
    observationReasons(inventory.observation, state.now()).length ||
    inventory.observation.providerBinding?.targetId !== state.provider?.binding.targetId ||
    inventory.revision !== row.inventoryRevision ||
    (!reconcile && inventory.observationRevision !== row.observationRevision)
  )
    throw new DomainError(
      "CAPABILITY_UNAVAILABLE",
      "Exact fresh professional pool capacity is required",
      503,
    );
  if (row.kind === "restore") {
    const target = await environmentFor(tx, actor, row.projectId, row.environmentId, true);
    if (
      target.kind !== "recovery" ||
      !target.recoveryHold ||
      target.expiresAt ||
      target.id === env.id ||
      target.revision !== 0 ||
      target.name !== row.name
    )
      throw new DomainError("RECOVERY_HOLD", "Destination recovery hold changed", 409);
  }
  const scope = await recoveryScope(tx, row, 1);
  if (!reconcile)
    await validatePoolCapacity(
      tx,
      inventory.desired,
      inventory.observation,
      await recoveryAdditionalCapacity(tx, row, existingId),
      existingId,
    );
  return scope;
}
