import { z } from "zod";
import { RepositoryConfiguration } from "./http-domain.js";

const Id = z.string().uuid();
const Hash = z.string().regex(/^[a-f0-9]{64}$/);
const Moment = z.string().datetime();
const Revision = z.number().int().nonnegative();
export const DELIVERY_POLICY_VERSION = "delivery-v1" as const;
export const DELIVERY_INTENTS = ["build", "release", "rollback", "cleanup"] as const;
export const DeliveryLimits = z
  .object({
    cpuMilliCores: z.number().int().min(10).max(64000),
    memoryMiB: z.number().int().min(32).max(262144),
    storageGiB: z.number().int().min(1).max(4096),
    pids: z.number().int().min(8).max(4096),
  })
  .strict();
export const DeliveryRecipe = z
  .object({
    kind: z.enum(["static", "node"]),
    context: z
      .string()
      .max(160)
      .regex(/^(?:\.|[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*)$/),
  })
  .strict();
export const CreateDeliveryPolicy = z
  .object({
    projectId: Id,
    environmentId: Id,
    expectedProjectRevision: Revision,
    expectedEnvironmentRevision: Revision,
    recipe: DeliveryRecipe,
    requiredChecks: z
      .array(z.string().regex(/^[a-z][a-z0-9.-]{0,63}$/))
      .min(1)
      .max(16),
    maxArtifactMiB: z.number().int().min(1).max(4096),
    maxConcurrentPreviews: z.number().int().min(0).max(8),
    previewTtlHours: z.number().int().min(1).max(720),
    limits: DeliveryLimits,
    autoDeploy: z.boolean(),
    expiresAt: Moment,
  })
  .strict();
export type CreateDeliveryPolicyInput = z.infer<typeof CreateDeliveryPolicy>;
export const DeliveryPolicy = CreateDeliveryPolicy.extend({
  id: Id,
  repository: RepositoryConfiguration,
  revision: Revision,
  hash: Hash,
  revokedAt: Moment.nullable(),
  createdAt: Moment,
}).strict();
export type DeliveryPolicyView = z.infer<typeof DeliveryPolicy>;
export const PrepareDelivery = z
  .object({
    policyId: Id,
    ciRunId: Id,
    intent: z.enum(DELIVERY_INTENTS),
    artifactId: Id.optional(),
    deploymentId: Id.optional(),
  })
  .strict();
export type PrepareDeliveryInput = z.infer<typeof PrepareDelivery>;
export const AdmitDelivery = z.object({ preparationId: Id, expectedHash: Hash }).strict();
export type AdmitDeliveryInput = z.infer<typeof AdmitDelivery>;
export const DeliveryPreparation = z
  .object({
    id: Id,
    policyId: Id,
    projectId: Id,
    environmentId: Id,
    ciRunId: Id,
    intent: z.enum(DELIVERY_INTENTS),
    commitSha: z.string().regex(/^[a-f0-9]{40}$/),
    artifactId: Id.nullable(),
    deploymentId: Id.nullable(),
    hash: Hash,
    createdAt: Moment,
  })
  .strict();
export type DeliveryPreparationView = z.infer<typeof DeliveryPreparation>;
export const DeliveryArtifact = z
  .object({
    id: Id,
    preparationId: Id,
    projectId: Id,
    environmentId: Id,
    ciRunId: Id,
    commitSha: z.string().regex(/^[a-f0-9]{40}$/),
    digest: z.string().regex(/^sha256:[a-f0-9]{64}$/),
    sizeBytes: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    recipeHash: Hash,
    checks: z.array(z.object({ name: z.string().max(64), passed: z.boolean() }).strict()).max(32),
    scan: z.literal("passed"),
    provenanceHash: Hash,
    createdAt: Moment,
  })
  .strict();
export type DeliveryArtifactView = z.infer<typeof DeliveryArtifact>;
export const DeliveryRun = z
  .object({
    id: Id,
    preparationId: Id,
    runId: Id,
    projectId: Id,
    environmentId: Id,
    intent: z.enum(DELIVERY_INTENTS),
    state: z.enum([
      "reserved",
      "building",
      "built",
      "staged",
      "active",
      "retired",
      "released",
      "unknown",
      "quarantined",
    ]),
    artifactId: Id.nullable(),
    previousDeploymentId: Id.nullable(),
    reason: z.string().max(100).nullable(),
    updatedAt: Moment,
  })
  .strict();
export type DeliveryRunView = z.infer<typeof DeliveryRun>;
export const DeliveryPreview = z
  .object({
    id: Id,
    policyId: Id,
    projectId: Id,
    environmentId: Id,
    pullRequestNumber: z.number().int().positive(),
    state: z.enum(["prepared", "active", "cleanup-required", "retired", "unknown"]),
    dataPolicy: z.literal("synthetic-only"),
    url: z
      .string()
      .url()
      .max(512)
      .refine((value) => {
        if (!URL.canParse(value)) return false;
        const url = new URL(value);
        return url.protocol === "https:" && !url.username && !url.password;
      })
      .nullable(),
    expiresAt: Moment,
    updatedAt: Moment,
  })
  .strict();
export type DeliveryPreviewView = z.infer<typeof DeliveryPreview>;
export const DeliveryOverview = z
  .object({
    source: z.enum(["unconfigured", "configured"]),
    execution: z.enum(["unconfigured", "configured"]),
    remoteQualification: z.literal("unqualified"),
    policies: z.array(DeliveryPolicy).max(10000),
    preparations: z.array(DeliveryPreparation).max(10000),
    artifacts: z.array(DeliveryArtifact).max(10000),
    deployments: z.array(DeliveryRun).max(10000),
    previews: z.array(DeliveryPreview).max(10000),
  })
  .strict();
export type DeliveryOverviewView = z.infer<typeof DeliveryOverview>;
export const SynchronizeDelivery = z.object({ policyId: Id }).strict();
export const SynchronizeDeliveryResult = z
  .object({
    prepared: z.array(Id).max(1000),
    blocked: z.number().int().nonnegative(),
  })
  .strict();
