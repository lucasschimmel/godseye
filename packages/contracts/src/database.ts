import { z } from "zod";

const Id = z.string().uuid();
const Revision = z.number().int().nonnegative();
const Hash = z.string().regex(/^[a-f0-9]{64}$/);
export const DATABASE_POLICY_VERSION = "independent-postgres-18-v1" as const;
export const DATABASE_ROLES = [
  "migration",
  "api",
  "worker",
  "auth",
  "reader",
  "backup",
  "workflow",
  "workflowMigration",
] as const;
export type DatabaseRole = (typeof DATABASE_ROLES)[number];
export const DatabaseProfile = z
  .object({
    engine: z.literal("postgresql"),
    majorVersion: z.literal(18),
    cpuMilliCores: z.number().int().min(100).max(16000),
    memoryMiB: z.number().int().min(128).max(65536),
    dataGiB: z.number().int().min(1).max(1024),
    walGiB: z.number().int().min(1).max(128),
    temporaryMiB: z.number().int().min(16).max(2048),
    maxConnections: z.number().int().min(32).max(256),
  })
  .strict();
export type DatabaseProfileInput = z.infer<typeof DatabaseProfile>;
export const PrepareDatabase = z
  .object({
    projectId: Id,
    environmentId: Id,
    expectedProjectRevision: Revision,
    expectedEnvironmentRevision: Revision,
    profile: DatabaseProfile,
  })
  .strict();
export type PrepareDatabaseInput = z.infer<typeof PrepareDatabase>;
export const AdmitDatabase = z
  .object({
    preparationId: Id,
    expectedHash: Hash,
    intent: z.enum(["provision", "suspend", "resume"]),
  })
  .strict();
export type AdmitDatabaseInput = z.infer<typeof AdmitDatabase>;
export const DatabasePreparation = z
  .object({
    id: Id,
    allocationId: Id,
    projectId: Id,
    environmentId: Id,
    expectedProjectRevision: Revision,
    expectedEnvironmentRevision: Revision,
    hash: Hash,
    profile: DatabaseProfile,
    policyVersion: z.literal(DATABASE_POLICY_VERSION),
    createdAt: z.string().datetime(),
  })
  .strict();
export type DatabasePreparationView = z.infer<typeof DatabasePreparation>;
export const DatabaseAllocation = z
  .object({
    id: Id,
    preparationId: Id,
    projectId: Id,
    environmentId: Id,
    runId: Id,
    state: z.enum(["reserved", "ready", "suspended", "unknown", "quarantined", "released"]),
    requestedState: z.enum(["ready", "suspended"]),
    generation: Revision.positive(),
    reason: z.string().max(100).nullable(),
    updatedAt: z.string().datetime(),
  })
  .strict();
export type DatabaseAllocationView = z.infer<typeof DatabaseAllocation>;
/** Derived, never declared: unconfigured and unavailable are distinct from none, unknown and healthy. */
export const ProtectionState = z.enum([
  "unconfigured",
  "unavailable",
  "none",
  "unknown",
  "healthy",
  "degraded",
]);
export type ProtectionStateView = z.infer<typeof ProtectionState>;
export const DatabaseOverview = z
  .object({
    execution: z.enum(["unconfigured", "qualified"]),
    backup: ProtectionState,
    restore: ProtectionState,
    rotation: ProtectionState,
    preparations: z.array(DatabasePreparation).max(10000),
    allocations: z.array(DatabaseAllocation).max(10000),
  })
  .strict();
export type DatabaseOverviewView = z.infer<typeof DatabaseOverview>;

export const UpdateProject = z
  .object({
    expectedRevision: Revision,
    name: z.string().trim().min(2).max(80),
    description: z.string().trim().max(500),
  })
  .strict();
export type UpdateProjectInput = z.infer<typeof UpdateProject>;
export const CreateEnvironment = z
  .object({
    expectedProjectRevision: Revision,
    name: z.string().regex(/^[a-z][a-z0-9-]{1,39}$/),
    kind: z.literal("preview"),
    expiresAt: z.string().datetime(),
    memoryMiB: z.number().int().min(128).max(65536),
    cpuMilliCores: z.number().int().min(100).max(16000),
    diskGiB: z.number().int().min(1).max(1024),
  })
  .strict();
export type CreateEnvironmentInput = z.infer<typeof CreateEnvironment>;
export const UpdateEnvironment = CreateEnvironment.omit({
  expectedProjectRevision: true,
  kind: true,
})
  .extend({
    expectedProjectRevision: Revision,
    expectedRevision: Revision,
    expiresAt: z.string().datetime().nullable(),
  })
  .strict();
export type UpdateEnvironmentInput = z.infer<typeof UpdateEnvironment>;
