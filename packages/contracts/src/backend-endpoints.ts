import { BackendConfigurationView, ConfigureBackend } from "./backend-configuration.js";
import type { ControlEndpoint } from "./http-endpoints.js";
export const BACKEND_HTTP_ENDPOINTS = [
  {
    method: "GET",
    path: "/projects/:id/environments/:environmentId/backend",
    operationId: "backendConfiguration",
    response: BackendConfigurationView,
    success: 200,
    access: "owner",
  },
  {
    method: "PUT",
    path: "/projects/:id/environments/:environmentId/backend",
    operationId: "configureBackend",
    request: ConfigureBackend,
    response: BackendConfigurationView,
    success: 200,
    access: "owner",
    idempotent: true,
  },
] as const satisfies readonly ControlEndpoint[];
