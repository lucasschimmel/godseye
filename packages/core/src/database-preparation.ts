import { randomUUID } from "node:crypto";
import {
  AdmitDatabase,
  type AdmitDatabaseInput,
  DATABASE_POLICY_VERSION,
  PrepareDatabase,
  type PrepareDatabaseInput,
} from "@godseye/contracts";
import { type DatabaseAccess, schema } from "@godseye/store";
import { eq } from "drizzle-orm";
import {
  DATABASE_ADAPTER_ID,
  DATABASE_DESTINATION,
  type DatabaseState,
  databaseAllocationView,
  databasePreparationFor,
  databasePreparationHash,
  databasePreparationView,
  freshDatabaseOwner,
  qualifyDatabase,
  validateDatabasePreparation,
} from "./database-state.js";
import { DomainError, parseInput } from "./errors.js";
import {
  currentEpoch,
  environmentFor,
  foundationState,
  recordRequest,
  requestFor,
} from "./foundation-data.js";
import { immutableSnapshot } from "./infra-policy.js";
import { inventoryFor } from "./infra-state.js";
import { appendAudit, fingerprint, write } from "./journal.js";
import { type Actor, assertProjectAccess } from "./policy.js";

export async function prepareDatabase(
  state: DatabaseState,
  actorInput: Actor,
  input: PrepareDatabaseInput,
  key: string,
) {
  const actor = immutableSnapshot(actorInput),
    data = parseInput(PrepareDatabase, input);
  freshDatabaseOwner(state, actor);
  return write(state.store, async (tx) => {
    const env = await environmentFor(tx, actor, data.projectId, data.environmentId);
    const request = await requestFor(tx, actor, key, "database.prepare", data);
    if (request.existing)
      return databasePreparationView(await databasePreparationFor(tx, request.existing.resourceId));
    const [project] = await tx
      .select()
      .from(schema.projects)
      .where(eq(schema.projects.id, data.projectId));
    if (
      project?.revision !== data.expectedProjectRevision ||
      env.revision !== data.expectedEnvironmentRevision
    )
      throw new DomainError("REVISION_CONFLICT", "Project or environment has changed", 409);
    const retained = (
      await tx
        .select()
        .from(schema.databaseAllocations)
        .where(eq(schema.databaseAllocations.environmentId, env.id))
    ).find((row) => row.state !== "released");
    if (
      retained &&
      fingerprint((await databasePreparationFor(tx, retained.preparationId)).profile) !==
        fingerprint(data.profile)
    )
      throw new DomainError(
        "PROFILE_IMMUTABLE",
        "Existing instance requires its exact immutable physical profile",
        409,
      );
    if (!retained && env.expiresAt && env.expiresAt.getTime() <= state.now().getTime())
      throw new DomainError("ENVIRONMENT_EXPIRED", "Preview has expired", 409);
    const inventory = await inventoryFor(tx);
    const row = {
      id: randomUUID(),
      allocationId: retained?.id ?? randomUUID(),
      ...data,
      binding: state.provider?.binding ? { ...state.provider.binding } : null,
      inventoryRevision: inventory.revision,
      observationRevision: inventory.observationRevision,
      policyVersion: DATABASE_POLICY_VERSION,
      createdAt: state.now(),
      hash: "",
    };
    row.hash = databasePreparationHash(row);
    await tx.insert(schema.databasePreparations).values(row);
    await tx.insert(schema.resources).values({
      id: row.id,
      projectId: row.projectId,
      environmentId: row.environmentId,
      kind: "manifest",
      name: `Database preparation ${row.hash.slice(0, 12)}`,
      createdAt: state.now(),
    });
    await recordRequest(
      tx,
      foundationState(state.store, { now: state.now }),
      key,
      request.digest,
      row.id,
      "database.prepare",
    );
    await appendAudit(
      tx,
      actor,
      row.projectId,
      "database.prepared",
      `Prepared independent PostgreSQL profile ${row.hash}; no physical effect`,
    );
    return databasePreparationView(row);
  });
}
export async function admitDatabase(
  state: DatabaseState,
  actorInput: Actor,
  input: AdmitDatabaseInput,
  key: string,
) {
  const actor = immutableSnapshot(actorInput),
    data = parseInput(AdmitDatabase, input);
  freshDatabaseOwner(state, actor);
  const preparation = await databasePreparationFor(state.store.db, data.preparationId);
  assertProjectAccess(actor, preparation.projectId);
  if (preparation.hash !== data.expectedHash)
    throw new DomainError("PLAN_TAMPERED", "Admission requires the exact preparation hash", 409);
  const prefix = `database:${fingerprint({ actorId: actor.id, key, data })}`;
  const plan = await state.foundation.createPlan(
    actor,
    {
      projectId: preparation.projectId,
      environmentId: preparation.environmentId,
      targetId: preparation.id,
      expectedRevision: preparation.expectedProjectRevision,
      adapterId: DATABASE_ADAPTER_ID,
      command: {
        kind: "database.lifecycle",
        intent: data.intent,
        manifestRef: preparation.id,
        manifestHash: preparation.hash,
      },
      maxCostMicros: 0,
      tools: [`database.${data.intent}`],
      destinations: [DATABASE_DESTINATION],
    },
    `${prefix}:plan`,
  );
  await qualifyDatabase(state);
  freshDatabaseOwner(state, actor);
  await write(state.store, async (tx) => {
    const request = await requestFor(tx, actor, key, "database.admit", data);
    if (!request.existing) {
      await validateDatabasePreparation(
        state,
        tx,
        preparation.id,
        actor,
        data.intent === "provision" ? undefined : preparation.allocationId,
        data.intent,
      );
      const [allocation] = await tx
        .select()
        .from(schema.databaseAllocations)
        .where(eq(schema.databaseAllocations.id, preparation.allocationId));
      await tx.insert(schema.databaseCommands).values({
        planId: plan.id,
        preparationId: preparation.id,
        intent: data.intent,
        expectedGeneration: allocation?.generation ?? 0,
        epoch: await currentEpoch(tx, preparation.environmentId),
        previousScope: allocation?.verifiedScope ?? null,
      });
      await recordRequest(
        tx,
        foundationState(state.store, { now: state.now }),
        key,
        request.digest,
        preparation.id,
        "database.admit",
        false,
      );
    }
  });
  freshDatabaseOwner(state, actor);
  await state.foundation.approve(actor, plan.id, plan.hash, `${prefix}:approve`);
  await state.foundation.enqueue(actor, plan.id, `${prefix}:enqueue`);
  const [allocation] = await state.store.db
    .select()
    .from(schema.databaseAllocations)
    .where(eq(schema.databaseAllocations.id, preparation.allocationId));
  if (!allocation)
    throw new DomainError("JOURNAL_INCONSISTENT", "Database admission reservation is missing", 500);
  return databaseAllocationView(allocation);
}
/** Admission and all physical capacity claims are atomic with the single Foundation queue. */
export async function reserveDatabase(
  state: DatabaseState,
  tx: DatabaseAccess,
  plan: typeof schema.executionPlans.$inferSelect,
  runId: string,
  actor: Actor,
) {
  if (plan.adapterId !== DATABASE_ADAPTER_ID) return;
  freshDatabaseOwner(state, actor);
  const { assertDatabaseQualification } = await import("./database-state.js");
  const [command] = await tx
    .select()
    .from(schema.databaseCommands)
    .where(eq(schema.databaseCommands.planId, plan.id));
  if (
    !command ||
    plan.command.kind !== "database.lifecycle" ||
    command.preparationId !== plan.command.manifestRef ||
    command.intent !== plan.command.intent
  )
    throw new DomainError("FORBIDDEN", "Generic execution cannot bypass database admission", 403);
  assertDatabaseQualification(state, state.qualification ?? null);
  const preparation = await validateDatabasePreparation(
    state,
    tx,
    command.preparationId,
    actor,
    command.intent === "provision"
      ? undefined
      : (await databasePreparationFor(tx, command.preparationId)).allocationId,
    command.intent,
  );
  if (
    plan.command.manifestHash !== preparation.hash ||
    plan.projectId !== preparation.projectId ||
    plan.environmentId !== preparation.environmentId ||
    plan.targetId !== preparation.id ||
    plan.expectedRevision !== preparation.expectedProjectRevision ||
    fingerprint(plan.tools) !== fingerprint([`database.${command.intent}`]) ||
    fingerprint(plan.destinations) !== fingerprint([DATABASE_DESTINATION])
  )
    throw new DomainError("FORBIDDEN", "Database plan scope differs from admission", 403);
  if (command.epoch !== (await currentEpoch(tx, preparation.environmentId)))
    throw new DomainError("FENCED", "Database admission activation epoch changed", 409);
  const [existing] = await tx
    .select()
    .from(schema.databaseAllocations)
    .where(eq(schema.databaseAllocations.id, preparation.allocationId));
  if ((existing?.generation ?? 0) !== command.expectedGeneration)
    throw new DomainError("REVISION_CONFLICT", "Database allocation generation changed", 409);
  const base = {
    runId,
    requestedState: command.intent === "suspend" ? "suspended" : "ready",
    generation: command.expectedGeneration + 1,
    epoch: command.epoch,
    updatedAt: state.now(),
    reason: null,
  };
  if (command.intent === "provision") {
    const retained = await tx
      .select()
      .from(schema.databaseAllocations)
      .where(eq(schema.databaseAllocations.environmentId, preparation.environmentId));
    if (retained.some((row) => row.state !== "released"))
      throw new DomainError(
        "ENVIRONMENT_ALLOCATED",
        "Environment retains a database allocation",
        409,
      );
    await tx.insert(schema.databaseAllocations).values({
      ...base,
      id: preparation.allocationId,
      preparationId: preparation.id,
      projectId: preparation.projectId,
      environmentId: preparation.environmentId,
      state: "reserved",
    });
  } else {
    if (
      !existing?.systemIdentifier ||
      !existing.providerRef ||
      existing.state !== (command.intent === "suspend" ? "ready" : "suspended")
    )
      throw new DomainError(
        "INVALID_DATABASE_STATE",
        "Lifecycle requires the exact verified prior allocation state",
        409,
      );
    await tx
      .update(schema.databaseAllocations)
      .set({ ...base, preparationId: preparation.id })
      .where(eq(schema.databaseAllocations.id, existing.id));
  }
  await appendAudit(
    tx,
    actor,
    preparation.projectId,
    "database.reserved",
    `Reserved exact database allocation ${preparation.allocationId} generation ${base.generation}`,
  );
}
