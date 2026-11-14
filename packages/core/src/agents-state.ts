import { randomUUID } from "node:crypto";
import {
  AGENT_DEFAULTS,
  AgentProfile,
  type AgentProfileView,
  AgentTask,
  type AgentToolExecutor,
} from "@godseye/contracts";
import { type DatabaseAccess, type Store, schema } from "@godseye/store";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import catalog from "../../../infra/hermes/catalog.json" with { type: "json" };
import { chatTaskEvent } from "./agents-chat-state.js";
import type { AgentProvider, AgentProviderRequest } from "./agents-provider.js";
import { DomainError } from "./errors.js";
import { environmentFor, type FoundationState } from "./foundation-data.js";
import type { FoundationEngine } from "./foundations.js";
import { fingerprint } from "./journal.js";
import { type Actor, assertOwner } from "./policy.js";
import { assertProjectMutable } from "./project-lifecycle-view.js";

export const AGENTS_ADAPTER_ID = "local.hermes";
export const AGENT_TOOL = "agent.model";
export const AGENT_DESTINATION = "api.openai.com";
export const AGENT_TERMINAL = ["succeeded", "failed", "cancelled"];
export interface AgentOptions {
  provider?: AgentProvider;
  toolExecutor?: AgentToolExecutor;
  now?: () => Date;
  pollMs?: number;
  timeoutMs?: (seconds: number) => number;
}
export interface AgentState {
  store: Store;
  now: () => Date;
  foundation: FoundationEngine;
  request: FoundationState;
  provider?: AgentProvider;
  toolExecutor?: AgentToolExecutor;
  pollMs: number;
  timeoutMs: (seconds: number) => number;
  calls: Map<string, Promise<unknown>>;
  stops: Map<string, Promise<unknown>>;
  aborts: Map<string, AbortController>;
}
export type ProfileRow = typeof schema.agentProfiles.$inferSelect;
export type TaskRow = typeof schema.agentTasks.$inferSelect;
export const skill = {
  id: "godseye-context" as const,
  version: "1.0.0" as const,
  sha256: catalog.skills[0]?.files["SKILL.md"] ?? "",
};
export const agentActor = (projectId: string): Actor => ({
  id: "hermes-worker",
  kind: "service",
  projectIds: [projectId],
});
export function profileHash(
  row: Pick<
    ProfileRow,
    | "id"
    | "projectId"
    | "environmentId"
    | "role"
    | "model"
    | "limits"
    | "revision"
    | "projectRevision"
    | "environmentRevision"
    | "skill"
  >,
  // The optional policy key is omitted for legacy hashes.
  toolPolicy?: ProfileRow["toolPolicy"],
) {
  const {
    id,
    projectId,
    environmentId,
    role,
    model,
    limits,
    revision,
    projectRevision,
    environmentRevision,
    skill: exactSkill,
  } = row;
  return fingerprint({
    id,
    projectId,
    environmentId,
    role,
    model,
    limits,
    revision,
    projectRevision,
    environmentRevision,
    skill: exactSkill,
    ...(toolPolicy ? { toolPolicy } : {}),
  });
}
export function profileView(
  state: AgentState,
  row: ProfileRow,
  activeTaskId: string | null = null,
): AgentProfileView {
  const base = AgentProfile.parse({
    id: row.id,
    projectId: row.projectId,
    environmentId: row.environmentId,
    role: row.role,
    model: row.model,
    limits: row.limits,
    ...(row.toolPolicy ? { toolPolicy: row.toolPolicy } : {}),
    revision: row.revision,
    projectRevision: row.projectRevision,
    environmentRevision: row.environmentRevision,
    hash: row.hash,
    paused: row.paused,
    busy: activeTaskId !== null,
    activeTaskId,
    skill: row.skill,
    runtime: "unconfigured",
    tools: row.toolPolicy?.tools ?? [],
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  });
  if (state.provider?.qualified && state.provider.supports(base)) base.runtime = "available";
  return base;
}
export function taskView(row: TaskRow) {
  return AgentTask.parse({
    id: row.id,
    profileId: row.profileId,
    projectId: row.projectId,
    environmentId: row.environmentId,
    profileRevision: row.profileRevision,
    ...(row.toolGrant ? { toolGrant: row.toolGrant } : {}),
    runId: row.runId,
    state: row.state,
    providerRunId: row.providerRunId,
    input: row.input,
    output: row.output,
    reason: row.reason,
    usage: {
      inputTokens: row.inputTokens,
      outputTokens: row.outputTokens,
      costState: "reserved-conservatively",
    },
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    finishedAt: row.finishedAt?.toISOString() ?? null,
  });
}
export async function profileFor(tx: DatabaseAccess, id: string) {
  const [row] = await tx.select().from(schema.agentProfiles).where(eq(schema.agentProfiles.id, id));
  if (!row) throw new DomainError("NOT_FOUND", "Agent profile not found", 404);
  return row;
}
export async function taskFor(tx: DatabaseAccess, id: string) {
  const [row] = await tx.select().from(schema.agentTasks).where(eq(schema.agentTasks.id, id));
  if (!row) throw new DomainError("NOT_FOUND", "Agent task not found", 404);
  return row;
}
export async function activeScope(
  state: AgentState,
  tx: DatabaseAccess,
  actor: Actor,
  projectId: string,
  environmentId: string,
) {
  const environment = await environmentFor(
    tx,
    actor,
    projectId,
    environmentId,
    false,
    false,
    state.now(),
  );
  const [project] = await tx
    .select()
    .from(schema.projects)
    .where(eq(schema.projects.id, projectId));
  if (!project) throw new DomainError("NOT_FOUND", "Project not found", 404);
  await assertProjectMutable(tx, projectId);
  if (project.status === "suspended")
    throw new DomainError("PROJECT_SUSPENDED", "Project is suspended", 409);
  if (environment.expiresAt && environment.expiresAt <= state.now())
    throw new DomainError("ENVIRONMENT_EXPIRED", "Environment expired", 409);
  const [allocation] = await tx
    .select()
    .from(schema.databaseAllocations)
    .where(
      and(
        eq(schema.databaseAllocations.environmentId, environmentId),
        inArray(schema.databaseAllocations.state, ["suspended", "quarantined"]),
      ),
    );
  if (allocation)
    throw new DomainError("BACKEND_HELD", "Environment is suspended or quarantined", 409);
  return { project, environment };
}
export async function currentProfile(state: AgentState, tx: DatabaseAccess, row: ProfileRow) {
  const { project, environment } = await activeScope(
    state,
    tx,
    agentActor(row.projectId),
    row.projectId,
    row.environmentId,
  );
  if (
    row.hash !== profileHash(row, row.toolPolicy) ||
    row.projectRevision !== project.revision ||
    row.environmentRevision !== environment.revision ||
    fingerprint(row.skill) !== fingerprint(skill)
  )
    throw new DomainError("AGENT_PROFILE_STALE", "Agent profile policy or target changed", 409);
  if (row.paused) throw new DomainError("AGENT_PROFILE_PAUSED", "Agent profile is paused", 409);
}
export async function assertNotBusy(tx: DatabaseAccess, profileId: string) {
  const [busy] = await tx
    .select({ id: schema.agentTasks.id })
    .from(schema.agentTasks)
    .where(
      and(
        eq(schema.agentTasks.profileId, profileId),
        sql`${schema.agentTasks.state} NOT IN ('succeeded','failed','cancelled')`,
      ),
    )
    .limit(1);
  if (busy)
    throw new DomainError("AGENT_BUSY", "An active or uncertain task still owns this profile", 409);
}
export async function event(
  state: AgentState,
  tx: DatabaseAccess,
  taskId: string,
  status: TaskRow["state"],
) {
  const [last] = await tx
    .select()
    .from(schema.agentEvents)
    .where(eq(schema.agentEvents.taskId, taskId))
    .orderBy(desc(schema.agentEvents.sequence))
    .limit(1);
  if (last?.state === status) return;
  const sequence = (last?.sequence ?? 0) + 1;
  await chatTaskEvent(state, tx, taskId, status);
  await tx
    .insert(schema.agentEvents)
    .values({ id: randomUUID(), taskId, sequence, state: status, occurredAt: state.now() });
  await tx
    .delete(schema.agentEvents)
    .where(
      and(
        eq(schema.agentEvents.taskId, taskId),
        sql`${schema.agentEvents.sequence} <= ${sequence - AGENT_DEFAULTS.maxEvents}`,
      ),
    );
}
export async function taskDetail(state: AgentState, actor: Actor, id: string) {
  assertOwner(actor);
  const row = await taskFor(state.store.db, id);
  const events = await state.store.db
    .select()
    .from(schema.agentEvents)
    .where(eq(schema.agentEvents.taskId, id))
    .orderBy(asc(schema.agentEvents.sequence))
    .limit(AGENT_DEFAULTS.maxEvents);
  return {
    task: taskView(row),
    events: events.map((e) => ({ ...e, occurredAt: e.occurredAt.toISOString() })),
  };
}
export function providerRequest(task: TaskRow): AgentProviderRequest {
  const {
    runtime: _runtime,
    createdAt: _created,
    updatedAt: _updated,
    busy: _busy,
    activeTaskId: _active,
    ...profile
  } = task.profileSnapshot;
  return {
    taskId: task.id,
    profile: {
      ...profile,
      tools: task.toolGrant?.policy.tools ?? [],
      limits: {
        ...profile.limits,
        maxRequests: task.toolGrant?.maxModelRequests ?? 1,
        maxTurns: task.toolGrant?.maxModelRequests ?? 1,
      },
    },
    input: task.input,
    correlationId: task.id,
    providerRunId: task.providerRunId,
    deadline: (
      task.deadline ??
      new Date(task.createdAt.getTime() + task.profileSnapshot.limits.timeoutSeconds * 1000)
    ).toISOString(),
    ...(task.toolGrant
      ? { toolGrant: task.toolGrant, toolPolicyHash: fingerprint(task.toolGrant) }
      : {}),
  };
}
