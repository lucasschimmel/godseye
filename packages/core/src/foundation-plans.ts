import {
  type ActionCommandInput,
  CreateExecutionPlan,
  type CreateExecutionPlanInput,
  RegisterResource,
  type RegisterResourceInput,
} from "@godseye/contracts";
import { type DatabaseAccess, schema } from "@godseye/store";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { DomainError, parseInput } from "./errors.js";
import {
  adapterFor,
  assertFresh,
  environmentFor,
  type FoundationState,
  needsApproval,
  newId,
  planFor,
  recordRequest,
  requestFor,
} from "./foundation-data.js";
import { appendAudit, fingerprint, write } from "./journal.js";
import { type Actor, assertOwner, assertProjectAccess } from "./policy.js";

const BudgetInput = z
  .object({
    limitMicros: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    expectedRevision: z.number().int().nonnegative(),
  })
  .strict();
export async function registerResource(
  state: FoundationState,
  actor: Actor,
  input: RegisterResourceInput,
  key: string,
) {
  assertOwner(actor);
  const data = parseInput(RegisterResource, input);
  return write(state.store, async (tx) => {
    await environmentFor(tx, actor, data.projectId, data.environmentId);
    const receipt = await requestFor(tx, actor, key, "resource.register", data);
    if (receipt.existing) {
      const [existing] = await tx
        .select()
        .from(schema.resources)
        .where(eq(schema.resources.id, receipt.existing.resourceId));
      if (!existing)
        throw new DomainError("JOURNAL_INCONSISTENT", "Resource receipt is inconsistent", 500);
      return existing;
    }
    const resource = { ...data, id: newId(), createdAt: state.now() };
    await tx.insert(schema.resources).values(resource);
    await recordRequest(tx, state, key, receipt.digest, resource.id, "resource.register");
    await appendAudit(
      tx,
      actor,
      data.projectId,
      "resource.registered",
      `Registered ${data.kind} reference in environment ${data.environmentId}`,
    );
    return resource;
  });
}
export async function getBudget(state: FoundationState, actor: Actor, projectId: string) {
  assertProjectAccess(actor, projectId);
  const [account] = await state.store.db
    .select()
    .from(schema.budgetAccounts)
    .where(eq(schema.budgetAccounts.projectId, projectId));
  return account ?? { projectId, limitMicros: 0, reservedMicros: 0, spentMicros: 0, revision: 0 };
}
export async function configureBudget(
  state: FoundationState,
  actor: Actor,
  projectId: string,
  input: z.infer<typeof BudgetInput>,
  key: string,
) {
  assertOwner(actor);
  const data = parseInput(BudgetInput, input);
  return write(state.store, async (tx) => {
    const [project] = await tx
      .select()
      .from(schema.projects)
      .where(eq(schema.projects.id, projectId));
    if (!project) throw new DomainError("NOT_FOUND", "Project not found", 404);
    const receipt = await requestFor(tx, actor, key, "budget.configure", { projectId, ...data });
    const [existing] = await tx
      .select()
      .from(schema.budgetAccounts)
      .where(eq(schema.budgetAccounts.projectId, projectId));
    if (receipt.existing) return existing;
    if ((existing?.revision ?? 0) !== data.expectedRevision)
      throw new DomainError("REVISION_CONFLICT", "Budget has changed", 409);
    if (data.limitMicros < (existing?.reservedMicros ?? 0) + (existing?.spentMicros ?? 0))
      throw new DomainError(
        "BUDGET_IN_USE",
        "Budget cannot discard existing usage or reservations",
        409,
      );
    const account = {
      projectId,
      limitMicros: data.limitMicros,
      reservedMicros: existing?.reservedMicros ?? 0,
      spentMicros: existing?.spentMicros ?? 0,
      revision: data.expectedRevision + 1,
    };
    await tx
      .insert(schema.budgetAccounts)
      .values(account)
      .onConflictDoUpdate({ target: schema.budgetAccounts.projectId, set: account });
    await recordRequest(tx, state, key, receipt.digest, projectId, "budget.configure");
    await appendAudit(
      tx,
      actor,
      projectId,
      "budget.configured",
      `Set project task admission limit to ${data.limitMicros} micros`,
    );
    return account;
  });
}

function commandReferences(command: ActionCommandInput): [string, string][] {
  const refKinds: Record<string, string> = {
    configurationRef: "configuration",
    manifestRef: "manifest",
    planRef: "database-plan",
    definitionRef: "job-definition",
    profileId: "profile",
    skillVersionId: "skill-version",
    inputRef: "input",
    grantRef: "grant",
    runId: "run",
    approvalId: "approval",
    artifactId: "artifact",
    integrationId: "integration",
  };
  return Object.entries(command).flatMap(([field, value]) =>
    refKinds[field] ? [[value, refKinds[field]] as [string, string]] : [],
  );
}
async function validatePlanReferences(tx: DatabaseAccess, input: CreateExecutionPlanInput) {
  const references = commandReferences(input.command);
  if (input.targetId !== input.projectId && input.targetId !== input.environmentId)
    references.push([input.targetId, "target"]);
  for (const [id, kind] of references) {
    const [resource] = await tx.select().from(schema.resources).where(eq(schema.resources.id, id));
    if (
      !resource ||
      resource.projectId !== input.projectId ||
      resource.environmentId !== input.environmentId ||
      (kind !== "target" && resource.kind !== kind)
    )
      throw new DomainError(
        "FORBIDDEN",
        "Plan reference is outside the authorized scope or kind",
        403,
      );
  }
}
export async function createPlan(
  state: FoundationState,
  actor: Actor,
  input: CreateExecutionPlanInput,
  key: string,
) {
  const data = parseInput(CreateExecutionPlan, input);
  adapterFor(state, data.adapterId);
  if (data.command.kind === "approval.resolve")
    throw new DomainError(
      "INVALID_COMMAND",
      "Approvals use the dedicated owner decision boundary",
      422,
    );
  return write(state.store, async (tx) => {
    if (actor.kind !== "owner" && !(await state.delegatedAuthority?.(tx, data, "create", actor)))
      assertOwner(actor);
    const environment = await environmentFor(
      tx,
      actor,
      data.projectId,
      data.environmentId,
      false,
      data.command.kind === "delivery.lifecycle" && data.command.intent === "cleanup",
      state.now(),
    );
    const receipt = await requestFor(tx, actor, key, "plan.create", data);
    if (receipt.existing) return planFor(tx, actor, receipt.existing.resourceId);
    const [project] = await tx
      .select()
      .from(schema.projects)
      .where(eq(schema.projects.id, data.projectId));
    if (!project || project.revision !== data.expectedRevision)
      throw new DomainError(
        "REVISION_CONFLICT",
        "Project revision changed before plan creation",
        409,
      );
    await validatePlanReferences(tx, data);
    const plan = {
      ...data,
      id: newId(),
      hash: fingerprint(data),
      requiresApproval:
        needsApproval(data, environment.kind === "production") ||
        (state.approvalPolicy?.(data) ?? false),
      createdAt: state.now(),
    };
    await tx.insert(schema.executionPlans).values(plan);
    await recordRequest(tx, state, key, receipt.digest, plan.id, "plan.create");
    await appendAudit(
      tx,
      actor,
      data.projectId,
      "plan.created",
      `Prepared immutable ${data.command.kind} plan ${plan.hash}`,
    );
    return plan;
  });
}
export async function approve(
  state: FoundationState,
  actor: Actor,
  planId: string,
  expectedHash: string,
  key: string,
) {
  assertFresh(actor, state);
  return write(state.store, async (tx) => {
    const plan = await planFor(tx, actor, planId);
    const receipt = await requestFor(tx, actor, key, "plan.approve", { planId, expectedHash });
    if (receipt.existing) return plan;
    if (plan.hash !== expectedHash)
      throw new DomainError("APPROVAL_MISMATCH", "Approval does not match the immutable plan", 409);
    const approval = {
      id: newId(),
      planId,
      planHash: plan.hash,
      ownerId: actor.id,
      sessionId: actor.sessionId ?? "",
      authenticatedAt: new Date(actor.authenticatedAt ?? ""),
      approvedAt: state.now(),
      expiresAt: new Date(state.now().getTime() + state.approvalMs),
    };
    await tx
      .insert(schema.approvals)
      .values(approval)
      .onConflictDoUpdate({ target: schema.approvals.planId, set: approval });
    const waiting = await tx
      .select()
      .from(schema.executionRuns)
      .where(eq(schema.executionRuns.planId, planId));
    for (const run of waiting)
      await tx
        .update(schema.operations)
        .set({
          status: "queued",
          revision: sql`${schema.operations.revision} + 1`,
          updatedAt: state.now(),
        })
        .where(
          and(eq(schema.operations.id, run.id), eq(schema.operations.status, "awaiting_approval")),
        );
    await recordRequest(tx, state, key, receipt.digest, planId, "plan.approve");
    await appendAudit(
      tx,
      actor,
      plan.projectId,
      "plan.approved",
      `Approved exact plan ${plan.hash} under a recent owner session`,
    );
    return plan;
  });
}
