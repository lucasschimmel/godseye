import { z } from "zod";

const Id = z.string().uuid();
const Revision = z.number().int().nonnegative();
const Hash = z.string().regex(/^[a-f0-9]{64}$/);
const Moment = z.string().datetime();
export const RECOVERY_POLICY_VERSION = "pgbackrest-held-recovery-v1" as const;
export const BackupPolicy = z
  .object({
    fullRetention: z.number().int().min(2).max(4),
    differentialRetention: z.number().int().min(1).max(30),
    repositoryGiB: z.number().int().min(1).max(16384),
    stagingGiB: z.number().int().min(1).max(4096),
    archiveHeadroomGiB: z.number().int().min(1).max(1024),
    maxArchiveAgeSeconds: z.number().int().min(60).max(86400),
  })
  .strict();
export type BackupPolicyInput = z.infer<typeof BackupPolicy>;
export const PrepareBackup = z
  .object({
    projectId: Id,
    environmentId: Id,
    sourceAllocationId: Id,
    expectedProjectRevision: Revision,
    expectedEnvironmentRevision: Revision,
    kind: z.enum(["full", "diff"]),
    policy: BackupPolicy,
  })
  .strict();
export type PrepareBackupInput = z.infer<typeof PrepareBackup>;
export const PrepareRestore = z
  .object({
    projectId: Id,
    sourceEnvironmentId: Id,
    backupId: Id,
    expectedProjectRevision: Revision,
    expectedEnvironmentRevision: Revision,
    targetTime: Moment,
    name: z.string().regex(/^[a-z][a-z0-9-]{1,39}$/),
  })
  .strict();
export type PrepareRestoreInput = z.infer<typeof PrepareRestore>;
export const PrepareArchiveCheck = PrepareRestore.omit({ targetTime: true, name: true }).strict();
export type PrepareArchiveCheckInput = z.infer<typeof PrepareArchiveCheck>;
export const AdmitRecovery = z.object({ preparationId: Id, expectedHash: Hash }).strict();
export type AdmitRecoveryInput = z.infer<typeof AdmitRecovery>;
export const RecoveryPreparation = z
  .object({
    id: Id,
    projectId: Id,
    sourceEnvironmentId: Id,
    sourceAllocationId: Id,
    environmentId: Id,
    allocationId: Id,
    kind: z.enum(["full", "diff", "restore", "check"]),
    backupId: Id.nullable(),
    targetTime: Moment.nullable(),
    name: z.string().nullable(),
    expectedProjectRevision: Revision,
    expectedEnvironmentRevision: Revision,
    policy: BackupPolicy,
    policyVersion: z.literal(RECOVERY_POLICY_VERSION),
    hash: Hash,
    createdAt: Moment,
  })
  .strict();
export type RecoveryPreparationView = z.infer<typeof RecoveryPreparation>;
export const RecoveryCoverage = z
  .object({
    databaseAt: Moment,
    filesAt: Moment.nullable(),
    authAt: Moment.nullable(),
    configAt: Moment.nullable(),
    missing: z
      .array(z.enum(["files", "auth", "config", "effect-history", "producer-fencing"]))
      .max(5),
  })
  .strict();
export const RecoveryBackup = z
  .object({
    id: Id,
    preparationId: Id,
    projectId: Id,
    environmentId: Id,
    sourceAllocationId: Id,
    status: z.enum([
      "backup-created",
      "archive-healthy",
      "restore-verified",
      "stale",
      "failed",
      "unavailable",
    ]),
    kind: z.enum(["full", "diff"]),
    createdAt: Moment,
    verifiedAt: Moment.nullable(),
    archiveCheckedAt: Moment,
    recoverableFrom: Moment.nullable(),
    recoverableTo: Moment.nullable(),
    coverage: RecoveryCoverage,
    reason: z.string().max(100).nullable(),
  })
  .strict();
export type RecoveryBackupView = z.infer<typeof RecoveryBackup>;
export const RecoveryRun = z
  .object({
    id: Id,
    preparationId: Id,
    runId: Id,
    projectId: Id,
    environmentId: Id,
    allocationId: Id,
    kind: z.enum(["full", "diff", "restore", "check"]),
    state: z.enum([
      "reserved",
      "unknown",
      "backup-created",
      "archive-checked",
      "restore-verified",
      "released",
    ]),
    recoveryHold: z.boolean(),
    reason: z.string().max(100).nullable(),
    updatedAt: Moment,
  })
  .strict();
export type RecoveryRunView = z.infer<typeof RecoveryRun>;
/** Machine-verified conditions that refuse activation until they are resolved. */
export const ACTIVATION_BLOCKER_CODES = [
  "RESTORE_NOT_VERIFIED",
  "PROJECT_NOT_ACTIVE",
  "SOURCE_NOT_ACTIVE",
  "SOURCE_WORK_IN_FLIGHT",
  "UNRECONCILED_EFFECTS",
  "PROMOTION_UNAVAILABLE",
] as const;
/**
 * Coverage the platform cannot establish for a database-only restore. The owner must acknowledge each one
 * by name; activation never infers that an empty or truncated journal means nothing happened.
 */
export const ACTIVATION_ACKNOWLEDGEMENTS = [
  "FILES_SNAPSHOT_MISSING",
  "AUTH_SNAPSHOT_MISSING",
  "CONFIG_SNAPSHOT_MISSING",
  "NON_REWOUND_BUSINESS_EFFECT_COVERAGE_UNQUALIFIED",
] as const;
export const ActivationAssessment = z
  .object({
    environmentId: Id,
    sourceEnvironmentId: Id.nullable(),
    recoveryHold: z.literal(true),
    activation: z.enum(["blocked", "ready"]),
    reasons: z.array(z.enum(ACTIVATION_BLOCKER_CODES)).max(20),
    requiredAcknowledgements: z.array(z.enum(ACTIVATION_ACKNOWLEDGEMENTS)).max(10),
    /** Set when an earlier activation already fenced the source and still has to prove promotion. */
    pending: z.enum(["fenced", "unknown"]).nullable(),
    /** Definitions that stay with the fenced source environment and are not moved by activation. */
    retainedDefinitions: z
      .object({
        jobs: z.number().int().nonnegative(),
        backend: z.number().int().nonnegative(),
        domains: z.number().int().nonnegative(),
      })
      .strict(),
  })
  .strict();
export type ActivationAssessmentView = z.infer<typeof ActivationAssessment>;
export const ActivateRestore = z
  .object({
    expectedProjectRevision: Revision,
    expectedEnvironmentRevision: Revision,
    confirmName: z.string().min(2).max(40),
    acknowledged: z.array(z.enum(ACTIVATION_ACKNOWLEDGEMENTS)).max(10),
  })
  .strict();
export type ActivateRestoreInput = z.infer<typeof ActivateRestore>;
/**
 * `fenced` means the source is already fenced and promotion is not proven; `unknown` means a provider
 * outcome is uncertain. Both are resumed by repeating the command; neither makes the restore active.
 */
export const RestoreActivation = z
  .object({
    id: Id,
    projectId: Id,
    environmentId: Id,
    sourceEnvironmentId: Id,
    state: z.enum(["fenced", "unknown", "activated"]),
    epoch: z.number().int().positive(),
    acknowledged: z.array(z.enum(ACTIVATION_ACKNOWLEDGEMENTS)).max(10),
    reason: z.string().max(100).nullable(),
    createdAt: Moment,
    activatedAt: Moment.nullable(),
  })
  .strict();
export type RestoreActivationView = z.infer<typeof RestoreActivation>;
export const RecoveryOverview = z
  .object({
    execution: z.enum(["unconfigured", "qualified"]),
    activation: z.enum(["blocked", "owner-confirmed"]),
    schedule: z.literal("prepared-only"),
    preparations: z.array(RecoveryPreparation).max(10000),
    backups: z.array(RecoveryBackup).max(10000),
    runs: z.array(RecoveryRun).max(10000),
  })
  .strict();
export type RecoveryOverviewView = z.infer<typeof RecoveryOverview>;
