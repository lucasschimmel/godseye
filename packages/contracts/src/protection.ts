import { z } from "zod";
import { DATABASE_ROLES } from "./database.js";

const Id = z.string().uuid();
const Moment = z.string().datetime();
const Revision = z.number().int().positive();
const Count = z.number().int().nonnegative();
const Fingerprint = z.string().regex(/^[a-f0-9]{64}$/);
const Reason = z.string().max(100);
export const DatabaseRoleName = z.enum(DATABASE_ROLES);

/** Per-environment backup status derived from retained recovery evidence and the live provider state. */
export const BackupEnvironment = z
  .object({
    projectId: Id,
    environmentId: Id,
    allocationId: Id,
    status: z.enum(["healthy", "lagging", "headroom-low", "unknown"]),
    lastBaseBackup: z
      .object({ backupId: Id, kind: z.enum(["full", "diff"]), completedAt: Moment })
      .strict()
      .nullable(),
    archive: z
      .object({
        state: z.enum(["healthy", "lagging", "unknown"]),
        checkedAt: Moment.nullable(),
        lagSeconds: Count.nullable(),
        maxAgeSeconds: z.number().int().positive(),
      })
      .strict(),
    recoveryWindow: z.object({ from: Moment, to: Moment }).strict().nullable(),
    headroom: z
      .object({
        state: z.enum(["ok", "low", "unknown"]),
        archiveFreeGiB: z.number().nonnegative().nullable(),
        requiredGiB: z.number().int().positive(),
        repositoryUsedGiB: z.number().nonnegative().nullable(),
        repositoryGiB: z.number().int().positive(),
      })
      .strict(),
    reasons: z.array(Reason).max(10),
  })
  .strict();
export type BackupEnvironmentView = z.infer<typeof BackupEnvironment>;
export const BackupOverview = z
  .object({
    provider: z.enum(["unconfigured", "unavailable", "qualified"]),
    environments: z.array(BackupEnvironment).max(10000),
  })
  .strict();
export type BackupOverviewView = z.infer<typeof BackupOverview>;

export const RotateDatabaseRole = z
  .object({
    projectId: Id,
    environmentId: Id,
    allocationId: Id,
    role: DatabaseRoleName,
    slotId: Id.nullable(),
    expectedGeneration: Revision,
  })
  .strict();
export type RotateDatabaseRoleInput = z.infer<typeof RotateDatabaseRole>;
export const RotationRecord = z
  .object({
    id: Id,
    projectId: Id,
    environmentId: Id,
    allocationId: Id,
    role: DatabaseRoleName,
    slotId: Id.nullable(),
    state: z.enum(["intended", "applying", "succeeded", "failed", "unknown"]),
    reason: Reason.nullable(),
    generation: Revision,
    attempts: Count,
    previousVerifier: Fingerprint.nullable(),
    nextVerifier: Fingerprint.nullable(),
    createdAt: Moment,
    updatedAt: Moment,
    settledAt: Moment.nullable(),
  })
  .strict();
export type RotationRecordView = z.infer<typeof RotationRecord>;
export const RotationRole = z
  .object({
    projectId: Id,
    environmentId: Id,
    allocationId: Id,
    role: DatabaseRoleName,
    state: z.enum(["never-rotated", "in-progress", "succeeded", "failed", "unknown"]),
    lastRotationId: Id.nullable(),
    lastRotatedAt: Moment.nullable(),
    slot: z
      .object({
        id: Id,
        name: z.string().max(80),
        state: z.enum(["empty", "staged", "active", "unknown"]),
        activeVersion: Revision.nullable(),
        stagedVersion: Revision.nullable(),
        lastOperation: z
          .object({
            id: Id,
            kind: z.enum(["stage", "activate"]),
            state: z.enum(["pending", "unknown", "succeeded", "failed"]),
            createdAt: Moment,
          })
          .strict()
          .nullable(),
      })
      .strict()
      .nullable(),
  })
  .strict();
export type RotationRoleView = z.infer<typeof RotationRole>;
export const RotationOverview = z
  .object({
    execution: z.enum(["unconfigured", "unavailable", "qualified"]),
    roles: z.array(RotationRole).max(100000),
    rotations: z.array(RotationRecord).max(10000),
  })
  .strict();
export type RotationOverviewView = z.infer<typeof RotationOverview>;

export const INCIDENT_KINDS = ["archive-lag", "headroom", "rotation-failure"] as const;
export const AcknowledgeIncident = z.object({ expectedRevision: Revision }).strict();
export const ResolveIncident = AcknowledgeIncident;
export const MuteIncident = z.object({ expectedRevision: Revision, until: Moment }).strict();
export type AcknowledgeIncidentInput = z.infer<typeof AcknowledgeIncident>;
export type MuteIncidentInput = z.infer<typeof MuteIncident>;
export const Incident = z
  .object({
    id: Id,
    key: z.string().max(200),
    kind: z.enum(INCIDENT_KINDS),
    severity: z.enum(["warning", "critical"]),
    projectId: Id,
    environmentId: Id,
    allocationId: Id.nullable(),
    subject: z.string().max(60).nullable(),
    state: z.enum(["open", "acknowledged", "resolved"]),
    muted: z.boolean(),
    mutedUntil: Moment.nullable(),
    resolution: z.enum(["manual", "cleared"]).nullable(),
    reason: Reason,
    summary: z.string().max(300),
    occurrences: Revision,
    revision: Revision,
    /** `raised` is a record; only `delivery.state === "notified"` proves an external notification. */
    delivery: z
      .object({
        state: z.enum(["unconfigured", "pending", "notified", "failed"]),
        attempts: Count,
        lastAttemptAt: Moment.nullable(),
      })
      .strict(),
    firstRaisedAt: Moment,
    lastRaisedAt: Moment,
    acknowledgedAt: Moment.nullable(),
    resolvedAt: Moment.nullable(),
  })
  .strict();
export type IncidentView = z.infer<typeof Incident>;
export const IncidentOverview = z
  .object({
    notifier: z.enum(["unconfigured", "configured"]),
    incidents: z.array(Incident).max(10000),
  })
  .strict();
export type IncidentOverviewView = z.infer<typeof IncidentOverview>;
