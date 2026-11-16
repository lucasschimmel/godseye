import {
  assertControlVersion,
  CONTROL_API_HEADER,
  CONTROL_API_VERSION,
  ControlContractError,
  ControlErrorResponse,
  findControlEndpoint,
  IdempotencyKey,
  LOCAL_DEFAULTS,
  parseControlRequest,
  parseControlResponse,
} from "@godseye/contracts";

export interface ControlClientOptions {
  baseUrl?: string;
  fetch?: typeof globalThis.fetch;
  headers?: HeadersInit;
  apiVersion?: string;
  maxResponseBytes?: number;
}
export class ControlHttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly requestId: string,
  ) {
    super(message);
    this.name = "ControlHttpError";
  }
}
const DEFAULT_RESPONSE_BYTES = 16 * 1024 * 1024;
async function jsonBody(response: Response, maxBytes: number, method: string, path: string) {
  const reader = response.body?.getReader();
  if (!reader) throw new ControlContractError("INVALID_RESPONSE", method, path);
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = "";
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      bytes += next.value.byteLength;
      if (bytes > maxBytes) throw new ControlContractError("INVALID_RESPONSE", method, path);
      text += decoder.decode(next.value, { stream: true });
    }
    text += decoder.decode();
    return JSON.parse(text) as unknown;
  } catch {
    await reader.cancel().catch(() => undefined);
    throw new ControlContractError("INVALID_RESPONSE", method, path);
  } finally {
    reader.releaseLock();
  }
}

export function controlTransport(options: ControlClientOptions) {
  const version = options.apiVersion ?? CONTROL_API_VERSION;
  assertControlVersion(version);
  const maxBytes = options.maxResponseBytes ?? DEFAULT_RESPONSE_BYTES;
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1)
    throw new Error("Invalid control response size policy");
  const configured = (options.baseUrl ?? LOCAL_DEFAULTS.apiBase).replace(/\/+$/, "");
  const base = configured.endsWith(LOCAL_DEFAULTS.apiBase)
    ? configured
    : `${configured}${LOCAL_DEFAULTS.apiBase}`;
  const transport = options.fetch ?? globalThis.fetch;
  return async <T>(
    method: "GET" | "POST" | "PUT",
    path: string,
    body?: unknown,
    key?: string,
  ): Promise<T> => {
    const endpoint = findControlEndpoint(method, path);
    if (!endpoint) throw new ControlContractError("UNSUPPORTED_ENDPOINT", method, path);
    if (endpoint.idempotent && !IdempotencyKey.safeParse(key).success)
      throw new ControlContractError(
        "INVALID_REQUEST",
        method,
        `${path} (idempotency key required)`,
      );
    const parsed = method === "GET" ? undefined : parseControlRequest(method, path, body);
    const headers = new Headers(options.headers);
    headers.set(CONTROL_API_HEADER, version);
    if (method !== "GET") headers.set("content-type", "application/json");
    if (key) headers.set("idempotency-key", key);
    const response = await transport(`${base}${path}`, {
      method,
      headers,
      credentials: "include",
      ...(method === "GET" ? {} : { body: JSON.stringify(parsed) }),
    });
    assertControlVersion(response.headers.get(CONTROL_API_HEADER) ?? "", method, path);
    const payload = await jsonBody(response, maxBytes, method, path);
    if (!response.ok) {
      const error = ControlErrorResponse.safeParse(payload);
      if (!error.success) throw new ControlContractError("INVALID_RESPONSE", method, path);
      throw new ControlHttpError(
        response.status,
        error.data.error.code,
        error.data.error.message,
        error.data.error.requestId,
      );
    }
    return parseControlResponse<T>(
      method,
      path,
      payload,
      response.headers.get(CONTROL_API_HEADER) ?? "",
    );
  };
}
