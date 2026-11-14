import {
  AdmitCodingTask,
  CodingOverview,
  CodingPreparation,
  CodingTask,
  CodingTaskDetail,
  PrepareCodingTask,
} from "./coding.js";
import type { ControlEndpoint } from "./http-endpoints.js";
import { EmptyRequest } from "./http-schemas.js";

export const CODING_HTTP_ENDPOINTS = [
  {
    method: "GET",
    path: "/agents/coding",
    operationId: "codingOverview",
    response: CodingOverview,
    success: 200,
    access: "owner",
  },
  {
    method: "POST",
    path: "/agents/coding/preparations",
    operationId: "prepareCodingTask",
    request: PrepareCodingTask,
    response: CodingPreparation,
    success: 201,
    access: "owner",
    idempotent: true,
  },
  {
    method: "GET",
    path: "/agents/coding/preparations/:id",
    operationId: "codingPreparation",
    response: CodingPreparation,
    success: 200,
    access: "owner",
  },
  {
    method: "POST",
    path: "/agents/coding/tasks",
    operationId: "admitCodingTask",
    request: AdmitCodingTask,
    response: CodingTask,
    success: 202,
    access: "owner",
    idempotent: true,
  },
  {
    method: "GET",
    path: "/agents/coding/tasks/:id",
    operationId: "codingTask",
    response: CodingTaskDetail,
    success: 200,
    access: "owner",
  },
  ...(["cancel", "reconcile"] as const).map((action) => ({
    method: "POST" as const,
    path: `/agents/coding/tasks/:id/${action}`,
    operationId: `${action}CodingTask`,
    request: EmptyRequest,
    response: CodingTask,
    success: 200,
    access: "owner" as const,
    idempotent: true as const,
  })),
] satisfies ControlEndpoint[];
