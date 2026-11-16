import { z } from "zod";
import { ACCESS_HTTP_ENDPOINTS } from "./access-endpoints.js";
import { AGENT_CHAT_HTTP_ENDPOINTS } from "./agents-chat-endpoints.js";
import { AGENT_CHAT_TRANSPORT_ENDPOINTS } from "./agents-chat-transport-endpoints.js";
import { AGENT_HTTP_ENDPOINTS } from "./agents-endpoints.js";
import { AGENT_TOOLS_HTTP_ENDPOINTS } from "./agents-tools-endpoints.js";
import { BACKEND_HTTP_ENDPOINTS } from "./backend-endpoints.js";
import { CODING_HTTP_ENDPOINTS } from "./coding-endpoints.js";
import { LOCAL_DEFAULTS } from "./config.js";
import { DATABASE_HTTP_ENDPOINTS } from "./database-endpoints.js";
import { DELIVERY_HTTP_ENDPOINTS } from "./delivery-endpoints.js";
import { DOMAIN_HTTP_ENDPOINTS } from "./domains-endpoints.js";
import { CreateExecutionPlan, RegisterResource } from "./foundations.js";
import { CreateProject, OperationRequest } from "./http-domain.js";
import {
  ApprovalRequest,
  AuditAnchorResponse,
  AuditExportResponse,
  AuditResponse,
  BudgetResponse,
  BudgetUpdateRequest,
  CiRunResponse,
  EmptyRequest,
  ExecutionPlanResponse,
  ExecutionRunResponse,
  GithubDeliveryResponse,
  HealthResponse,
  HttpId,
  LocalCommandResponse,
  OperationResponse,
  OverviewResponse,
  OwnerLocalCommandRequest,
  ProjectResponse,
  RepositoryUpdateRequest,
  ResourceResponse,
  RevocationResponse,
} from "./http-schemas.js";
import { INFRASTRUCTURE_HTTP_ENDPOINTS } from "./infra-endpoints.js";
import { JOBS_HTTP_ENDPOINTS } from "./jobs-endpoints.js";
import { LIFECYCLE_HTTP_ENDPOINTS } from "./lifecycle-endpoints.js";
import { OBSERVABILITY_HTTP_ENDPOINTS } from "./observability-endpoints.js";
import { ORCHESTRATION_HTTP_ENDPOINTS } from "./orchestration-endpoints.js";
import { OwnerSecurityResponse, OwnerStatusResponse } from "./owner.js";
import { PROTECTION_HTTP_ENDPOINTS } from "./protection-endpoints.js";
import { RECOVERY_HTTP_ENDPOINTS } from "./recovery-endpoints.js";
import { USAGE_HTTP_ENDPOINTS } from "./usage-endpoints.js";

export const CONTROL_API_VERSION = "1.17.0" as const;
export const CONTROL_API_HEADER = "x-godseye-api-version" as const;
export interface ControlEndpoint {
  method: "GET" | "POST" | "PUT";
  path: string;
  operationId: string;
  response: z.ZodType;
  success: number;
  access: "public" | "owner" | "local-proof" | "github-signature";
  request?: z.ZodType;
  query?: z.ZodType;
  idempotent?: true;
  textId?: true;
  transport?: "sse" | "attachment";
}
const owner = "owner" as const;
/** Relative paths are rooted at the versioned control API; the webhook is an explicit exception. */
export const CONTROL_HTTP_ENDPOINTS = [
  ...USAGE_HTTP_ENDPOINTS,
  ...OBSERVABILITY_HTTP_ENDPOINTS,
  ...AGENT_CHAT_TRANSPORT_ENDPOINTS,
  ...ACCESS_HTTP_ENDPOINTS,
  ...CODING_HTTP_ENDPOINTS,
  ...ORCHESTRATION_HTTP_ENDPOINTS,
  ...AGENT_HTTP_ENDPOINTS,
  ...AGENT_TOOLS_HTTP_ENDPOINTS,
  ...AGENT_CHAT_HTTP_ENDPOINTS,
  ...BACKEND_HTTP_ENDPOINTS,
  ...DATABASE_HTTP_ENDPOINTS,
  ...DELIVERY_HTTP_ENDPOINTS,
  ...DOMAIN_HTTP_ENDPOINTS,
  ...JOBS_HTTP_ENDPOINTS,
  ...LIFECYCLE_HTTP_ENDPOINTS,
  ...RECOVERY_HTTP_ENDPOINTS,
  ...PROTECTION_HTTP_ENDPOINTS,
  ...INFRASTRUCTURE_HTTP_ENDPOINTS,
  {
    method: "GET",
    path: "/health",
    operationId: "health",
    response: HealthResponse,
    success: 200,
    access: "public",
  },
  {
    method: "GET",
    path: "/owner/session",
    operationId: "ownerSession",
    response: OwnerStatusResponse,
    success: 200,
    access: "public",
  },
  {
    method: "GET",
    path: "/owner/security",
    operationId: "ownerSecurity",
    response: OwnerSecurityResponse,
    success: 200,
    access: owner,
  },
  {
    method: "POST",
    path: "/owner/local-command",
    operationId: "localOwnerCommand",
    request: OwnerLocalCommandRequest,
    response: LocalCommandResponse,
    success: 200,
    access: "local-proof",
  },
  {
    method: "POST",
    path: "/owner/sessions/:id/revoke",
    operationId: "revokeSession",
    request: EmptyRequest,
    response: RevocationResponse,
    success: 200,
    access: owner,
    idempotent: true,
    textId: true,
  },
  {
    method: "POST",
    path: "/owner/passkeys/:id/revoke",
    operationId: "revokePasskey",
    request: EmptyRequest,
    response: RevocationResponse,
    success: 200,
    access: owner,
    idempotent: true,
    textId: true,
  },
  {
    method: "GET",
    path: "/overview",
    operationId: "overview",
    response: OverviewResponse,
    success: 200,
    access: owner,
  },
  {
    method: "GET",
    path: "/projects",
    operationId: "listProjects",
    response: z.array(ProjectResponse).max(10000),
    success: 200,
    access: owner,
  },
  {
    method: "POST",
    path: "/projects",
    operationId: "createProject",
    request: CreateProject,
    response: ProjectResponse,
    success: 201,
    access: owner,
    idempotent: true,
  },
  {
    method: "GET",
    path: "/projects/:id",
    operationId: "getProject",
    response: ProjectResponse,
    success: 200,
    access: owner,
  },
  {
    method: "PUT",
    path: "/projects/:id/repository",
    operationId: "configureRepository",
    request: RepositoryUpdateRequest,
    response: ProjectResponse,
    success: 200,
    access: owner,
    idempotent: true,
  },
  {
    method: "POST",
    path: "/projects/:id/operations",
    operationId: "requestOperation",
    request: OperationRequest,
    response: OperationResponse,
    success: 201,
    access: owner,
    idempotent: true,
  },
  {
    method: "GET",
    path: "/operations",
    operationId: "listOperations",
    response: z.array(OperationResponse).max(10000),
    success: 200,
    access: owner,
  },
  {
    method: "GET",
    path: "/operations/:id",
    operationId: "getOperation",
    response: OperationResponse,
    success: 200,
    access: owner,
  },
  {
    method: "GET",
    path: "/ci/runs",
    operationId: "listCiRuns",
    response: z.array(CiRunResponse).max(10000),
    success: 200,
    access: owner,
  },
  {
    method: "GET",
    path: "/audit",
    operationId: "listAudit",
    response: z.array(AuditResponse).max(100),
    success: 200,
    access: owner,
  },
  {
    method: "POST",
    path: "/foundation/resources",
    operationId: "registerResource",
    request: RegisterResource,
    response: ResourceResponse,
    success: 201,
    access: owner,
    idempotent: true,
  },
  {
    method: "GET",
    path: "/foundation/budgets/:projectId",
    operationId: "getBudget",
    response: BudgetResponse,
    success: 200,
    access: owner,
  },
  {
    method: "PUT",
    path: "/foundation/budgets/:projectId",
    operationId: "configureBudget",
    request: BudgetUpdateRequest,
    response: BudgetResponse,
    success: 200,
    access: owner,
    idempotent: true,
  },
  {
    method: "POST",
    path: "/foundation/plans",
    operationId: "createPlan",
    request: CreateExecutionPlan,
    response: ExecutionPlanResponse,
    success: 201,
    access: owner,
    idempotent: true,
  },
  {
    method: "GET",
    path: "/foundation/plans/:id",
    operationId: "getPlan",
    response: ExecutionPlanResponse,
    success: 200,
    access: owner,
  },
  {
    method: "POST",
    path: "/foundation/plans/:id/approve",
    operationId: "approvePlan",
    request: ApprovalRequest,
    response: ExecutionPlanResponse,
    success: 200,
    access: owner,
    idempotent: true,
  },
  {
    method: "POST",
    path: "/foundation/plans/:id/enqueue",
    operationId: "enqueuePlan",
    request: EmptyRequest,
    response: ExecutionRunResponse,
    success: 201,
    access: owner,
    idempotent: true,
  },
  {
    method: "GET",
    path: "/foundation/runs",
    operationId: "listRuns",
    response: z.array(ExecutionRunResponse).max(10000),
    success: 200,
    access: owner,
  },
  {
    method: "GET",
    path: "/foundation/runs/:id",
    operationId: "getRun",
    response: ExecutionRunResponse,
    success: 200,
    access: owner,
  },
  {
    method: "POST",
    path: "/foundation/runs/:id/cancel",
    operationId: "cancelRun",
    request: EmptyRequest,
    response: ExecutionRunResponse,
    success: 200,
    access: owner,
    idempotent: true,
  },
  {
    method: "POST",
    path: "/foundation/runs/:id/reconcile",
    operationId: "reconcileRun",
    request: EmptyRequest,
    response: ExecutionRunResponse,
    success: 200,
    access: owner,
    idempotent: true,
  },
  {
    method: "GET",
    path: "/audit/export",
    operationId: "exportAudit",
    response: AuditExportResponse,
    success: 200,
    access: owner,
  },
  {
    method: "GET",
    path: "/audit/anchor",
    operationId: "auditAnchor",
    response: AuditAnchorResponse,
    success: 200,
    access: owner,
  },
  {
    method: "POST",
    path: "/hooks/github",
    operationId: "githubDelivery",
    response: GithubDeliveryResponse,
    success: 202,
    access: "github-signature",
  },
] as const satisfies readonly ControlEndpoint[];
export const CONTROL_ENDPOINTS = CONTROL_HTTP_ENDPOINTS;
export function controlPath(path: string) {
  const pathname = new URL(path, "http://control.invalid").pathname;
  return pathname.startsWith(`${LOCAL_DEFAULTS.apiBase}/`)
    ? pathname.slice(LOCAL_DEFAULTS.apiBase.length)
    : pathname;
}
export function findControlEndpoint(method: string, path: string): ControlEndpoint | undefined {
  const pathname = controlPath(path);
  return CONTROL_HTTP_ENDPOINTS.find(
    (endpoint) =>
      endpoint.method === method.toUpperCase() &&
      new RegExp(`^${endpoint.path.replace(/:[A-Za-z]+/g, "[^/]+")}$`).test(pathname),
  );
}
export function endpointParameters(endpoint: ControlEndpoint) {
  return [...endpoint.path.matchAll(/:([A-Za-z]+)/g)].map((match) => ({
    name: match[1] ?? "id",
    schema: endpoint.textId ? z.string().regex(/^[A-Za-z0-9_-]{1,128}$/) : HttpId,
  }));
}
