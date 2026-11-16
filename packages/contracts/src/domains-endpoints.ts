import {
  AddProjectDomain,
  DomainAskQuery,
  DomainAskResponse,
  DomainOverview,
  ProjectDomain,
  ProjectDomainList,
  RemoveProjectDomain,
  VerifyProjectDomain,
} from "./domains.js";
import type { ControlEndpoint } from "./http-endpoints.js";

const owner = "owner" as const;
export const DOMAIN_HTTP_ENDPOINTS = [
  {
    method: "GET",
    path: "/domains",
    operationId: "domainOverview",
    response: DomainOverview,
    success: 200,
    access: owner,
  },
  {
    method: "GET",
    path: "/projects/:id/domains",
    operationId: "projectDomains",
    response: ProjectDomainList,
    success: 200,
    access: owner,
  },
  {
    method: "POST",
    path: "/projects/:id/domains",
    operationId: "addProjectDomain",
    request: AddProjectDomain,
    response: ProjectDomain,
    success: 201,
    access: owner,
    idempotent: true,
  },
  {
    method: "POST",
    path: "/projects/:id/domains/:domainId/verify",
    operationId: "verifyProjectDomain",
    request: VerifyProjectDomain,
    response: ProjectDomain,
    success: 200,
    access: owner,
    idempotent: true,
  },
  {
    method: "POST",
    path: "/projects/:id/domains/:domainId/remove",
    operationId: "removeProjectDomain",
    request: RemoveProjectDomain,
    response: ProjectDomain,
    success: 200,
    access: owner,
    idempotent: true,
  },
  {
    // Called by the edge Caddy before it requests a certificate (on-demand TLS `ask`); 404 = refuse.
    method: "GET",
    path: "/domains/ask",
    operationId: "askDomain",
    query: DomainAskQuery,
    response: DomainAskResponse,
    success: 200,
    access: "public",
  },
] as const satisfies readonly ControlEndpoint[];
