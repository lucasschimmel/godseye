import { z } from "zod";

const Id = z.string().uuid();
const Moment = z.string().datetime();
const Revision = z.number().int().nonnegative();
const Digest = z.string().regex(/^[a-f0-9]{64}$/);
const Reason = z.string().trim().min(3).max(100);

/** Deleted-cell quarantine default from the isolation retention table (seven days). */
export const QUARANTINE_RETENTION_DAYS = 7;
export const PROJECT_LIFECYCLE_PHASES = ["active", "suspended", "quarantined", "purged"] as const;
export const LIFECYCLE_SERVICES = [
  "jobs",
  "backend",
  "delivery",
  "databases",
  "cells",
  "backups",
] as const;
export const LIFECYCLE_RESIDUAL_KINDS = [
  "database",
  "cell",
  "delivery-run",
  "preview",
  "backup",
] as const;

export const SuspendProject = z.object({ expectedRevision: Revision, reason: Reason }).strict();
export const ResumeProject = z.object({ expectedRevision: Revision }).strict();
export const CreateProjectExport = z.object({ expectedRevision: Revision }).strict();
export const QuarantineProject = z
  .object({ expectedRevision: Revision, exportId: Id, reason: Reason })
  .strict();
export const ReleaseQuarantine = z.object({ expectedRevision: Revision }).strict();
export const PurgeProject = z
  .object({ expectedRevision: Revision, confirmSlug: z.string().min(2).max(63) })
  .strict();
export type SuspendProjectInput = z.infer<typeof SuspendProject>;
export type ResumeProjectInput = z.infer<typeof ResumeProject>;
export type CreateProjectExportInput = z.infer<typeof CreateProjectExport>;
export type QuarantineProjectInput = z.infer<typeof QuarantineProject>;
export type ReleaseQuarantineInput = z.infer<typeof ReleaseQuarantine>;
export type PurgeProjectInput = z.infer<typeof PurgeProject>;

/** `enforced` means the platform's own scheduler/runtime gate blocks it; physical stop needs a provider. */
export const LifecycleService = z
  .object({
    service: z.enum(LIFECYCLE_SERVICES),
    state: z.enum(["enforced", "pending-provider", "none"]),
    detail: z.string().max(200),
  })
  .strict();
export const LifecycleResidual = z
  .object({
    kind: z.enum(LIFECYCLE_RESIDUAL_KINDS),
    id: Id,
    state: z.string().max(40),
  })
  .strict();
export const LIFECYCLE_BLOCKER_CODES = [
  "SUSPEND_REQUIRED",
  "EXPORT_REQUIRED",
  "ACTIVE_JOB_RUNS",
  "ACTIVE_OUTBOX_EFFECTS",
  "ACTIVE_OPERATIONS",
  "ACTIVE_ROTATIONS",
  "UNCONFIRMED_ALLOCATIONS",
  "RETENTION_ACTIVE",
  "RESIDUAL_RESOURCES",
  "ALREADY_PURGED",
] as const;
/** A machine-readable reason a stage is unavailable; `count` is 1 when the reason is not countable. */
export const LifecycleBlocker = z
  .object({
    code: z.enum(LIFECYCLE_BLOCKER_CODES),
    count: z.number().int().positive(),
  })
  .strict();
export type LifecycleBlockerView = z.infer<typeof LifecycleBlocker>;
export const ProjectExportSummary = z
  .object({
    id: Id,
    projectId: Id,
    projectRevision: Revision,
    digest: Digest,
    createdAt: Moment,
  })
  .strict();
export const ProjectExport = ProjectExportSummary.extend({
  manifest: z.record(z.string(), z.unknown()),
}).strict();
export const ProjectLifecycle = z
  .object({
    projectId: Id,
    slug: z.string(),
    phase: z.enum(PROJECT_LIFECYCLE_PHASES),
    revision: Revision,
    reason: z.string().nullable(),
    suspendedAt: Moment.nullable(),
    quarantinedAt: Moment.nullable(),
    purgeAfter: Moment.nullable(),
    purgedAt: Moment.nullable(),
    services: z.array(LifecycleService),
    residual: z.array(LifecycleResidual),
    exports: z.array(ProjectExportSummary),
    quarantinable: z.boolean(),
    purgeable: z.boolean(),
    blockers: z.array(LifecycleBlocker),
  })
  .strict();
export type ProjectLifecycleView = z.infer<typeof ProjectLifecycle>;
export type ProjectExportView = z.infer<typeof ProjectExport>;
export type ProjectExportSummaryView = z.infer<typeof ProjectExportSummary>;
