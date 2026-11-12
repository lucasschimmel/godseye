import {
  type EffectOutcomeInput,
  JobDefinition,
  type JobDefinitionView,
  JobRun,
  type JobRunView,
  OutboxIntent,
  type OutboxIntentView,
} from "@godseye/contracts";
import { type DatabaseAccess, type Store, schema } from "@godseye/store";
import { and, eq, gt, inArray, isNotNull, lte, or } from "drizzle-orm";
import { DomainError } from "./errors.js";
import { environmentFor, type FoundationState } from "./foundation-data.js";
import type { FoundationEngine } from "./foundations.js";
import type { Actor } from "./policy.js";

export const JOBS_ADAPTER_ID = "local.jobs";
export const JOBS_DESTINATION = "jobs.local";
export const JOBS_TOOL = "job.run";
export const JOBS_SCHEDULER_ID = "jobs-scheduler";
export const JOB_TERMINAL_STATES = ["succeeded", "failed", "cancelled"] as const;

/** Server-owned fixture handler; the registry never runs tenant-supplied code on the controller. */
export interface JobHandlerContext {
  projectId: string;
  environmentId: string;
  definition: JobDefinitionView;
  run: JobRunView;
  /** Stable across attempts of one run: use it to deduplicate idempotent external effects. */
  effectKey: string;
  /** Unique per foundation attempt. */
  attemptKey: string;
  signal: AbortSignal;
  /** Writes an outbox intent in the run's own cell; refused once the worker lease is fenced. */
  outbox(intent: OutboxIntentInput): Promise<OutboxIntentView>;
}
export type JobHandlerResult = Pick<EffectOutcomeInput, "status" | "evidenceRef">;
export interface JobHandler {
  execute(context: JobHandlerContext): Promise<JobHandlerResult>;
  /** Read-only inspection of an uncertain effect; absent means the effect stays unknown. */
  reconcile?(context: JobHandlerContext): Promise<JobHandlerResult>;
}
export interface OutboxIntentInput {
  effectKey: string;
  destination: string;
  payload: Record<string, unknown>;
}
export interface OutboxDelivery {
  effectKey: string;
  destination: string;
  projectId: string;
  environmentId: string;
  payload: Record<string, unknown>;
  attempt: number;
}
export type OutboxSendResult =
  | { status: "delivered"; evidenceRef?: string }
  | { status: "rejected"; reason: string }
  | { status: "unknown" };
export interface OutboxSender {
  /** True only when the receiver deduplicates by effect key, making a re-send of an abandoned claim safe. */
  dedupesByEffectKey: boolean;
  send(delivery: OutboxDelivery): Promise<OutboxSendResult>;
  /** Optional read-only probe used to move unknown deliveries into reconciliation. */
  inspect?(delivery: OutboxDelivery): Promise<"delivered" | "absent" | "unknown">;
}
export interface JobState {
  store: Store;
  now: () => Date;
  foundation: FoundationEngine;
  request: FoundationState;
  handlers?: ReadonlyMap<string, JobHandler>;
  senders?: ReadonlyMap<string, OutboxSender>;
  timeoutMs: (seconds: number) => number;
  dispatchTimeoutMs: number;
  maxOutboxAttempts: number;
  aborts: Map<string, AbortController>;
}
export const jobsActor = (projectId: string): Actor => ({
  id: JOBS_SCHEDULER_ID,
  kind: "service",
  projectIds: [projectId],
});
export const jobsConfigured = (state: JobState) => !!state.handlers || !!state.senders;
export function assertJobsConfigured(state: JobState) {
  if (!jobsConfigured(state))
    throw new DomainError(
      "CAPABILITY_UNAVAILABLE",
      "Durable job engine is unconfigured; no scheduling or dispatch runs",
      503,
    );
}
export const definitionView = (row: typeof schema.jobDefinitions.$inferSelect) =>
  JobDefinition.parse({
    id: row.id,
    projectId: row.projectId,
    environmentId: row.environmentId,
    name: row.name,
    handler: row.handler,
    trigger: row.trigger,
    effectPolicy: row.effectPolicy,
    limits: row.limits,
    revision: row.revision,
    hash: row.hash,
    paused: row.paused,
    nextFireAt: row.nextFireAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  });
export const runView = (row: typeof schema.jobRuns.$inferSelect) =>
  JobRun.parse({
    id: row.id,
    definitionId: row.definitionId,
    projectId: row.projectId,
    environmentId: row.environmentId,
    runId: row.runId,
    state: row.state,
    trigger: row.trigger,
    dedupeKey: row.dedupeKey,
    attempt: row.attempt,
    scheduledFor: row.scheduledFor.toISOString(),
    startedAt: row.startedAt?.toISOString() ?? null,
    finishedAt: row.finishedAt?.toISOString() ?? null,
    reason: row.reason,
    createdAt: row.createdAt.toISOString(),
  });
export const outboxView = (row: typeof schema.jobOutbox.$inferSelect) =>
  OutboxIntent.parse({
    id: row.id,
    projectId: row.projectId,
    environmentId: row.environmentId,
    jobRunId: row.jobRunId,
    effectKey: row.effectKey,
    destination: row.destination,
    state: row.state,
    attempts: row.attempts,
    payloadHash: row.payloadHash,
    lastError: row.lastError,
    createdAt: row.createdAt.toISOString(),
    settledAt: row.settledAt?.toISOString() ?? null,
  });
export async function definitionFor(tx: DatabaseAccess, actor: Actor, id: string) {
  const [row] = await tx
    .select()
    .from(schema.jobDefinitions)
    .where(eq(schema.jobDefinitions.id, id));
  if (!row || (actor.kind !== "owner" && !actor.projectIds.includes(row.projectId)))
    throw new DomainError("NOT_FOUND", "Job definition not found", 404);
  return row;
}
export async function jobRunFor(tx: DatabaseAccess, actor: Actor, id: string) {
  const [row] = await tx.select().from(schema.jobRuns).where(eq(schema.jobRuns.id, id));
  if (!row || (actor.kind !== "owner" && !actor.projectIds.includes(row.projectId)))
    throw new DomainError("NOT_FOUND", "Job run not found", 404);
  return row;
}
export async function outboxFor(tx: DatabaseAccess, actor: Actor, id: string) {
  const [row] = await tx.select().from(schema.jobOutbox).where(eq(schema.jobOutbox.id, id));
  if (!row || (actor.kind !== "owner" && !actor.projectIds.includes(row.projectId)))
    throw new DomainError("NOT_FOUND", "Outbox intent not found", 404);
  return row;
}
/** Cells that may not schedule, run or dispatch: recovery hold, suspension, expired or closing previews. */
export async function heldEnvironmentIds(tx: DatabaseAccess, now: Date): Promise<string[]> {
  const held = new Set<string>();
  const environments = await tx
    .select({ id: schema.environments.id })
    .from(schema.environments)
    .where(
      or(
        eq(schema.environments.recoveryHold, true),
        and(isNotNull(schema.environments.expiresAt), lte(schema.environments.expiresAt, now)),
      ),
    );
  for (const row of environments) held.add(row.id);
  const suspended = await tx
    .select({ id: schema.environments.id })
    .from(schema.environments)
    .innerJoin(schema.projects, eq(schema.environments.projectId, schema.projects.id))
    .where(eq(schema.projects.status, "suspended"));
  for (const row of suspended) held.add(row.id);
  const previews = await tx
    .select({ id: schema.deliveryPreviews.environmentId })
    .from(schema.deliveryPreviews)
    .where(
      or(
        inArray(schema.deliveryPreviews.state, ["cleanup-required", "retired", "unknown"]),
        lte(schema.deliveryPreviews.expiresAt, now),
      ),
    );
  for (const row of previews) held.add(row.id);
  return [...held].sort();
}
/** Ordinary job authority requires an active, unsuspended cell that belongs to the stated project. */
export async function activeCell(
  state: JobState,
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
  if (!project || project.status === "suspended")
    throw new DomainError("PROJECT_SUSPENDED", "Suspended projects cannot run jobs", 409);
  if (environment.expiresAt && environment.expiresAt.getTime() <= state.now().getTime())
    throw new DomainError("DELIVERY_HOLD", "Expired environments cannot run jobs", 409);
  return { environment, project };
}
export const activeRunsFilter = (definitionId: string, protectedPolicy: boolean) =>
  and(
    eq(schema.jobRuns.definitionId, definitionId),
    isNotNull(schema.jobRuns.runId),
    inArray(
      schema.jobRuns.state,
      protectedPolicy
        ? ["queued", "running", "cancel_requested", "reconciling", "unknown"]
        : ["queued", "running", "cancel_requested", "reconciling"],
    ),
  );
export const dueDefinitions = (now: Date) =>
  and(eq(schema.jobDefinitions.paused, false), lte(schema.jobDefinitions.nextFireAt, now));
export const futureOnly = (now: Date) => gt(schema.jobDefinitions.nextFireAt, now);
