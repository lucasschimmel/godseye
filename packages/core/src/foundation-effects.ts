import { EffectOutcome, type EffectOutcomeInput, type ExecutionContext } from "@godseye/contracts";
import { type DatabaseAccess, schema } from "@godseye/store";
import { and, eq, inArray } from "drizzle-orm";
import { DomainError, parseInput } from "./errors.js";
import {
  adapterFor,
  assertFresh,
  consumesAdapter,
  currentEpoch,
  environmentFor,
  type FoundationState,
  planFor,
  readOnlyAgentRecovery,
  recordRequest,
  requestFor,
  runFor,
  validateLease,
} from "./foundation-data.js";
import { normalizeOutcome } from "./foundation-outcome.js";
import { contextFor, terminalRequests, viewRun } from "./foundation-queue.js";
import { appendAudit, write } from "./journal.js";
import {
  assertOrchestrationDispatch,
  markOrchestrationUnknown,
} from "./orchestration-authority.js";
import type { DelegatedTask } from "./orchestration-delegation.js";
import { type Actor, assertOwner, assertProjectAccess } from "./policy.js";

export async function revokeGrants(tx: DatabaseAccess, state: FoundationState, runId: string) {
  await tx
    .update(schema.taskGrants)
    .set({ revokedAt: state.now() })
    .where(eq(schema.taskGrants.runId, runId));
}
export async function markUnknown(
  tx: DatabaseAccess,
  state: FoundationState,
  runId: string,
  code: string,
) {
  const { operation, run } = await runFor(tx, runId);
  const plan = await planFor(
    tx,
    { id: "effect-reconciler", kind: "service", projectIds: [run.projectId] },
    run.planId,
  );
  await markOrchestrationUnknown(tx, plan.command, state.now);
  await tx
    .update(schema.operations)
    .set({
      status: "unknown",
      errorCode: code,
      revision: operation.revision + 1,
      updatedAt: state.now(),
    })
    .where(eq(schema.operations.id, runId));
  await tx
    .update(schema.executionRuns)
    .set({ leaseExpiresAt: null, cleanupState: "pending" })
    .where(eq(schema.executionRuns.id, runId));
  await tx
    .update(schema.effects)
    .set({ status: "unknown", updatedAt: state.now() })
    .where(eq(schema.effects.runId, runId));
  await revokeGrants(tx, state, runId);
  await state.uncertainty?.(tx, runId);
}

/** Settle only confirmed evidence; uncertainty retains the reservation and never renews execution authority. */
export async function settle(
  tx: DatabaseAccess,
  state: FoundationState,
  runId: string,
  input: EffectOutcomeInput,
) {
  const outcome = parseInput(EffectOutcome, input);
  const { run, operation } = await runFor(tx, runId);
  const [grant] = run.grantId
    ? await tx.select().from(schema.taskGrants).where(eq(schema.taskGrants.id, run.grantId))
    : [];
  const [budget] = await tx
    .select()
    .from(schema.budgetAccounts)
    .where(eq(schema.budgetAccounts.projectId, run.projectId));
  if (!budget) throw new DomainError("JOURNAL_INCONSISTENT", "Execution budget is missing", 500);
  const actual = Math.max(outcome.costMicros, grant?.usedMicros ?? 0, run.chargedMicros);
  const delta = actual - run.chargedMicros;
  const errorCode =
    actual > run.reservedMicros
      ? "BUDGET_OVERRUN"
      : outcome.status !== "unknown" && !outcome.evidenceRef
        ? "EVIDENCE_MISSING"
        : null;
  // A confirmed reconciliation closes uncertainty while retaining the overrun incident and actual charge.
  const confirmed = outcome.status !== "unknown" && Boolean(outcome.evidenceRef?.trim());
  const status =
    errorCode &&
    !(errorCode === "BUDGET_OVERRUN" && operation.status === "reconciling" && confirmed)
      ? "unknown"
      : outcome.status;
  const terminal = status !== "unknown";
  if (status === "unknown") {
    const plan = await planFor(
      tx,
      { id: "effect-reconciler", kind: "service", projectIds: [run.projectId] },
      run.planId,
    );
    await markOrchestrationUnknown(tx, plan.command, state.now);
  }
  await state.settlement?.(tx, runId, status, actual);
  if (status === "unknown") await state.uncertainty?.(tx, runId);
  await tx
    .update(schema.budgetAccounts)
    .set({
      spentMicros: budget.spentMicros + delta,
      reservedMicros: budget.reservedMicros - (terminal ? run.reservedMicros : 0),
      revision: budget.revision + 1,
    })
    .where(eq(schema.budgetAccounts.projectId, run.projectId));
  await tx
    .update(schema.executionRuns)
    .set({
      chargedMicros: actual,
      terminalAt: terminal ? state.now() : null,
      leaseExpiresAt: null,
      cleanupState: terminal ? "complete" : "pending",
    })
    .where(eq(schema.executionRuns.id, runId));
  await tx
    .update(schema.operations)
    .set({ status, errorCode, revision: operation.revision + 1, updatedAt: state.now() })
    .where(eq(schema.operations.id, runId));
  await tx
    .update(schema.effects)
    .set({ status, evidenceRef: outcome.evidenceRef ?? null, updatedAt: state.now() })
    .where(eq(schema.effects.runId, runId));
  await revokeGrants(tx, state, runId);
  if (terminal) await terminalRequests(tx, state, runId);
  await appendAudit(
    tx,
    { id: "effect-reconciler", kind: "service", projectIds: [run.projectId] },
    run.projectId,
    `execution.${status}`,
    `Execution ${runId} is ${status}; grants revoked`,
  );
  return viewRun(tx, runId);
}
export async function finish(
  state: FoundationState,
  context: ExecutionContext,
  outcome: EffectOutcomeInput,
) {
  return write(state.store, async (tx) => {
    await validateLease(state, tx, context);
    const result = await settle(tx, state, context.runId, outcome);
    // A parent deadline may cross during settlement SQL and artifact writes.
    if (outcome.status !== "unknown")
      await assertOrchestrationDispatch(tx, context.command, state.now);
    return result;
  });
}
export async function reconcileExpired(state: FoundationState) {
  return write(state.store, async (tx) => {
    const rows = await tx
      .select({ run: schema.executionRuns, operation: schema.operations })
      .from(schema.executionRuns)
      .innerJoin(schema.operations, eq(schema.executionRuns.id, schema.operations.id))
      .where(inArray(schema.operations.status, ["running", "reconciling"]));
    let count = 0;
    for (const { run } of rows) {
      const plan = await planFor(
        tx,
        { id: "lease-reconciler", kind: "service", projectIds: [run.projectId] },
        run.planId,
      );
      if (!consumesAdapter(state, plan.adapterId, run.environmentId)) continue;
      if (run.leaseExpiresAt && run.leaseExpiresAt.getTime() <= state.now().getTime()) {
        await markUnknown(tx, state, run.id, "LEASE_EXPIRED");
        await appendAudit(
          tx,
          { id: "lease-reconciler", kind: "service", projectIds: [run.projectId] },
          run.projectId,
          "execution.uncertain",
          `Lease expired for ${run.id}; effect reconciliation is required`,
        );
        count++;
      }
    }
    return count;
  });
}
export async function reconcile(state: FoundationState, actor: Actor, runId: string, key: string) {
  assertOwner(actor);
  const context = await write(state.store, async (tx) => {
    const { run, operation } = await runFor(tx, runId);
    assertProjectAccess(actor, run.projectId);
    const retainedPlan = await planFor(tx, actor, run.planId);
    await environmentFor(
      tx,
      actor,
      run.projectId,
      run.environmentId,
      readOnlyAgentRecovery(retainedPlan),
      readOnlyAgentRecovery(retainedPlan) || retainedPlan.command.kind === "delivery.lifecycle",
      state.now(),
    );
    const receipt = await requestFor(tx, actor, key, "execution.reconcile", { runId });
    if (receipt.existing) return null;
    if (operation.status !== "unknown")
      throw new DomainError(
        "INVALID_TRANSITION",
        "Only unknown effects can enter reconciliation",
        409,
      );
    await tx
      .update(schema.operations)
      .set({ status: "reconciling", revision: operation.revision + 1, updatedAt: state.now() })
      .where(eq(schema.operations.id, runId));
    await tx
      .update(schema.executionRuns)
      .set({
        fence: run.fence + 1,
        leaseExpiresAt: new Date(state.now().getTime() + state.leaseMs),
      })
      .where(eq(schema.executionRuns.id, runId));
    await recordRequest(tx, state, key, receipt.digest, runId, "execution.reconcile", false);
    return contextFor(tx, runId);
  });
  if (!context) return viewRun(state.store.db, runId);
  const plan = await planFor(state.store.db, actor, context.planId);
  let outcome: EffectOutcomeInput;
  try {
    await write(state.store, (tx) =>
      environmentFor(
        tx,
        actor,
        context.projectId,
        context.environmentId,
        readOnlyAgentRecovery(plan),
        readOnlyAgentRecovery(plan) || plan.command.kind === "delivery.lifecycle",
        state.now(),
      ),
    );
    outcome = await adapterFor(state, plan.adapterId).reconcile(context);
  } catch {
    outcome = { status: "unknown", costMicros: 0 };
  }
  outcome = normalizeOutcome(outcome);
  return write(state.store, async (tx) => {
    await environmentFor(
      tx,
      actor,
      context.projectId,
      context.environmentId,
      readOnlyAgentRecovery(plan),
      readOnlyAgentRecovery(plan) || plan.command.kind === "delivery.lifecycle",
      state.now(),
    );
    const { run, operation } = await runFor(tx, runId);
    if (
      operation.status !== "reconciling" ||
      run.fence !== context.fence ||
      !run.leaseExpiresAt ||
      run.leaseExpiresAt.getTime() <= state.now().getTime()
    )
      throw new DomainError("FENCED", "Reconciliation authority was revoked or expired", 409);
    return settle(tx, state, runId, outcome);
  });
}
export async function cancel(
  state: FoundationState,
  actor: Actor,
  runId: string,
  key: string,
  delegated?: DelegatedTask,
) {
  if (!delegated) assertOwner(actor);
  return write(state.store, async (tx) => {
    await delegated?.authorize(tx);
    const { run, operation } = await runFor(tx, runId);
    assertProjectAccess(actor, run.projectId);
    const receipt = await requestFor(tx, actor, key, "execution.cancel", { runId });
    if (receipt.existing) return viewRun(tx, runId);
    if (["queued", "awaiting_approval"].includes(operation.status)) {
      const [budget] = await tx
        .select()
        .from(schema.budgetAccounts)
        .where(eq(schema.budgetAccounts.projectId, run.projectId));
      if (!budget) throw new DomainError("JOURNAL_INCONSISTENT", "Budget is missing", 500);
      await tx
        .update(schema.budgetAccounts)
        .set({
          reservedMicros: budget.reservedMicros - run.reservedMicros,
          revision: budget.revision + 1,
        })
        .where(eq(schema.budgetAccounts.projectId, run.projectId));
      await tx
        .update(schema.operations)
        .set({ status: "cancelled", revision: operation.revision + 1, updatedAt: state.now() })
        .where(eq(schema.operations.id, runId));
      await tx
        .update(schema.executionRuns)
        .set({ terminalAt: state.now(), cleanupState: "complete" })
        .where(eq(schema.executionRuns.id, runId));
      await terminalRequests(tx, state, runId);
      await state.releaseQueued?.(tx, runId);
    } else if (operation.status === "running" || operation.status === "reconciling")
      await markUnknown(tx, state, runId, "CANCELLED_WITH_UNCERTAIN_EFFECT");
    else if (operation.status === "unknown") {
      const plan = await planFor(tx, actor, run.planId);
      if (readOnlyAgentRecovery(plan))
        await markUnknown(tx, state, runId, "CANCELLED_WITH_UNCERTAIN_EFFECT");
    }
    await revokeGrants(tx, state, runId);
    await recordRequest(tx, state, key, receipt.digest, runId, "execution.cancel");
    await appendAudit(
      tx,
      actor,
      run.projectId,
      "execution.cancel_requested",
      `Cancelled authority for ${runId}; uncertain effects require reconciliation`,
    );
    return viewRun(tx, runId);
  });
}
export async function advanceEpoch(
  state: FoundationState,
  actor: Actor,
  environmentId: string,
  key: string,
) {
  assertFresh(actor, state);
  return write(state.store, async (tx) => {
    const [environment] = await tx
      .select()
      .from(schema.environments)
      .where(eq(schema.environments.id, environmentId));
    if (!environment) throw new DomainError("NOT_FOUND", "Environment not found", 404);
    assertProjectAccess(actor, environment.projectId);
    const receipt = await requestFor(tx, actor, key, "environment.fence", { environmentId });
    if (receipt.existing) return Number(receipt.existing.resourceId);
    const epoch = (await currentEpoch(tx, environmentId)) + 1;
    await tx
      .insert(schema.activationEpochs)
      .values({ environmentId, epoch })
      .onConflictDoUpdate({ target: schema.activationEpochs.environmentId, set: { epoch } });
    const rows = await tx
      .select()
      .from(schema.executionRuns)
      .where(and(eq(schema.executionRuns.environmentId, environmentId)));
    for (const run of rows) {
      const { operation } = await runFor(tx, run.id);
      if (["running", "reconciling"].includes(operation.status))
        await markUnknown(tx, state, run.id, "ACTIVATION_FENCED");
      await revokeGrants(tx, state, run.id);
    }
    await recordRequest(tx, state, key, receipt.digest, String(epoch), "environment.fence");
    await appendAudit(
      tx,
      actor,
      environment.projectId,
      "environment.fenced",
      `Advanced environment activation epoch to ${epoch}; this does not activate a restore`,
    );
    return epoch;
  });
}
