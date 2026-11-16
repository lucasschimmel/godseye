import { randomUUID } from "node:crypto";
import { AdmitRecovery, type AdmitRecoveryInput } from "@godseye/contracts";
import { type DatabaseAccess, schema } from "@godseye/store";
import { eq } from "drizzle-orm";
import { DomainError, parseInput } from "./errors.js";
import { currentEpoch, foundationState, recordRequest, requestFor } from "./foundation-data.js";
import { immutableSnapshot } from "./infra-policy.js";
import { appendAudit, fingerprint, write } from "./journal.js";
import { type Actor, assertProjectAccess } from "./policy.js";
import {
  assertRecoveryQualification,
  qualifyRecovery,
  RECOVERY_ADAPTER_ID,
  RECOVERY_DESTINATION,
  type RecoveryState,
  recoveryFresh,
  recoveryPreparationFor,
  recoveryRunView,
  recoveryScope,
  validateRecovery,
} from "./recovery-state.js";
export async function admitRecovery(
  state: RecoveryState,
  actorInput: Actor,
  input: AdmitRecoveryInput,
  key: string,
) {
  const actor = immutableSnapshot(actorInput),
    data = parseInput(AdmitRecovery, input);
  recoveryFresh(state, actor);
  const preparation = await recoveryPreparationFor(state.store.db, data.preparationId);
  assertProjectAccess(actor, preparation.projectId);
  if (preparation.hash !== data.expectedHash)
    throw new DomainError("PLAN_TAMPERED", "Exact recovery preparation hash is required", 409);
  const prefix = `recovery:${fingerprint({ actorId: actor.id, key, data })}`;
  const plan = await state.foundation.createPlan(
    actor,
    {
      projectId: preparation.projectId,
      environmentId: preparation.sourceEnvironmentId,
      targetId: preparation.id,
      expectedRevision: preparation.expectedProjectRevision,
      adapterId: RECOVERY_ADAPTER_ID,
      command: {
        kind: "database.recovery",
        intent: preparation.kind,
        manifestRef: preparation.id,
        manifestHash: preparation.hash,
      },
      maxCostMicros: 0,
      tools: [`recovery.${preparation.kind}`],
      destinations: [RECOVERY_DESTINATION],
    },
    `${prefix}:plan`,
  );
  const epoch = await currentEpoch(state.store.db, preparation.sourceEnvironmentId);
  await qualifyRecovery(state, await recoveryScope(state.store.db, preparation, epoch));
  recoveryFresh(state, actor);
  await write(state.store, async (tx) => {
    const request = await requestFor(tx, actor, key, "recovery.admit", data);
    if (request.existing) return;
    await validateRecovery(state, tx, preparation, actor);
    await tx
      .insert(schema.recoveryCommands)
      .values({ planId: plan.id, preparationId: preparation.id, epoch });
    await recordRequest(
      tx,
      foundationState(state.store, { now: state.now }),
      key,
      request.digest,
      preparation.id,
      "recovery.admit",
      false,
    );
  });
  recoveryFresh(state, actor);
  await state.foundation.approve(actor, plan.id, plan.hash, `${prefix}:approve`);
  await state.foundation.enqueue(actor, plan.id, `${prefix}:enqueue`);
  const [run] = await state.store.db
    .select()
    .from(schema.recoveryRuns)
    .where(eq(schema.recoveryRuns.preparationId, preparation.id));
  if (!run) throw new DomainError("JOURNAL_INCONSISTENT", "Recovery reservation missing", 500);
  return recoveryRunView(run);
}
export async function reserveRecovery(
  state: RecoveryState,
  tx: DatabaseAccess,
  plan: typeof schema.executionPlans.$inferSelect,
  runId: string,
  actor: Actor,
) {
  if (plan.adapterId !== RECOVERY_ADAPTER_ID) {
    if (plan.command.kind === "database.recovery")
      throw new DomainError("FORBIDDEN", "Recovery requires its private admission adapter", 403);
    return;
  }
  recoveryFresh(state, actor);
  const [authorization] = await tx
    .select()
    .from(schema.recoveryCommands)
    .where(eq(schema.recoveryCommands.planId, plan.id));
  if (!authorization || plan.command.kind !== "database.recovery")
    throw new DomainError("FORBIDDEN", "Generic Foundation cannot bypass recovery admission", 403);
  const row = await recoveryPreparationFor(tx, authorization.preparationId);
  if (
    plan.command.manifestRef !== row.id ||
    plan.command.manifestHash !== row.hash ||
    plan.command.intent !== row.kind ||
    plan.environmentId !== row.sourceEnvironmentId ||
    plan.projectId !== row.projectId ||
    plan.targetId !== row.id ||
    plan.expectedRevision !== row.expectedProjectRevision ||
    fingerprint(plan.tools) !== fingerprint([`recovery.${row.kind}`]) ||
    fingerprint(plan.destinations) !== fingerprint([RECOVERY_DESTINATION])
  )
    throw new DomainError(
      "FORBIDDEN",
      "Recovery plan scope differs from the private admission",
      403,
    );
  if (authorization.epoch !== (await currentEpoch(tx, row.sourceEnvironmentId)))
    throw new DomainError("FENCED", "Recovery source epoch changed", 409);
  await validateRecovery(state, tx, row, actor);
  const scope = await recoveryScope(tx, row, authorization.epoch);
  assertRecoveryQualification(state, scope, state.qualifications.get(row.id) ?? null);
  await tx.insert(schema.recoveryRuns).values({
    id: randomUUID(),
    preparationId: row.id,
    runId,
    projectId: row.projectId,
    environmentId: row.environmentId,
    allocationId: row.allocationId,
    kind: row.kind,
    state: "reserved",
    epoch: authorization.epoch,
    updatedAt: state.now(),
  });
  await appendAudit(
    tx,
    actor,
    row.projectId,
    "recovery.reserved",
    `Reserved retained source, repository and exact held target ${row.allocationId}`,
  );
}
