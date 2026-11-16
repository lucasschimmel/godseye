import { z } from "zod";
import { CONTROL_API_VERSION, controlPath, findControlEndpoint } from "./http-endpoints.js";
import { isControlOpenApiDocument } from "./http-openapi.js";

export * from "./http-endpoints.js";
export * from "./http-openapi.js";
export * from "./http-schemas.js";

export class ControlContractError extends Error {
  constructor(
    public readonly code:
      | "UNSUPPORTED_VERSION"
      | "INVALID_RESPONSE"
      | "UNSUPPORTED_ENDPOINT"
      | "INVALID_REQUEST",
    public readonly method: string,
    public readonly path: string,
  ) {
    super(`Control API contract rejected ${method} ${path}: ${code}`);
    this.name = "ControlContractError";
  }
}
export function assertControlVersion(version: string, method = "GET", path = "/") {
  if (version !== CONTROL_API_VERSION)
    throw new ControlContractError("UNSUPPORTED_VERSION", method, path);
}
/** Validate at the consumer boundary. Unknown fields and incompatible versions are visible failures. */
export function parseControlResponse<T = unknown>(
  method: string,
  path: string,
  payload: unknown,
  version: string = CONTROL_API_VERSION,
): T {
  assertControlVersion(version, method, path);
  if (method.toUpperCase() === "GET" && controlPath(path) === "/openapi.json") {
    let valid = false;
    try {
      valid = isControlOpenApiDocument(payload);
    } catch {
      valid = false;
    }
    if (!valid) throw new ControlContractError("INVALID_RESPONSE", method, path);
    return payload as T;
  }
  const endpoint = findControlEndpoint(method, path);
  if (!endpoint) throw new ControlContractError("UNSUPPORTED_ENDPOINT", method, path);
  const parsed = endpoint.response.safeParse(payload);
  if (!parsed.success) throw new ControlContractError("INVALID_RESPONSE", method, path);
  return parsed.data as T;
}
export function parseControlRequest<T = unknown>(
  method: string,
  path: string,
  payload: unknown,
): T {
  const endpoint = findControlEndpoint(method, path);
  if (!endpoint) throw new ControlContractError("UNSUPPORTED_ENDPOINT", method, path);
  const parsed = (endpoint.request ?? z.object({}).strict()).safeParse(payload);
  if (!parsed.success) throw new ControlContractError("INVALID_REQUEST", method, path);
  return parsed.data as T;
}
