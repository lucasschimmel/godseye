import type { ControlEndpoint } from "./http-endpoints.js";
import { EmptyRequest } from "./http-schemas.js";
import {
  ImportUsageInvoice,
  PutUsageBudget,
  PutUsagePrice,
  UsageBudget,
  UsageInvoice,
  UsageOverview,
  UsagePrice,
} from "./usage.js";
import { UsageQuery } from "./usage-query.js";
import { UsageResources } from "./usage-resources.js";
export const USAGE_HTTP_ENDPOINTS = [
  {
    method: "GET",
    path: "/usage/resources",
    operationId: "usageResources",
    response: UsageResources,
    success: 200,
    access: "owner",
  },
  {
    method: "GET",
    path: "/usage",
    operationId: "usageOverview",
    query: UsageQuery,
    response: UsageOverview,
    success: 200,
    access: "owner",
  },
  {
    method: "POST",
    path: "/usage/prices",
    operationId: "putUsagePrice",
    request: PutUsagePrice,
    response: UsagePrice,
    success: 201,
    access: "owner",
    idempotent: true,
  },
  {
    method: "PUT",
    path: "/usage/budgets",
    operationId: "putUsageBudget",
    request: PutUsageBudget,
    response: UsageBudget,
    success: 200,
    access: "owner",
    idempotent: true,
  },
  {
    method: "POST",
    path: "/usage/invoices",
    operationId: "importUsageInvoice",
    request: ImportUsageInvoice,
    response: UsageInvoice,
    success: 201,
    access: "owner",
    idempotent: true,
  },
  {
    method: "POST",
    path: "/usage/invoices/:id/reconcile",
    operationId: "reconcileUsageInvoice",
    request: EmptyRequest,
    response: UsageInvoice,
    success: 200,
    access: "owner",
    idempotent: true,
  },
] satisfies ControlEndpoint[];
