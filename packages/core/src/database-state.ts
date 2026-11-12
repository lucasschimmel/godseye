import {
  DatabaseAllocation,
  DatabasePreparation,
  type DatabasePreparationView,
} from "@godseye/contracts";
import { type DatabaseAccess, type Store, schema } from "@godseye/store";
import { eq } from "drizzle-orm";
import { compileDatabaseProfile } from "./database-policy.js";
import type { DatabaseProvider, DatabaseQualification } from "./database-provider.js";
import { DomainError } from "./errors.js";
import { assertFresh, environmentFor, foundationState } from "./foundation-data.js";
import type { FoundationEngine } from "./foundations.js";
import {
  databaseCapacity,
  inventoryFor,
  observationReasons,
  validateEnvironmentCapacity,
  validatePoolCapacity,
} from "./infra-state.js";
import { fingerprint } from "./journal.js";
import type { Actor } from "./policy.js";

export const DATABASE_ADAPTER_ID = "local.database";
export const DATABASE_DESTINATION = "database.private";
export interface DatabaseState {
  store: Store;
  now: () => Date;
  foundation: FoundationEngine;
  provider?: DatabaseProvider;
  qualification?: DatabaseQualification | null;
}
export const freshDatabaseOwner = (state: DatabaseState, actor: Actor) =>
  assertFresh(actor, foundationState(state.store, { now: state.now }));
export const databasePreparationView = (
  row: typeof schema.databasePreparations.$inferSelect,
): DatabasePreparationView =>
  DatabasePreparation.parse({
    id: row.id,
    allocationId: row.allocationId,
    projectId: row.projectId,
    environmentId: row.environmentId,
    expectedProjectRevision: row.expectedProjectRevision,
    expectedEnvironmentRevision: row.expectedEnvironmentRevision,
    profile: row.profile,
    policyVersion: row.policyVersion,
    hash: row.hash,
    createdAt: row.createdAt.toISOString(),
  });
export const databaseAllocationView = (row: typeof schema.databaseAllocations.$inferSelect) =>
  DatabaseAllocation.parse({
    id: row.id,
    preparationId: row.preparationId,
    projectId: row.projectId,
    environmentId: row.environmentId,
    runId: row.runId,
    state: row.state,
    requestedState: row.requestedState,
    generation: row.generation,
    reason: row.reason,
    updatedAt: row.updatedAt.toISOString(),
  });
export const compiledDatabase = (row: typeof schema.databasePreparations.$inferSelect) =>
  compileDatabaseProfile(row.profile, {
    allocationId: row.allocationId,
    projectId: row.projectId,
    environmentId: row.environmentId,
  });
export function databasePreparationHash(
  row: Omit<typeof schema.databasePreparations.$inferSelect, "id" | "hash" | "createdAt">,
) {
  return fingerprint({
    compiled: compiledDatabase({ ...row, id: row.allocationId, hash: "", createdAt: new Date(0) }),
    projectRevision: row.expectedProjectRevision,
    environmentRevision: row.expectedEnvironmentRevision,
    binding: row.binding,
    inventoryRevision: row.inventoryRevision,
    observationRevision: row.observationRevision,
  });
}
export async function databasePreparationFor(tx: DatabaseAccess, id: string) {
  const [row] = await tx
    .select()
    .from(schema.databasePreparations)
    .where(eq(schema.databasePreparations.id, id));
  if (!row) throw new DomainError("NOT_FOUND", "Database preparation not found", 404);
  if (databasePreparationHash(row) !== row.hash)
    throw new DomainError("PLAN_TAMPERED", "Database preparation digest differs", 409);
  return row;
}
export function assertDatabaseQualification(
  state: DatabaseState,
  proof: DatabaseQualification | null,
) {
  const binding = state.provider?.binding,
    now = state.now().getTime();
  if (
    !proof ||
    !binding ||
    fingerprint(binding) !==
      fingerprint({
        providerId: proof.providerId,
        targetId: proof.targetId,
        version: proof.version,
        generation: proof.generation,
      }) ||
    !proof.independentInstances ||
    !proof.persistentQuota ||
    !proof.privateNetwork ||
    !proof.tlsIdentity ||
    !proof.evidence?.trim() ||
    !Number.isFinite(Date.parse(proof.observedAt)) ||
    Date.parse(proof.observedAt) > now ||
    !Number.isFinite(Date.parse(proof.expiresAt)) ||
    Date.parse(proof.expiresAt) <= now ||
    Date.parse(proof.expiresAt) - Date.parse(proof.observedAt) > 300000
  )
    throw new DomainError(
      "CAPABILITY_UNAVAILABLE",
      "Fresh independently qualified database provider is required",
      503,
    );
}
export async function qualifyDatabase(state: DatabaseState) {
  const proof = state.provider ? structuredClone(await state.provider.qualification()) : null;
  assertDatabaseQualification(state, proof);
  state.qualification = proof;
  return proof;
}
export async function validateDatabasePreparation(
  state: DatabaseState,
  tx: DatabaseAccess,
  id: string,
  actor: Actor,
  existingId?: string,
  intent = "provision",
  readOnlyReconciliation = false,
  promoteReadiness = false,
) {
  const row = await databasePreparationFor(tx, id),
    env = await environmentFor(tx, actor, row.projectId, row.environmentId);
  const [project] = await tx
    .select()
    .from(schema.projects)
    .where(eq(schema.projects.id, row.projectId));
  if (
    (!readOnlyReconciliation || promoteReadiness) &&
    (project?.revision !== row.expectedProjectRevision ||
      env.revision !== row.expectedEnvironmentRevision)
  )
    throw new DomainError(
      "REVISION_CONFLICT",
      "Project or environment changed after preparation",
      409,
    );
  if (
    (!readOnlyReconciliation || promoteReadiness) &&
    intent !== "suspend" &&
    env.expiresAt &&
    env.expiresAt.getTime() <= state.now().getTime()
  )
    throw new DomainError("ENVIRONMENT_EXPIRED", "Preview has expired", 409);
  if (fingerprint(row.binding) !== fingerprint(state.provider?.binding ?? null))
    throw new DomainError(
      "CAPABILITY_UNAVAILABLE",
      "Database provider generation differs from preparation",
      503,
    );
  const inventory = await inventoryFor(tx);
  if (
    !inventory.desired ||
    !inventory.observation ||
    (intent !== "suspend" && observationReasons(inventory.observation, state.now()).length)
  )
    throw new DomainError(
      "CAPABILITY_UNAVAILABLE",
      "Fresh qualified professional capacity is required",
      503,
    );
  if (inventory.observation.providerBinding?.targetId !== state.provider?.binding.targetId)
    throw new DomainError(
      "CAPABILITY_UNAVAILABLE",
      "Database provider is outside the observed professional target",
      503,
    );
  if (
    inventory.revision !== row.inventoryRevision ||
    (!readOnlyReconciliation && inventory.observationRevision !== row.observationRevision)
  )
    throw new DomainError(
      "OBSERVATION_CHANGED",
      "Inventory changed after database preparation",
      409,
    );
  if ((!readOnlyReconciliation || promoteReadiness) && intent !== "suspend")
    await validatePoolCapacity(
      tx,
      inventory.desired,
      inventory.observation,
      databaseCapacity(row.profile),
      existingId,
    );
  if ((!readOnlyReconciliation || promoteReadiness) && intent !== "suspend")
    await validateEnvironmentCapacity(tx, env.id, databaseCapacity(row.profile), existingId);
  return row;
}
