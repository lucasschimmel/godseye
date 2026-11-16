import type { ControlEndpoint } from "./http-endpoints.js";
import {
  CreateProjectExport,
  ProjectExport,
  ProjectLifecycle,
  PurgeProject,
  QuarantineProject,
  ReleaseQuarantine,
  ResumeProject,
  SuspendProject,
} from "./lifecycle.js";

const owner = "owner" as const;
const command = (action: string, request: ControlEndpoint["request"]) =>
  ({
    method: "POST",
    path: `/projects/:id/lifecycle/${action}`,
    operationId: `${action}Project`,
    request,
    response: ProjectLifecycle,
    success: 200,
    access: owner,
    idempotent: true,
  }) as const satisfies ControlEndpoint;
export const LIFECYCLE_HTTP_ENDPOINTS = [
  {
    method: "GET",
    path: "/projects/:id/lifecycle",
    operationId: "projectLifecycle",
    response: ProjectLifecycle,
    success: 200,
    access: owner,
  },
  command("suspend", SuspendProject),
  command("resume", ResumeProject),
  command("quarantine", QuarantineProject),
  command("release", ReleaseQuarantine),
  command("purge", PurgeProject),
  {
    method: "POST",
    path: "/projects/:id/exports",
    operationId: "createProjectExport",
    request: CreateProjectExport,
    response: ProjectExport,
    success: 201,
    access: owner,
    idempotent: true,
  },
  {
    method: "GET",
    path: "/projects/:id/exports/:exportId",
    operationId: "projectExport",
    response: ProjectExport,
    success: 200,
    access: owner,
  },
] as const satisfies readonly ControlEndpoint[];
