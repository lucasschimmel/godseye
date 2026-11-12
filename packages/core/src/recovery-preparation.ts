import { randomUUID } from "node:crypto";
import {
  PrepareArchiveCheck,
  type PrepareArchiveCheckInput,
  PrepareBackup,
  type PrepareBackupInput,
  PrepareRestore,
  type PrepareRestoreInput,
  RECOVERY_POLICY_VERSION,
} from "@godseye/contracts";
import { schema } from "@godseye/store";
import { eq } from "drizzle-orm";
import { DomainError, parseInput } from "./errors.js";
import { foundationState, recordRequest, requestFor } from "./foundation-data.js";
import { immutableSnapshot } from "./infra-policy.js";
import { databaseCapacity, inventoryFor } from "./infra-state.js";
import { appendAudit, write } from "./journal.js";
import type { Actor } from "./policy.js";
import type { RecoveryMetadata } from "./recovery-provider.js";
import {
  type RecoveryPreparationRow,
  type RecoveryState,
  recoveryFresh,
  recoveryPreparationFor,
  recoveryPreparationHash,
  recoveryPreparationView,
  recoverySource,
} from "./recovery-state.js";

export async function prepareBackup(
  state: RecoveryState,
  actorInput: Actor,
  input: PrepareBackupInput,
  key: string,
) {
  const actor = immutableSnapshot(actorInput),
    data = parseInput(PrepareBackup, input);
  recoveryFresh(state, actor);
  return write(state.store, async (tx) => {
    const request = await requestFor(tx, actor, key, "recovery.prepare-backup", data);
    if (request.existing)
      return recoveryPreparationView(await recoveryPreparationFor(tx, request.existing.resourceId));
    const source = await recoverySource(
      tx,
      actor,
      data.projectId,
      data.environmentId,
      data.sourceAllocationId,
    );
    const [project] = await tx
      .select()
      .from(schema.projects)
      .where(eq(schema.projects.id, data.projectId));
    if (
      project?.revision !== data.expectedProjectRevision ||
      source.env.revision !== data.expectedEnvironmentRevision
    )
      throw new DomainError("REVISION_CONFLICT", "Project or source environment changed", 409);
    const inventory = await inventoryFor(tx);
    const row: RecoveryPreparationRow = {
      id: randomUUID(),
      projectId: data.projectId,
      sourceEnvironmentId: data.environmentId,
      sourceAllocationId: data.sourceAllocationId,
      environmentId: data.environmentId,
      allocationId: data.sourceAllocationId,
      kind: data.kind,
      backupId: null,
      backupSnapshot: null,
      targetTime: null,
      name: null,
      expectedProjectRevision: data.expectedProjectRevision,
      expectedEnvironmentRevision: data.expectedEnvironmentRevision,
      policy: data.policy,
      policyVersion: RECOVERY_POLICY_VERSION,
      hash: "",
      binding: state.provider?.binding ? { ...state.provider.binding } : null,
      sourceHash: source.hash,
      repositoryId: source.allocation.id,
      inventoryRevision: inventory.revision,
      observationRevision: inventory.observationRevision,
      createdAt: state.now(),
    };
    row.hash = recoveryPreparationHash(row);
    await persistPreparation(state, tx, actor, row, key, request.digest, "recovery.prepare-backup");
    return recoveryPreparationView(row);
  });
}
export async function prepareRestore(
  state: RecoveryState,
  actorInput: Actor,
  input: PrepareRestoreInput,
  key: string,
) {
  const actor = immutableSnapshot(actorInput),
    data = parseInput(PrepareRestore, input);
  recoveryFresh(state, actor);
  return write(state.store, async (tx) => {
    const request = await requestFor(tx, actor, key, "recovery.prepare-restore", data);
    if (request.existing)
      return recoveryPreparationView(await recoveryPreparationFor(tx, request.existing.resourceId));
    const [backup] = await tx
      .select()
      .from(schema.recoveryBackups)
      .where(eq(schema.recoveryBackups.id, data.backupId));
    if (
      !backup ||
      backup.projectId !== data.projectId ||
      backup.environmentId !== data.sourceEnvironmentId
    )
      throw new DomainError(
        "FORBIDDEN",
        "Backup is outside the exact source project and environment",
        403,
      );
    const original = await recoveryPreparationFor(tx, backup.preparationId);
    const source = await recoverySource(
      tx,
      actor,
      data.projectId,
      data.sourceEnvironmentId,
      backup.sourceAllocationId,
    );
    const [project] = await tx
      .select()
      .from(schema.projects)
      .where(eq(schema.projects.id, data.projectId));
    if (
      project?.revision !== data.expectedProjectRevision ||
      source.env.revision !== data.expectedEnvironmentRevision
    )
      throw new DomainError("REVISION_CONFLICT", "Project or source environment changed", 409);
    const metadata = backup.metadata as unknown as RecoveryMetadata;
    if (
      !metadata.archiveContinuous ||
      Date.parse(data.targetTime) < Date.parse(metadata.recoverableFrom) ||
      Date.parse(data.targetTime) > Date.parse(metadata.recoverableTo) ||
      Date.parse(data.targetTime) > state.now().getTime()
    )
      throw new DomainError(
        "ARCHIVE_UNAVAILABLE",
        "Target is outside the independently verified recovery interval",
        409,
      );
    const environments = await tx
      .select()
      .from(schema.environments)
      .where(eq(schema.environments.projectId, project.id));
    if (environments.length >= 20 || environments.some((env) => env.name === data.name))
      throw new DomainError(
        "ENVIRONMENT_LIMIT",
        "Recovery name is unavailable or environment limit reached",
        409,
      );
    const environmentId = randomUUID(),
      allocationId = randomUUID(),
      capacity = databaseCapacity(source.catalog.limits);
    await tx.insert(schema.environments).values({
      id: environmentId,
      projectId: project.id,
      name: data.name,
      kind: "recovery",
      recoveryHold: true,
      memoryMiB: capacity.memoryMiB,
      cpuMilliCores: capacity.cpuMilliCores,
      diskGiB: capacity.storageGiB,
    });
    await tx
      .update(schema.projects)
      .set({ revision: project.revision + 1, updatedAt: state.now() })
      .where(eq(schema.projects.id, project.id));
    const inventory = await inventoryFor(tx);
    const row: RecoveryPreparationRow = {
      ...original,
      id: randomUUID(),
      environmentId,
      allocationId,
      kind: "restore",
      backupId: backup.id,
      backupSnapshot: { ...backup.metadata },
      targetTime: data.targetTime,
      name: data.name,
      expectedProjectRevision: project.revision + 1,
      expectedEnvironmentRevision: source.env.revision,
      binding: state.provider?.binding ? { ...state.provider.binding } : null,
      sourceHash: source.hash,
      inventoryRevision: inventory.revision,
      observationRevision: inventory.observationRevision,
      createdAt: state.now(),
      hash: "",
    };
    row.hash = recoveryPreparationHash(row);
    await persistPreparation(
      state,
      tx,
      actor,
      row,
      key,
      request.digest,
      "recovery.prepare-restore",
    );
    return recoveryPreparationView(row);
  });
}
export async function prepareArchiveCheck(
  state: RecoveryState,
  actorInput: Actor,
  input: PrepareArchiveCheckInput,
  key: string,
) {
  const actor = immutableSnapshot(actorInput),
    data = parseInput(PrepareArchiveCheck, input);
  recoveryFresh(state, actor);
  return write(state.store, async (tx) => {
    const request = await requestFor(tx, actor, key, "recovery.prepare-check", data);
    if (request.existing)
      return recoveryPreparationView(await recoveryPreparationFor(tx, request.existing.resourceId));
    const [backup] = await tx
      .select()
      .from(schema.recoveryBackups)
      .where(eq(schema.recoveryBackups.id, data.backupId));
    if (
      !backup ||
      backup.projectId !== data.projectId ||
      backup.environmentId !== data.sourceEnvironmentId
    )
      throw new DomainError("FORBIDDEN", "Archive check backup is outside its source scope", 403);
    const original = await recoveryPreparationFor(tx, backup.preparationId);
    const source = await recoverySource(
      tx,
      actor,
      data.projectId,
      data.sourceEnvironmentId,
      backup.sourceAllocationId,
    );
    const [project] = await tx
      .select()
      .from(schema.projects)
      .where(eq(schema.projects.id, data.projectId));
    if (
      project?.revision !== data.expectedProjectRevision ||
      source.env.revision !== data.expectedEnvironmentRevision ||
      source.hash !== original.sourceHash
    )
      throw new DomainError("REVISION_CONFLICT", "Archive check source or revision changed", 409);
    const inventory = await inventoryFor(tx);
    const row: RecoveryPreparationRow = {
      ...original,
      id: randomUUID(),
      kind: "check",
      backupId: backup.id,
      backupSnapshot: { ...backup.metadata },
      environmentId: data.sourceEnvironmentId,
      allocationId: backup.sourceAllocationId,
      targetTime: null,
      name: null,
      expectedProjectRevision: data.expectedProjectRevision,
      expectedEnvironmentRevision: data.expectedEnvironmentRevision,
      binding: state.provider?.binding ? { ...state.provider.binding } : null,
      inventoryRevision: inventory.revision,
      observationRevision: inventory.observationRevision,
      createdAt: state.now(),
      hash: "",
    };
    row.hash = recoveryPreparationHash(row);
    await persistPreparation(state, tx, actor, row, key, request.digest, "recovery.prepare-check");
    return recoveryPreparationView(row);
  });
}
async function persistPreparation(
  state: RecoveryState,
  tx: import("@godseye/store").DatabaseAccess,
  actor: Actor,
  row: RecoveryPreparationRow,
  key: string,
  digest: string,
  kind: string,
) {
  await tx.insert(schema.recoveryPreparations).values(row);
  await tx.insert(schema.resources).values({
    id: row.id,
    projectId: row.projectId,
    environmentId: row.sourceEnvironmentId,
    kind: "manifest",
    name: `Recovery preparation ${row.hash.slice(0, 12)}`,
    createdAt: state.now(),
  });
  await recordRequest(
    tx,
    foundationState(state.store, { now: state.now }),
    key,
    digest,
    row.id,
    kind,
  );
  await appendAudit(
    tx,
    actor,
    row.projectId,
    "recovery.prepared",
    `Prepared ${row.kind}; exact source retained; destination remains held`,
  );
}
