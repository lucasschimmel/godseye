import { createHash } from "node:crypto";
import {
  OrchestrationDetail,
  type OrchestrationDetailView,
  type OrchestrationPlanView,
  type PrepareOrchestrationInput,
} from "@godseye/contracts";
import { type DatabaseAccess, type Store, schema } from "@godseye/store";
import { eq } from "drizzle-orm";
import type { AgentEngine } from "./agents.js";
import { profileFor, profileHash, skill, taskFor } from "./agents-state.js";
import type { CodingEngine } from "./coding.js";
import { preparationFor } from "./coding-state.js";
import { DomainError } from "./errors.js";
import { currentEpoch, environmentFor, type foundationState, runFor } from "./foundation-data.js";
import type { FoundationEngine } from "./foundations.js";
import { fingerprint } from "./journal.js";
import type { Actor } from "./policy.js";
import { assertProjectMutable } from "./project-lifecycle-view.js";
export interface OrchestrationState {
  store: Store;
  now(): Date;
  foundation: FoundationEngine;
  agents: AgentEngine;
  coding: CodingEngine;
  request: ReturnType<typeof foundationState>;
}
export const orchestrationActor = (projectId: string): Actor => ({
  id: "orchestration-worker",
  kind: "service",
  projectIds: [projectId],
});
export function childId(parentId: string, stepId: string) {
  const hex = createHash("sha256").update(`orchestration:${parentId}:${stepId}`).digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}
export async function orchestrationFor(tx: DatabaseAccess, id: string) {
  const [row] = await tx
    .select()
    .from(schema.orchestrationPlans)
    .where(eq(schema.orchestrationPlans.id, id));
  if (!row) throw new DomainError("NOT_FOUND", "Orchestration plan not found", 404);
  const detail = OrchestrationDetail.parse(row.metadata);
  const { hash, ...body } = detail.plan;
  if (row.id !== body.id || row.projectId !== body.projectId || hash !== fingerprint(body))
    throw new DomainError("FENCED", "Orchestration integrity mismatch", 409);
  return detail;
}
export async function saveOrchestration(
  state: OrchestrationState,
  tx: DatabaseAccess,
  detail: OrchestrationDetailView,
) {
  const metadata = OrchestrationDetail.parse({ ...detail, updatedAt: state.now().toISOString() });
  await tx
    .update(schema.orchestrationPlans)
    .set({ metadata })
    .where(eq(schema.orchestrationPlans.id, detail.plan.id));
  return metadata;
}
export async function scopeFor(
  state: OrchestrationState,
  tx: DatabaseAccess,
  input: Pick<
    PrepareOrchestrationInput,
    "projectId" | "environmentId" | "expectedProjectRevision" | "expectedEnvironmentRevision"
  >,
) {
  const environment = await environmentFor(
    tx,
    orchestrationActor(input.projectId),
    input.projectId,
    input.environmentId,
    false,
    false,
    state.now(),
  );
  const [project] = await tx
    .select()
    .from(schema.projects)
    .where(eq(schema.projects.id, input.projectId));
  await assertProjectMutable(tx, input.projectId);
  if (
    !project ||
    project.status === "suspended" ||
    project.revision !== input.expectedProjectRevision ||
    environment.revision !== input.expectedEnvironmentRevision ||
    (environment.expiresAt && environment.expiresAt <= state.now())
  )
    throw new DomainError("REVISION_CONFLICT", "Orchestration scope changed or expired", 409);
}
export async function freezeSteps(
  _state: OrchestrationState,
  tx: DatabaseAccess,
  input: PrepareOrchestrationInput,
) {
  const steps: OrchestrationPlanView["steps"] = [];
  for (const step of input.steps) {
    if (step.kind === "hermes") {
      const p = await profileFor(tx, step.profileId);
      if (
        p.projectId !== input.projectId ||
        p.environmentId !== input.environmentId ||
        p.revision !== step.expectedRevision ||
        p.paused ||
        p.hash !== profileHash(p, p.toolPolicy) ||
        p.projectRevision !== input.expectedProjectRevision ||
        p.environmentRevision !== input.expectedEnvironmentRevision ||
        fingerprint(p.skill) !== fingerprint(skill)
      )
        throw new DomainError(
          "AGENT_PROFILE_STALE",
          "Orchestration profile is stale or outside scope",
          409,
        );
      steps.push({
        step,
        bindingHash: p.hash,
        maxCostMicros: p.limits.maxCostMicros,
        timeoutSeconds: p.limits.timeoutSeconds,
      });
    } else if (step.kind === "coding") {
      const p = await preparationFor(tx, step.preparationId);
      if (
        p.hash !== step.expectedHash ||
        p.projectId !== input.projectId ||
        p.environmentId !== input.environmentId ||
        p.expectedProjectRevision !== input.expectedProjectRevision ||
        p.expectedEnvironmentRevision !== input.expectedEnvironmentRevision
      )
        throw new DomainError(
          "REVISION_CONFLICT",
          "Coding preparation is outside the exact scope",
          409,
        );
      const [project] = await tx
        .select()
        .from(schema.projects)
        .where(eq(schema.projects.id, input.projectId));
      if (!project?.repository || fingerprint(project.repository) !== p.repositoryHash)
        throw new DomainError("REVISION_CONFLICT", "Coding repository changed", 409);
      steps.push({
        step,
        bindingHash: p.hash,
        maxCostMicros: p.limits.maxCostMicros,
        timeoutSeconds: p.limits.timeoutSeconds,
      });
    } else steps.push({ step, bindingHash: null, maxCostMicros: 0, timeoutSeconds: 0 });
  }
  if (steps.reduce((sum, s) => sum + s.maxCostMicros, 0) > input.maxCostMicros)
    throw new DomainError("BUDGET_EXCEEDED", "Aggregate child maximum exceeds plan ceiling", 409);
  return steps;
}
export async function currentOrchestration(
  state: OrchestrationState,
  tx: DatabaseAccess,
  d: OrchestrationDetailView,
  active = true,
) {
  if (Date.parse(d.plan.expiresAt) <= state.now().getTime())
    throw new DomainError("FENCED", "Orchestration launch deadline expired", 409);
  if (active && (!d.approvedAt || !d.approvedBy || !["approved", "running"].includes(d.state)))
    throw new DomainError("FENCED", "Orchestration has no active exact owner approval", 409);
  await scopeFor(state, tx, d.plan);
  if (d.plan.sourceTaskId) {
    const source = await taskFor(tx, d.plan.sourceTaskId),
      p = await profileFor(tx, source.profileId);
    if (
      !source.runId ||
      source.state !== "succeeded" ||
      source.cancelRequested ||
      !source.output ||
      p.paused ||
      p.hash !== source.profileSnapshot.hash ||
      p.hash !== profileHash(p, p.toolPolicy)
    )
      throw new DomainError("FENCED", "Hermes proposal source is no longer current", 409);
    const { run, operation } = await runFor(tx, source.runId);
    if (
      operation.status !== "succeeded" ||
      run.epoch !== (await currentEpoch(tx, source.environmentId))
    )
      throw new DomainError("FENCED", "Hermes proposal source authority changed", 409);
  }

  if ((await currentEpoch(tx, d.plan.environmentId)) !== d.plan.epoch)
    throw new DomainError("FENCED", "Orchestration activation epoch changed", 409);
  const input: PrepareOrchestrationInput = {
    ...d.plan,
    lifetimeSeconds: 30,
    steps: d.plan.steps.map((s) => s.step),
  };
  if (fingerprint(await freezeSteps(state, tx, input)) !== fingerprint(d.plan.steps))
    throw new DomainError("FENCED", "Orchestration frozen references changed", 409);
}
