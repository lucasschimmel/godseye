import { z } from "zod";
import { ActionCommand, CreateExecutionPlan, RegisterResource } from "./foundations.js";
import {
  CI_STATES,
  CreateProject,
  ENVIRONMENT_KINDS,
  OPERATION_STATES,
  OperationRequest,
  PROJECT_KINDS,
  RepositoryConfiguration,
} from "./http-domain.js";
import { OwnerSecurityResponse, OwnerStatusResponse } from "./owner.js";

export const HttpId = z.string().uuid();
const Integer = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const Moment = z.string().datetime();
const TextId = z.string().min(1).max(128);
const Hash = z.string().regex(/^[a-f0-9]{64}$/);
const Name = z.string().min(1).max(100);
export const IdempotencyKey = z.string().regex(/^[A-Za-z0-9._:-]{16,128}$/);
export const EmptyRequest = z.object({}).strict();
export const RepositoryUpdateRequest = z
  .object({ repository: RepositoryConfiguration, expectedRevision: Integer })
  .strict();
export const BudgetUpdateRequest = z
  .object({ limitMicros: Integer, expectedRevision: Integer })
  .strict();
export const ApprovalRequest = z.object({ expectedHash: Hash }).strict();
export const OwnerLocalCommandRequest = z.object({ intent: z.enum(["setup", "recover"]) }).strict();
export const LocalCommandResponse = z
  .object({ ticket: z.string().regex(/^[A-Za-z0-9_-]{43}$/), expiresAt: Moment })
  .strict();
export const RevocationResponse = z.object({ revoked: z.literal(true) }).strict();
export const HealthResponse = z
  .object({
    status: z.literal("ok"),
    mode: z.enum(["local", "server"]),
    serverConnected: z.boolean(),
  })
  .strict();
export const EnvironmentResponse = z
  .object({
    id: HttpId,
    projectId: HttpId,
    kind: z.enum(ENVIRONMENT_KINDS),
    name: z.string().regex(/^[a-z][a-z0-9-]{1,39}$/),
    revision: Integer,
    expiresAt: Moment.nullable(),
    recoveryHold: z.boolean(),
    deliveryHold: z.boolean().default(false),
    status: z.enum([
      "planned",
      "reserved",
      "ready",
      "suspended",
      "unknown",
      "quarantined",
      "expired",
    ]),
    requestedState: z.enum(["ready", "suspended"]).nullable(),
    isolationProfile: z.literal("gvisor-service-sandbox"),
    memoryMiB: Integer.positive(),
    cpuMilliCores: Integer.positive(),
    diskGiB: Integer.positive(),
  })
  .strict();
const RepositoryResponse = RepositoryConfiguration.omit({ autoDeploy: true }).extend({
  autoDeploy: z.boolean(),
});
export const ProjectResponse = z
  .object({
    id: HttpId,
    name: z.string().min(2).max(80),
    slug: z.string().regex(/^[a-z][a-z0-9-]{1,62}$/),
    kind: z.enum(PROJECT_KINDS),
    description: z.string().max(500),
    status: z.enum(["draft", "validated", "suspended"]),
    revision: Integer,
    createdAt: Moment,
    updatedAt: Moment,
    repository: RepositoryResponse.nullable(),
    environments: z.array(EnvironmentResponse).max(20),
  })
  .strict();
export const OperationResponse = z
  .object({
    id: HttpId,
    projectId: HttpId.nullable(),
    action: z.string().regex(/^[a-z]+\.[a-z]+$/),
    status: z.enum(OPERATION_STATES),
    revision: Integer,
    errorCode: z
      .string()
      .regex(/^[A-Z][A-Z0-9_]{1,63}$/)
      .nullable(),
    createdAt: Moment,
    updatedAt: Moment,
  })
  .strict();
export const CiRunResponse = z
  .object({
    id: HttpId,
    projectId: HttpId,
    projectName: Name,
    deliveryId: TextId.nullable(),
    branch: z.string().min(1).max(200),
    commitSha: z.string().regex(/^[a-f0-9]{40}$/),
    status: z.enum(CI_STATES),
    trigger: z.enum(["push", "pull_request", "manual", "scheduled"]),
    repositorySnapshot: RepositoryConfiguration.nullable(),
    pullRequestNumber: z.number().int().positive().nullable(),
    eventAction: z.string().max(64).nullable(),
    providerRef: z.string().max(256).nullable(),
    errorCode: z.string().max(64).nullable(),
    createdAt: Moment,
    updatedAt: Moment,
  })
  .strict();
export const AuditResponse = z
  .object({
    id: HttpId,
    sequence: Integer.positive(),
    actorId: TextId,
    projectId: HttpId.nullable(),
    action: z.string().min(1).max(100),
    summary: z.string().max(4096),
    occurredAt: Moment,
  })
  .strict();
export const CapabilityResponse = z
  .object({
    id: TextId,
    name: Name,
    status: z.enum(["local", "unconfigured", "configured", "unqualified"]),
    description: z.string().max(1024),
  })
  .strict();
export const OverviewResponse = z
  .object({
    mode: z.enum(["local", "server"]),
    projectCount: Integer,
    environmentCount: Integer,
    operationCount: Integer,
    ciRunCount: Integer,
    capabilities: z.array(CapabilityResponse).max(64),
    recentActivity: z.array(AuditResponse).max(100),
    qualification: z
      .object({ completed: Integer, total: Integer, serverConnected: z.boolean() })
      .strict(),
  })
  .strict();
export const ResourceResponse = RegisterResource.extend({ id: HttpId, createdAt: Moment });
export const BudgetResponse = z
  .object({
    projectId: HttpId,
    limitMicros: Integer,
    reservedMicros: Integer,
    spentMicros: Integer,
    revision: Integer,
  })
  .strict();
export const ExecutionPlanResponse = CreateExecutionPlan.extend({
  id: HttpId,
  hash: Hash,
  requiresApproval: z.boolean(),
  createdAt: Moment,
}).strict();
export const ExecutionRunResponse = OperationResponse.extend({
  planId: HttpId,
  environmentId: HttpId,
  epoch: Integer.positive(),
  fence: Integer,
  workerId: TextId.nullable(),
  leaseExpiresAt: Moment.nullable(),
  grantId: HttpId.nullable(),
  cleanupState: z.enum(["not_required", "pending", "running", "complete", "failed"]),
  reservedMicros: Integer,
  chargedMicros: Integer,
  terminalAt: Moment.nullable(),
}).strict();
export const AuditAnchorResponse = z
  .object({ sequence: Integer, hash: z.union([z.literal("genesis"), Hash]) })
  .strict();
export const AuditExportResponse = z
  .object({
    from: Integer,
    to: Integer,
    previousHash: z.union([z.literal("genesis"), Hash]),
    entries: z
      .array(
        AuditResponse.extend({
          previousHash: z.union([z.literal("genesis"), Hash]),
          hash: Hash,
        }).strict(),
      )
      .max(1000),
    anchor: AuditAnchorResponse,
  })
  .strict();
export const AuditExportQuery = z
  .object({
    cursor: z.string().regex(/^\d+$/).transform(Number).pipe(Integer).optional(),
    limit: z.string().regex(/^\d+$/).transform(Number).pipe(Integer.min(1).max(1000)).optional(),
  })
  .strict();
export const ControlErrorResponse = z
  .object({
    error: z
      .object({
        code: z.string().regex(/^[A-Z][A-Z0-9_]{1,63}$/),
        message: z.string().max(1024),
        requestId: HttpId,
      })
      .strict(),
  })
  .strict();
export const GithubDeliveryResponse = z
  .object({
    outcome: z.enum(["queued", "ignored", "duplicate"]),
    runId: HttpId.optional(),
    runIds: z.array(HttpId).max(10000).optional(),
  })
  .strict();
export const HttpSchemas = {
  HealthResponse,
  ProjectResponse,
  EnvironmentResponse,
  OperationResponse,
  CiRunResponse,
  AuditResponse,
  CapabilityResponse,
  OverviewResponse,
  ResourceResponse,
  BudgetResponse,
  ExecutionPlanResponse,
  ExecutionRunResponse,
  AuditAnchorResponse,
  AuditExportResponse,
  ControlErrorResponse,
  OwnerStatusResponse,
  OwnerSecurityResponse,
  RevocationResponse,
  LocalCommandResponse,
  GithubDeliveryResponse,
  CreateProject,
  RepositoryUpdateRequest,
  OperationRequest,
  RegisterResource,
  BudgetUpdateRequest,
  CreateExecutionPlan,
  ApprovalRequest,
  EmptyRequest,
  OwnerLocalCommandRequest,
  ActionCommand,
} as const;
export type ProjectDTO = z.infer<typeof ProjectResponse>;
export type ExecutionRunDTO = z.infer<typeof ExecutionRunResponse>;
