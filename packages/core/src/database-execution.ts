import { randomUUID } from "node:crypto";
import type { EffectOutcomeInput, ExecutionContext } from "@godseye/contracts";
import { type DatabaseAccess, schema } from "@godseye/store";
import { eq } from "drizzle-orm";
import type { DatabasePhysicalInspection, DatabaseProviderScope } from "./database-provider.js";
import {
  assertDatabaseQualification,
  compiledDatabase,
  DATABASE_DESTINATION,
  type DatabaseState,
  qualifyDatabase,
  validateDatabasePreparation,
} from "./database-state.js";
import { DomainError } from "./errors.js";
import { currentEpoch, foundationState, planFor, runFor } from "./foundation-data.js";
import { validApproval } from "./foundation-queue.js";
import { immutableSnapshot } from "./infra-policy.js";
import { appendAudit, fingerprint, write } from "./journal.js";

const workerActor = (context: ExecutionContext) => ({
  id: context.workerId,
  kind: "service" as const,
  projectIds: [context.projectId],
});
export async function databaseExecutionGate(
  state: DatabaseState,
  tx: DatabaseAccess,
  context: ExecutionContext,
  reconcile = false,
  promoteReadiness = false,
) {
  const [allocation] = await tx
    .select()
    .from(schema.databaseAllocations)
    .where(eq(schema.databaseAllocations.runId, context.runId));
  const command = context.command;
  if (
    !allocation ||
    allocation.projectId !== context.projectId ||
    allocation.environmentId !== context.environmentId ||
    command.kind !== "database.lifecycle" ||
    command.manifestRef !== allocation.preparationId ||
    allocation.epoch !== context.epoch
  )
    throw new DomainError("FENCED", "Database execution scope changed", 409);
  assertDatabaseQualification(state, state.qualification ?? null);
  const preparation = await validateDatabasePreparation(
    state,
    tx,
    allocation.preparationId,
    workerActor(context),
    allocation.id,
    command.intent,
    reconcile,
    promoteReadiness,
  );
  if (command.manifestHash !== preparation.hash)
    throw new DomainError("FENCED", "Database execution digest changed", 409);
  if (reconcile) {
    const { run, operation } = await runFor(tx, context.runId);
    if (
      operation.status !== "reconciling" ||
      run.fence !== context.fence ||
      run.workerId !== context.workerId ||
      !run.leaseExpiresAt ||
      run.leaseExpiresAt.getTime() <= state.now().getTime() ||
      (await currentEpoch(tx, context.environmentId)) !== context.epoch
    )
      throw new DomainError("FENCED", "Database reconciliation authority expired", 409);
  } else {
    await state.foundation.assertDispatch(tx, context, {
      actorId: context.workerId,
      tool: `database.${command.intent}`,
      destination: DATABASE_DESTINATION,
      costMicros: 0,
    });
    await validApproval(
      tx,
      foundationState(state.store, { now: state.now }),
      await planFor(tx, workerActor(context), context.planId),
    );
  }
  const scope: DatabaseProviderScope = {
    allocationId: allocation.id,
    projectId: allocation.projectId,
    environmentId: allocation.environmentId,
    preparationHash: preparation.hash,
    generation: allocation.generation,
    epoch: context.epoch,
  };
  const [authorization] = await tx
    .select()
    .from(schema.databaseCommands)
    .where(eq(schema.databaseCommands.planId, context.planId));
  if (
    !authorization ||
    authorization.preparationId !== preparation.id ||
    authorization.intent !== command.intent ||
    authorization.expectedGeneration + 1 !== allocation.generation
  )
    throw new DomainError("FENCED", "Database lifecycle authorization changed", 409);
  return {
    allocation,
    preparation,
    profile: compiledDatabase(preparation),
    scope,
    previousScope: authorization.previousScope as DatabaseProviderScope | null,
  };
}
function assertPhysical(
  result: DatabasePhysicalInspection | null,
  expected: Awaited<ReturnType<typeof databaseExecutionGate>>,
  running: boolean,
) {
  if (
    !result?.evidence?.trim() ||
    result.evidence.length > 256 ||
    fingerprint(result.scope) !== fingerprint(expected.scope) ||
    !/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(result.providerRef) ||
    !/^\d+$/.test(result.systemIdentifier) ||
    result.configurationHash !== expected.profile.configurationHash ||
    result.running !== running ||
    !result.independentInstance ||
    !result.quotaEnforced ||
    !result.privateNetwork ||
    result.dataVolume !== expected.profile.dataVolume ||
    result.walVolume !== expected.profile.walVolume ||
    result.dataVolume === result.walVolume ||
    (running && !result.policyVerified)
  )
    throw new DomainError(
      "PROFILE_DRIFT",
      "Effective independent PostgreSQL instance differs from preparation",
      409,
    );
  if (
    (expected.allocation.systemIdentifier &&
      expected.allocation.systemIdentifier !== result.systemIdentifier) ||
    (expected.allocation.providerRef && expected.allocation.providerRef !== result.providerRef)
  )
    throw new DomainError(
      "PROFILE_DRIFT",
      "Database system identity or allocation mapping changed",
      409,
    );
  if (!running && !expected.allocation.systemIdentifier)
    throw new DomainError(
      "PROFILE_DRIFT",
      "Stopped cluster has no independently verified prior identity",
      409,
    );
}
async function markUncertain(state: DatabaseState, context: ExecutionContext, reason: string) {
  await write(state.store, async (tx) => {
    const [row] = await tx
      .select()
      .from(schema.databaseAllocations)
      .where(eq(schema.databaseAllocations.runId, context.runId));
    if (!row) return;
    await tx
      .update(schema.databaseAllocations)
      .set({
        state: reason === "PROFILE_DRIFT" ? "quarantined" : "unknown",
        reason,
        updatedAt: state.now(),
      })
      .where(eq(schema.databaseAllocations.id, row.id));
  });
}
async function inspectAndRecord(
  state: DatabaseState,
  context: ExecutionContext,
  reconcile: boolean,
) {
  const gate = () =>
    write(state.store, (tx) => databaseExecutionGate(state, tx, context, reconcile));
  const before = await gate();
  if (!state.provider)
    throw new DomainError("CAPABILITY_UNAVAILABLE", "Database provider is unavailable", 503);
  const result = immutableSnapshot(
    await state.provider.inspect(before.scope, before.profile, before.allocation.providerRef),
  );
  await qualifyDatabase(state);
  await write(state.store, async (tx) => {
    const current = await databaseExecutionGate(state, tx, context, reconcile);
    assertPhysical(result, current, current.allocation.requestedState === "ready");
    if (!result) throw new DomainError("PROFILE_DRIFT", "Database inspection missing", 409);
    const [step] = await tx
      .select()
      .from(schema.databaseSteps)
      .where(eq(schema.databaseSteps.runId, context.runId));
    if (!step || step.scopeHash !== fingerprint(current.scope))
      throw new DomainError("FENCED", "Database intention scope differs", 409);
    await tx
      .update(schema.databaseAllocations)
      .set({
        systemIdentifier: result.systemIdentifier,
        verifiedScope: { ...current.scope },
        providerRef: result.providerRef,
        updatedAt: state.now(),
      })
      .where(eq(schema.databaseAllocations.id, current.allocation.id));
    await tx
      .update(schema.databaseSteps)
      .set({ state: "inspected", evidence: fingerprint(result) })
      .where(eq(schema.databaseSteps.id, step.id));
  });
  return {
    status: "succeeded",
    costMicros: 0,
    evidenceRef: `database:${before.preparation.hash}`,
  } as const;
}
/** One durable intention precedes any physical mutation; uncertainty never drops reservations. */
export async function executeDatabase(
  state: DatabaseState,
  input: ExecutionContext,
): Promise<EffectOutcomeInput> {
  const context = immutableSnapshot(input),
    provider = state.provider;
  if (!provider) return { status: "unknown", costMicros: 0 };
  try {
    await qualifyDatabase(state);
    const gate = () => write(state.store, (tx) => databaseExecutionGate(state, tx, context));
    const intended = await write(state.store, async (tx) => {
      const result = await databaseExecutionGate(state, tx, context);
      if (context.command.kind !== "database.lifecycle")
        throw new DomainError("FENCED", "Database command changed", 409);
      await tx.insert(schema.databaseSteps).values({
        id: randomUUID(),
        allocationId: result.allocation.id,
        runId: context.runId,
        generation: result.allocation.generation,
        intent: context.command.intent,
        state: "intended",
        scopeHash: fingerprint(result.scope),
        createdAt: state.now(),
      });
      await appendAudit(
        tx,
        workerActor(context),
        context.projectId,
        "database.intended",
        `Durable instance mutation intention for allocation ${result.allocation.id}`,
      );
      return result;
    });
    const dispatch = async () => {
      await qualifyDatabase(state);
      await gate();
    };
    if (context.command.kind !== "database.lifecycle")
      throw new DomainError("FENCED", "Database command changed", 409);
    if (context.command.intent === "provision")
      await provider.provision(intended.scope, intended.profile, dispatch);
    else {
      const prior = immutableSnapshot(
        await provider.inspect(intended.scope, intended.profile, intended.allocation.providerRef),
      );
      await dispatch();
      assertPhysical(
        prior,
        {
          ...intended,
          scope: intended.previousScope ?? {
            ...intended.scope,
            generation: intended.scope.generation - 1,
          },
        },
        context.command.intent === "suspend",
      );
      if (!intended.allocation.providerRef)
        throw new DomainError("PROFILE_DRIFT", "Database mapping missing", 409);
      if (context.command.intent === "suspend")
        await provider.suspend(intended.scope, intended.allocation.providerRef, dispatch);
      else await provider.resume(intended.scope, intended.allocation.providerRef, dispatch);
    }
    await dispatch();
    return await inspectAndRecord(state, context, false);
  } catch (error) {
    await markUncertain(
      state,
      context,
      error instanceof DomainError ? error.code : "PROVIDER_OUTCOME_UNCERTAIN",
    );
    return { status: "unknown", costMicros: 0 };
  }
}
/** Read-only reconciliation never recreates/adopts/deletes a cluster or assumes absence means safety. */
export async function reconcileDatabase(
  state: DatabaseState,
  input: ExecutionContext,
): Promise<EffectOutcomeInput> {
  const context = immutableSnapshot(input);
  try {
    await qualifyDatabase(state);
    return await inspectAndRecord(state, context, true);
  } catch (error) {
    await markUncertain(
      state,
      context,
      error instanceof DomainError ? error.code : "PROVIDER_OUTCOME_UNCERTAIN",
    );
    return { status: "unknown", costMicros: 0 };
  }
}
