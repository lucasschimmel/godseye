import { z } from "zod";

const Id = z.string().uuid();
const Hash = z.string().regex(/^[a-f0-9]{64}$/);
const Moment = z.string().datetime();
const Revision = z.number().int().nonnegative();
const Slug = z.string().regex(/^[a-z][a-z0-9.-]{0,63}$/);
export const JOB_POLICY_VERSION = "jobs-v1" as const;
export const JOB_TRIGGER_KINDS = ["cron", "event", "manual"] as const;
export const JOB_EFFECT_POLICIES = ["read_only", "idempotent", "protected"] as const;
export const JOB_RUN_STATES = [
  "queued",
  "running",
  "succeeded",
  "failed",
  "cancel_requested",
  "cancelled",
  "unknown",
  "reconciling",
] as const;
export const OUTBOX_STATES = [
  "pending",
  "dispatching",
  "delivered",
  "failed",
  "unknown",
  "reconciling",
  "held",
] as const;

/** Five-field UTC cron (minute hour day month weekday); validated again by the scheduler. */
export const CronExpression = z
  .string()
  .max(64)
  .regex(/^(?:[\d*/,-]+\s+){4}[\d*/,-]+$/);
export const JobTrigger = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("cron"), cron: CronExpression }).strict(),
  z
    .object({ kind: z.literal("event"), eventType: z.string().regex(/^[a-z][a-z0-9_.-]{0,63}$/) })
    .strict(),
  z.object({ kind: z.literal("manual") }).strict(),
]);
export const JobLimits = z
  .object({
    maxConcurrent: z.number().int().min(1).max(16),
    maxAttempts: z.number().int().min(1).max(10),
    timeoutSeconds: z.number().int().min(1).max(86400),
    retentionDays: z.number().int().min(1).max(365),
  })
  .strict();
export const RegisterJobDefinition = z
  .object({
    projectId: Id,
    environmentId: Id,
    expectedEnvironmentRevision: Revision,
    name: Slug,
    handler: Slug,
    trigger: JobTrigger,
    effectPolicy: z.enum(JOB_EFFECT_POLICIES),
    limits: JobLimits,
  })
  .strict();
export type RegisterJobDefinitionInput = z.infer<typeof RegisterJobDefinition>;
export const JobDefinition = z
  .object({
    id: Id,
    projectId: Id,
    environmentId: Id,
    name: Slug,
    handler: Slug,
    trigger: JobTrigger,
    effectPolicy: z.enum(JOB_EFFECT_POLICIES),
    limits: JobLimits,
    revision: Revision,
    hash: Hash,
    paused: z.boolean(),
    nextFireAt: Moment.nullable(),
    createdAt: Moment,
  })
  .strict();
export type JobDefinitionView = z.infer<typeof JobDefinition>;
export const JobDefinitionChange = z.object({ expectedRevision: Revision }).strict();
export const TriggerJob = z
  .object({
    expectedRevision: Revision,
    dedupeKey: z.string().min(8).max(128),
    payloadRef: Id.optional(),
  })
  .strict();
export type TriggerJobInput = z.infer<typeof TriggerJob>;
export const CancelJobRun = z.object({ reason: z.string().min(3).max(240) }).strict();
export const JobRun = z
  .object({
    id: Id,
    definitionId: Id,
    projectId: Id,
    environmentId: Id,
    runId: Id.nullable(),
    state: z.enum(JOB_RUN_STATES),
    trigger: z.enum(JOB_TRIGGER_KINDS),
    dedupeKey: z.string().max(128),
    attempt: z.number().int().nonnegative(),
    scheduledFor: Moment,
    startedAt: Moment.nullable(),
    finishedAt: Moment.nullable(),
    reason: z.string().max(240).nullable(),
    createdAt: Moment,
  })
  .strict();
export type JobRunView = z.infer<typeof JobRun>;
export const OutboxIntent = z
  .object({
    id: Id,
    projectId: Id,
    environmentId: Id,
    jobRunId: Id.nullable(),
    effectKey: z.string().min(8).max(128),
    destination: Slug,
    state: z.enum(OUTBOX_STATES),
    attempts: z.number().int().nonnegative(),
    payloadHash: Hash,
    lastError: z.string().max(240).nullable(),
    createdAt: Moment,
    settledAt: Moment.nullable(),
  })
  .strict();
export type OutboxIntentView = z.infer<typeof OutboxIntent>;
export const ReconcileOutbox = z
  .object({
    expectedState: z.enum(["unknown", "reconciling", "held"]),
    resolution: z.enum(["observed_delivered", "observed_absent_retry", "abandon"]),
    evidenceRef: z.string().min(8).max(160),
  })
  .strict();
export type ReconcileOutboxInput = z.infer<typeof ReconcileOutbox>;
/**
 * Owner-driven reconciliation of an uncertain protected run. The engine runs the handler's read-only
 * probe; evidenceRef is the owner's audited reference for why reconciliation is requested.
 */
export const ReconcileJobRun = z
  .object({
    expectedState: z.enum(["unknown", "reconciling"]),
    resolution: z.literal("probe_read_only"),
    evidenceRef: z.string().min(8).max(160),
  })
  .strict();
export type ReconcileJobRunInput = z.infer<typeof ReconcileJobRun>;
export const JobEngineStatus = z
  .object({
    state: z.enum(["unconfigured", "local_fixture", "local_inngest", "unavailable"]),
    reason: z.string().max(240),
    heldEnvironmentIds: z.array(Id),
  })
  .strict();
export const JobsOverview = z
  .object({
    engine: JobEngineStatus,
    definitions: z.array(JobDefinition).max(500),
    runs: z.array(JobRun).max(200),
    outbox: z.array(OutboxIntent).max(200),
  })
  .strict();
export type JobsOverviewView = z.infer<typeof JobsOverview>;
