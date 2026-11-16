import type { ControlEndpoint } from "./http-endpoints.js";
import { EmptyRequest } from "./http-schemas.js";
import {
  AnswerOrchestration,
  DecideOrchestration,
  OrchestrationDetail,
  OrchestrationOverview,
  PrepareOrchestration,
  ProposeOrchestration,
} from "./orchestration.js";
export const ORCHESTRATION_HTTP_ENDPOINTS = [
  {
    method: "GET",
    path: "/agents/orchestration",
    operationId: "orchestrationOverview",
    response: OrchestrationOverview,
    success: 200,
    access: "owner",
  },
  {
    method: "POST",
    path: "/agents/orchestration/plans",
    operationId: "prepareOrchestration",
    request: PrepareOrchestration,
    response: OrchestrationDetail,
    success: 201,
    access: "owner",
    idempotent: true,
  },
  {
    method: "POST",
    path: "/agents/orchestration/proposals",
    operationId: "proposeOrchestration",
    request: ProposeOrchestration,
    response: OrchestrationDetail,
    success: 201,
    access: "owner",
    idempotent: true,
  },
  {
    method: "GET",
    path: "/agents/orchestration/plans/:id",
    operationId: "orchestrationDetail",
    response: OrchestrationDetail,
    success: 200,
    access: "owner",
  },
  ...(["approve", "reject", "cancel", "reconcile", "answer"] as const).map((action) => ({
    method: "POST" as const,
    path: `/agents/orchestration/plans/:id/${action}`,
    operationId: `${action}Orchestration`,
    request:
      action === "answer"
        ? AnswerOrchestration
        : action === "approve" || action === "reject"
          ? DecideOrchestration
          : EmptyRequest,
    response: OrchestrationDetail,
    success: action === "answer" ? 201 : 200,
    access: "owner" as const,
    idempotent: true as const,
  })),
] satisfies ControlEndpoint[];
