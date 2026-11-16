import { z } from "zod";

export const PROJECT_KINDS = ["web", "api", "worker"] as const;
export const ENVIRONMENT_KINDS = ["development", "production", "preview", "recovery"] as const;
export const OPERATION_STATES = [
  "queued",
  "validating",
  "running",
  "waiting",
  "awaiting_approval",
  "cancel_requested",
  "reconciling",
  "succeeded",
  "failed",
  "cancelled",
  "unknown",
] as const;
export const CI_STATES = [
  "pending_verification",
  "queued",
  "running",
  "succeeded",
  "failed",
  "cancelled",
  "superseded",
  "unavailable",
] as const;
export type OperationState = (typeof OPERATION_STATES)[number];
export type CiState = (typeof CI_STATES)[number];

export const CreateProject = z
  .object({
    name: z.string().trim().min(2).max(80),
    slug: z.string().regex(/^[a-z][a-z0-9-]{1,62}$/),
    kind: z.enum(PROJECT_KINDS),
    description: z.string().trim().max(500).default(""),
  })
  .strict();
export type CreateProjectInput = z.input<typeof CreateProject>;

export const RepositoryConfiguration = z
  .object({
    fullName: z.string().regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/),
    repositoryId: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    installationId: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    branch: z.string().regex(/^(?!.*\.\.)(?!.*\/\/)(?!.*\/$)[A-Za-z0-9][A-Za-z0-9_./-]{0,199}$/),
    autoDeploy: z.boolean().default(false),
  })
  .strict();
export type RepositoryConfigurationInput = z.infer<typeof RepositoryConfiguration>;

export const OperationRequest = z
  .object({
    action: z.enum(["project.validate", "project.provision", "project.suspend", "project.resume"]),
    expectedRevision: z.number().int().min(0),
  })
  .strict();

export interface ProjectView {
  id: string;
  name: string;
  slug: string;
  kind: (typeof PROJECT_KINDS)[number];
  description: string;
  status: "draft" | "validated" | "suspended";
  revision: number;
  createdAt: string;
  updatedAt: string;
  repository: RepositoryConfigurationInput | null;
  environments: EnvironmentView[];
}

export interface EnvironmentView {
  id: string;
  projectId: string;
  kind: (typeof ENVIRONMENT_KINDS)[number];
  name: string;
  revision: number;
  expiresAt: string | null;
  recoveryHold: boolean;
  deliveryHold?: boolean;
  status: "planned" | "reserved" | "ready" | "suspended" | "unknown" | "quarantined" | "expired";
  requestedState: "ready" | "suspended" | null;
  isolationProfile: "gvisor-service-sandbox";
  memoryMiB: number;
  cpuMilliCores: number;
  diskGiB: number;
}

export interface OperationView {
  id: string;
  projectId: string | null;
  action: string;
  status: OperationState;
  revision: number;
  errorCode: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CiRunView {
  id: string;
  projectId: string;
  projectName: string;
  branch: string;
  commitSha: string;
  status: CiState;
  trigger: "push" | "pull_request" | "manual" | "scheduled";
  pullRequestNumber?: number | null;
  eventAction?: string | null;
  createdAt: string;
  updatedAt: string;
  errorCode: string | null;
}

export interface AuditView {
  id: string;
  sequence: number;
  actorId: string;
  projectId: string | null;
  action: string;
  summary: string;
  occurredAt: string;
}

export interface Capability {
  id: string;
  name: string;
  status: "local" | "unconfigured" | "configured" | "unqualified";
  description: string;
}

export interface Overview {
  mode: "local";
  projectCount: number;
  environmentCount: number;
  operationCount: number;
  ciRunCount: number;
  capabilities: Capability[];
  recentActivity: AuditView[];
  qualification: { completed: number; total: number; serverConnected: false };
}

export interface ApiErrorBody {
  error: { code: string; message: string; requestId: string };
}
