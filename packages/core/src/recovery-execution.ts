import { randomUUID } from "node:crypto";
import type { ExecutionContext } from "@godseye/contracts";
import { type DatabaseAccess, schema } from "@godseye/store";
import { eq } from "drizzle-orm";
import { DomainError } from "./errors.js";
import { currentEpoch, foundationState, planFor, runFor } from "./foundation-data.js";
import { validApproval } from "./foundation-queue.js";
import { immutableSnapshot } from "./infra-policy.js";
import { appendAudit, fingerprint, write } from "./journal.js";
import { assertRecoveryInspection, type RecoveryInspection } from "./recovery-provider.js";
import {
  assertRecoveryQualification,
  qualifyRecovery,
  RECOVERY_DESTINATION,
  type RecoveryState,
  recoveryPreparationFor,
  recoveryScope,
  validateRecovery,
} from "./recovery-state.js";

const worker = (context: ExecutionContext) => ({
  id: context.workerId,
  kind: "service" as const,
  projectIds: [context.projectId],
});
export async function recoveryExecutionGate(
  state: RecoveryState,
  tx: DatabaseAccess,
  context: ExecutionContext,
  reconcile = false,
) {
  const [run] = await tx
    .select()
    .from(schema.recoveryRuns)
    .where(eq(schema.recoveryRuns.runId, context.runId));
  const [authorization] = await tx
    .select()
    .from(schema.recoveryCommands)
    .where(eq(schema.recoveryCommands.planId, context.planId));
  if (
    !run ||
    !authorization ||
    context.command.kind !== "database.recovery" ||
    context.command.manifestRef !== run.preparationId ||
    authorization.preparationId !== run.preparationId ||
    context.epoch !== run.epoch ||
    context.epoch !== authorization.epoch
  )
    throw new DomainError("FENCED", "Recovery operation authority changed", 409);
  const row = await recoveryPreparationFor(tx, run.preparationId);
  if (
    context.projectId !== row.projectId ||
    context.environmentId !== row.sourceEnvironmentId ||
    context.command.manifestHash !== row.hash ||
    context.command.intent !== row.kind ||
    run.allocationId !== row.allocationId ||
    run.environmentId !== row.environmentId
  )
    throw new DomainError("FENCED", "Recovery exact physical scope changed", 409);
  await validateRecovery(state, tx, row, worker(context), run.id, reconcile);
  const scope = await recoveryScope(tx, row, context.epoch);
  assertRecoveryQualification(state, scope, state.qualifications.get(row.id) ?? null);
  if (reconcile) {
    const current = await runFor(tx, context.runId);
    if (
      current.operation.status !== "reconciling" ||
      current.run.workerId !== context.workerId ||
      current.run.fence !== context.fence ||
      current.run.planId !== context.planId ||
      !current.run.leaseExpiresAt ||
      current.run.leaseExpiresAt <= state.now() ||
      (await currentEpoch(tx, row.sourceEnvironmentId)) !== context.epoch
    )
      throw new DomainError("FENCED", "Recovery reconciliation lease changed", 409);
  } else {
    await state.foundation.assertDispatch(tx, context, {
      actorId: context.workerId,
      tool: `recovery.${row.kind}`,
      destination: RECOVERY_DESTINATION,
      costMicros: 0,
    });
    await validApproval(
      tx,
      foundationState(state.store, { now: state.now }),
      await planFor(tx, worker(context), context.planId),
    );
  }
  return { row, run, scope };
}
async function recordInspection(
  state: RecoveryState,
  context: ExecutionContext,
  result: RecoveryInspection | null,
  reconcile: boolean,
) {
  return write(state.store, async (tx) => {
    const current = await recoveryExecutionGate(state, tx, context, reconcile);
    const verified = assertRecoveryInspection(current.scope, result, state.now());
    const [step] = await tx
      .select()
      .from(schema.recoverySteps)
      .where(eq(schema.recoverySteps.runId, context.runId));
    if (!step || step.scopeHash !== fingerprint(current.scope))
      throw new DomainError("FENCED", "Recovery intention differs", 409);
    await tx
      .update(schema.recoverySteps)
      .set({ state: "inspected", evidence: fingerprint(verified) })
      .where(eq(schema.recoverySteps.runId, context.runId));
    await tx
      .update(schema.recoveryRuns)
      .set({
        evidence: verified as unknown as Record<string, unknown>,
        updatedAt: state.now(),
        reason: null,
      })
      .where(eq(schema.recoveryRuns.id, current.run.id));
    if (current.row.kind === "full" || current.row.kind === "diff") {
      const [existing] = await tx
        .select()
        .from(schema.recoveryBackups)
        .where(eq(schema.recoveryBackups.preparationId, current.row.id));
      if (!existing)
        await tx.insert(schema.recoveryBackups).values({
          id: randomUUID(),
          preparationId: current.row.id,
          projectId: current.row.projectId,
          environmentId: current.row.sourceEnvironmentId,
          sourceAllocationId: current.row.sourceAllocationId,
          repositoryId: current.row.repositoryId,
          kind: current.row.kind,
          metadata: verified.metadata as unknown as Record<string, unknown>,
          createdAt: state.now(),
        });
    } else if (current.row.kind === "check" && current.row.backupId) {
      await tx
        .update(schema.recoveryBackups)
        .set({ metadata: verified.metadata as unknown as Record<string, unknown> })
        .where(eq(schema.recoveryBackups.id, current.row.backupId));
    } else if (current.row.backupId) {
      await tx
        .update(schema.recoveryBackups)
        .set({ verifiedAt: state.now() })
        .where(eq(schema.recoveryBackups.id, current.row.backupId));
    }
    await appendAudit(
      tx,
      worker(context),
      context.projectId,
      "recovery.verified",
      `Verified ${current.row.kind}; runtime activation remains blocked`,
    );
    return {
      status: "succeeded" as const,
      costMicros: 0,
      evidenceRef: `recovery:${fingerprint(verified)}`,
    };
  });
}
export async function executeRecovery(
  state: RecoveryState,
  input: ExecutionContext,
  reconcile = false,
) {
  const context = immutableSnapshot(input),
    provider = state.provider;
  if (!provider) return { status: "unknown" as const, costMicros: 0 };
  try {
    const row = await recoveryPreparationFor(
      state.store.db,
      context.command.kind === "database.recovery" ? context.command.manifestRef : "",
    );
    await qualifyRecovery(state, await recoveryScope(state.store.db, row, context.epoch));
    const intended = await write(state.store, async (tx) => {
      const current = await recoveryExecutionGate(state, tx, context, reconcile);
      const [step] = await tx
        .select()
        .from(schema.recoverySteps)
        .where(eq(schema.recoverySteps.runId, context.runId));
      if (!reconcile && step)
        throw new DomainError(
          "RECONCILIATION_REQUIRED",
          "An existing recovery intention must be inspected without replay",
          409,
        );
      if (!reconcile)
        await tx.insert(schema.recoverySteps).values({
          runId: context.runId,
          scopeHash: fingerprint(current.scope),
          state: "intended",
          createdAt: state.now(),
        });
      return current;
    });
    const gate = async () => {
      await qualifyRecovery(state, intended.scope);
      await write(state.store, (tx) => recoveryExecutionGate(state, tx, context, reconcile));
    };
    if (!reconcile) {
      if (intended.row.kind === "restore") await provider.restore(intended.scope, gate);
      else if (intended.row.kind === "check") await provider.check(intended.scope, gate);
      else await provider.backup(intended.scope, gate);
    }
    await gate();
    const result = immutableSnapshot(await provider.inspect(intended.scope));
    await gate();
    return await recordInspection(state, context, result, reconcile);
  } catch (error) {
    await write(state.store, async (tx) => {
      await tx
        .update(schema.recoveryRuns)
        .set({
          state: "unknown",
          reason: error instanceof DomainError ? error.code : "PROVIDER_OUTCOME_UNCERTAIN",
          updatedAt: state.now(),
        })
        .where(eq(schema.recoveryRuns.runId, context.runId));
    });
    return { status: "unknown" as const, costMicros: 0 };
  }
}
