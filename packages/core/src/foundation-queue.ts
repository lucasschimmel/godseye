import type { ExecutionContext } from "@godseye/contracts";
import { type DatabaseAccess, schema } from "@godseye/store";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { DomainError } from "./errors.js";
import {
  adapterFor,
  currentEpoch,
  environmentFor,
  type FoundationState,
  newId,
  planFor,
  recordRequest,
  requestFor,
  runFor,
} from "./foundation-data.js";
import { appendAudit, fingerprint, write } from "./journal.js";
import { operationView } from "./operations.js";
import { type Actor, assertOwner, assertProjectAccess } from "./policy.js";

export async function viewRun(tx: DatabaseAccess, id: string) {
  const { run, operation } = await runFor(tx, id);
  return {
    ...run,
    ...operationView(operation),
    createdAt: run.createdAt.toISOString(),
    terminalAt: run.terminalAt?.toISOString() ?? null,
    leaseExpiresAt: run.leaseExpiresAt?.toISOString() ?? null,
  };
}
export async function getRun(state: FoundationState, actor: Actor, id: string) {
  const { run } = await runFor(state.store.db, id);
  assertProjectAccess(actor, run.projectId);
  return viewRun(state.store.db, id);
}
export async function listRuns(state: FoundationState, actor: Actor) {
  assertOwner(actor);
  const rows = await state.store.db
    .select()
    .from(schema.executionRuns)
    .orderBy(asc(schema.executionRuns.createdAt));
  return Promise.all(rows.map((row) => viewRun(state.store.db, row.id)));
}
export function assertPlanIntegrity(plan: typeof schema.executionPlans.$inferSelect) {
  const {
    projectId,
    environmentId,
    targetId,
    expectedRevision,
    adapterId,
    command,
    maxCostMicros,
    tools,
    destinations,
  } = plan;
  if (
    fingerprint({
      projectId,
      environmentId,
      targetId,
      expectedRevision,
      adapterId,
      command,
      maxCostMicros,
      tools,
      destinations,
    }) !== plan.hash
  )
    throw new DomainError(
      "PLAN_TAMPERED",
      "Execution plan digest does not match its immutable input",
      409,
    );
}
export async function validApproval(
  tx: DatabaseAccess,
  state: FoundationState,
  plan: typeof schema.executionPlans.$inferSelect,
) {
  if (!plan.requiresApproval) return;
  if (await state.delegatedAuthority?.(tx, plan, "approval")) return;
  const [approval] = await tx
    .select()
    .from(schema.approvals)
    .where(eq(schema.approvals.planId, plan.id));
  if (
    !approval ||
    approval.planHash !== plan.hash ||
    approval.expiresAt.getTime() <= state.now().getTime()
  )
    throw new DomainError("APPROVAL_REQUIRED", "Exact unexpired owner approval is required", 409);
}

/** Intent, budget reservation and request receipt commit together under the control write lock. */
export async function enqueue(state: FoundationState, actor: Actor, planId: string, key: string) {
  return write(state.store, async (tx) => {
    const plan = await planFor(tx, actor, planId);
    if (actor.kind !== "owner" && !(await state.delegatedAuthority?.(tx, plan, "enqueue", actor)))
      assertOwner(actor);
    const receipt = await requestFor(tx, actor, key, "execution.enqueue", { planId });
    if (receipt.existing) return viewRun(tx, receipt.existing.resourceId);
    const [existingRun] = await tx
      .select()
      .from(schema.executionRuns)
      .where(eq(schema.executionRuns.planId, planId));
    if (existingRun) {
      await recordRequest(
        tx,
        state,
        key,
        receipt.digest,
        existingRun.id,
        "execution.enqueue",
        existingRun.terminalAt !== null,
      );
      return viewRun(tx, existingRun.id);
    }
    assertPlanIntegrity(plan);
    adapterFor(state, plan.adapterId);
    await environmentFor(
      tx,
      actor,
      plan.projectId,
      plan.environmentId,
      false,
      plan.command.kind === "delivery.lifecycle" && plan.command.intent === "cleanup",
      state.now(),
    );
    await validApproval(tx, state, plan);
    const [project] = await tx
      .select()
      .from(schema.projects)
      .where(eq(schema.projects.id, plan.projectId));
    if (!project || project.revision !== plan.expectedRevision)
      throw new DomainError(
        "REVISION_CONFLICT",
        "Project changed after the execution plan was prepared",
        409,
      );
    const [budget] = await tx
      .select()
      .from(schema.budgetAccounts)
      .where(eq(schema.budgetAccounts.projectId, plan.projectId));
    if (
      !budget ||
      budget.spentMicros + budget.reservedMicros + plan.maxCostMicros > budget.limitMicros ||
      (plan.command.kind === "agent.run" && plan.maxCostMicros === 0)
    )
      throw new DomainError("BUDGET_EXCEEDED", "Task budget cannot be reserved", 409);
    await tx
      .update(schema.budgetAccounts)
      .set({
        reservedMicros: budget.reservedMicros + plan.maxCostMicros,
        revision: budget.revision + 1,
      })
      .where(eq(schema.budgetAccounts.projectId, plan.projectId));
    const id = newId();
    await tx.insert(schema.operations).values({
      id,
      projectId: plan.projectId,
      action: plan.command.kind,
      status: "queued",
      revision: 0,
      createdAt: state.now(),
      updatedAt: state.now(),
    });
    await tx.insert(schema.executionRuns).values({
      id,
      planId,
      projectId: plan.projectId,
      environmentId: plan.environmentId,
      epoch: await currentEpoch(tx, plan.environmentId),
      fence: 0,
      cleanupState: "not_required",
      reservedMicros: plan.maxCostMicros,
      chargedMicros: 0,
      createdAt: state.now(),
    });
    await state.admission?.(tx, plan, id, actor);
    await recordRequest(tx, state, key, receipt.digest, id, "execution.enqueue", false);
    await appendAudit(
      tx,
      actor,
      plan.projectId,
      "execution.queued",
      `Queued ${plan.command.kind} with a bounded budget reservation`,
    );
    return viewRun(tx, id);
  });
}

export async function contextFor(tx: DatabaseAccess, runId: string): Promise<ExecutionContext> {
  const { run } = await runFor(tx, runId);
  const plan = await planFor(
    tx,
    { id: "executor", kind: "service", projectIds: [run.projectId] },
    run.planId,
  );
  const [effect] = await tx.select().from(schema.effects).where(eq(schema.effects.runId, runId));
  if (!run.workerId || !run.grantId || !effect)
    throw new DomainError("JOURNAL_INCONSISTENT", "Execution authority is incomplete", 500);
  return {
    runId,
    planId: plan.id,
    projectId: run.projectId,
    environmentId: run.environmentId,
    epoch: run.epoch,
    fence: run.fence,
    effectKey: effect.effectKey,
    command: plan.command,
    grantId: run.grantId,
    workerId: run.workerId,
  };
}

async function rejectQueued(
  tx: DatabaseAccess,
  state: FoundationState,
  run: typeof schema.executionRuns.$inferSelect,
  code: string,
) {
  const [budget] = await tx
    .select()
    .from(schema.budgetAccounts)
    .where(eq(schema.budgetAccounts.projectId, run.projectId));
  if (!budget)
    throw new DomainError("JOURNAL_INCONSISTENT", "Queued reservation has no account", 500);
  await tx
    .update(schema.budgetAccounts)
    .set({
      reservedMicros: budget.reservedMicros - run.reservedMicros,
      revision: budget.revision + 1,
    })
    .where(eq(schema.budgetAccounts.projectId, run.projectId));
  await tx
    .update(schema.operations)
    .set({
      status: "failed",
      errorCode: code,
      revision: sql`${schema.operations.revision} + 1`,
      updatedAt: state.now(),
    })
    .where(eq(schema.operations.id, run.id));
  await tx
    .update(schema.executionRuns)
    .set({ terminalAt: state.now(), cleanupState: "complete" })
    .where(eq(schema.executionRuns.id, run.id));
  await terminalRequests(tx, state, run.id);
  await state.releaseQueued?.(tx, run.id);
}

/** The durable consumer claims one intention; provider execution is deliberately outside this transaction. */
export async function claim(
  state: FoundationState,
  workerId: string,
): Promise<ExecutionContext | null> {
  if (!/^[A-Za-z0-9._:-]{1,128}$/.test(workerId))
    throw new DomainError("INVALID_WORKER", "Worker identity is invalid", 422);
  return write(state.store, async (tx) => {
    const rows = await tx
      .select({ run: schema.executionRuns, operation: schema.operations })
      .from(schema.executionRuns)
      .innerJoin(schema.operations, eq(schema.executionRuns.id, schema.operations.id))
      .where(eq(schema.operations.status, "queued"))
      .orderBy(asc(schema.executionRuns.createdAt));
    for (const { run, operation } of rows) {
      const plan = await planFor(
        tx,
        { id: "executor", kind: "service", projectIds: [run.projectId] },
        run.planId,
      );
      try {
        assertPlanIntegrity(plan);
        adapterFor(state, plan.adapterId);
        await environmentFor(
          tx,
          { id: "executor", kind: "service", projectIds: [run.projectId] },
          run.projectId,
          run.environmentId,
          false,
          plan.command.kind === "delivery.lifecycle" && plan.command.intent === "cleanup",
          state.now(),
        );
      } catch (error) {
        if (!(error instanceof DomainError)) throw error;
        await rejectQueued(tx, state, run, error.code);
        continue;
      }
      if (state.claimGate && !(await state.claimGate(tx, plan, run.id))) continue;
      const [project] = await tx
        .select()
        .from(schema.projects)
        .where(eq(schema.projects.id, run.projectId));
      if (
        !project ||
        project.revision !== plan.expectedRevision ||
        (await currentEpoch(tx, run.environmentId)) !== run.epoch
      ) {
        await rejectQueued(tx, state, run, "STALE_PLAN");
        continue;
      }
      try {
        await validApproval(tx, state, plan);
      } catch (error) {
        if (!(error instanceof DomainError) || error.code !== "APPROVAL_REQUIRED") throw error;
        await tx
          .update(schema.operations)
          .set({
            status: "awaiting_approval",
            revision: operation.revision + 1,
            updatedAt: state.now(),
          })
          .where(eq(schema.operations.id, run.id));
        continue;
      }
      const grantId = newId();
      const expiresAt = new Date(state.now().getTime() + state.leaseMs);
      await tx
        .update(schema.executionRuns)
        .set({
          workerId,
          fence: run.fence + 1,
          grantId,
          leaseExpiresAt: expiresAt,
          cleanupState: "pending",
        })
        .where(eq(schema.executionRuns.id, run.id));
      await tx
        .update(schema.operations)
        .set({ status: "running", revision: operation.revision + 1, updatedAt: state.now() })
        .where(eq(schema.operations.id, run.id));
      await tx.insert(schema.taskGrants).values({
        id: grantId,
        runId: run.id,
        actorId: workerId,
        environmentId: run.environmentId,
        epoch: run.epoch,
        fence: run.fence + 1,
        tools: plan.tools,
        destinations: plan.destinations,
        maxCostMicros: plan.maxCostMicros,
        usedMicros: 0,
        expiresAt,
      });
      await tx.insert(schema.effects).values({
        id: newId(),
        runId: run.id,
        effectKey: `effect:${run.id}`,
        fingerprint: plan.hash,
        status: "intent",
        createdAt: state.now(),
        updatedAt: state.now(),
      });
      return contextFor(tx, run.id);
    }
    return null;
  });
}

export async function terminalRequests(tx: DatabaseAccess, state: FoundationState, runId: string) {
  await tx
    .update(schema.foundationRequests)
    .set({ terminalAt: state.now() })
    .where(
      and(
        inArray(schema.foundationRequests.kind, ["execution.enqueue", "execution.reconcile"]),
        eq(schema.foundationRequests.resourceId, runId),
      ),
    );
}
