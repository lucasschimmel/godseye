import {
  APP_API_HEADER,
  APP_API_VERSION,
  APP_BASE,
  APP_ENVIRONMENT_HEADER,
  APP_PROJECT_HEADER,
  ApplicationScope,
  type ApplicationScopeInput,
} from "@godseye/app-backend/contracts";
import type { z } from "zod";

export interface GodseyeClientOptions {
  baseUrl: string;
  scope: ApplicationScopeInput;
  fetch?: typeof globalThis.fetch;
  headers?: HeadersInit | (() => HeadersInit);
  chunkBytes?: number;
  reconnectMs?: number;
}
export class GodseyeHttpError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: number,
    public readonly requestId?: string,
  ) {
    super(`Application request failed (${code}, HTTP ${status})`);
    this.name = "GodseyeHttpError";
  }
}
export async function boundedResponse(response: Response, maximum = 262144) {
  const reader = response.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > maximum) {
        await reader.cancel();
        throw new GodseyeHttpError("RESPONSE_TOO_LARGE", response.status);
      }
      chunks.push(part.value);
    }
  } finally {
    reader.releaseLock();
  }
  const result = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return new TextDecoder("utf-8", { fatal: true }).decode(result);
}
export function applicationTransport(options: GodseyeClientOptions) {
  const base = new URL(options.baseUrl);
  if (
    base.origin !== options.baseUrl ||
    base.username ||
    base.password ||
    !["http:", "https:"].includes(base.protocol)
  )
    throw new Error("SDK requires an exact application origin");
  const scope = ApplicationScope.parse(options.scope);
  const configuredHeaders =
    typeof options.headers === "function" ? options.headers : new Headers(options.headers);
  const send = async (path: string, init: RequestInit = {}) => {
    if (
      !path.startsWith("/") ||
      path.startsWith("//") ||
      path.includes("\\") ||
      /(^|\/)\.{1,2}(\/|$)/.test(path)
    )
      throw new Error("SDK path must stay inside the application API");
    const headers = new Headers(
      typeof configuredHeaders === "function" ? configuredHeaders() : configuredHeaders,
    );
    new Headers(init.headers).forEach((value, key) => {
      headers.set(key, value);
    });
    headers.set(APP_PROJECT_HEADER, scope.projectId);
    headers.set(APP_ENVIRONMENT_HEADER, scope.environmentId);
    headers.set(APP_API_HEADER, APP_API_VERSION);
    const target = new URL(`${APP_BASE}${path}`, base);
    if (target.origin !== base.origin || !target.pathname.startsWith(`${APP_BASE}/`))
      throw new Error("SDK path escaped the application API");
    const response = await (options.fetch ?? globalThis.fetch)(target, {
      ...init,
      headers,
      credentials: "include",
    });
    if (response.headers.get(APP_API_HEADER) !== APP_API_VERSION) {
      await response.body?.cancel();
      throw new GodseyeHttpError("UNSUPPORTED_VERSION", response.status);
    }
    if (!response.ok) {
      let code = "REQUEST_REJECTED";
      try {
        const body = JSON.parse(await boundedResponse(response, 16384)) as {
          error?: { code?: string };
        };
        if (body.error?.code && /^[A-Z0-9_]{1,80}$/.test(body.error.code)) code = body.error.code;
      } catch (error) {
        if (error instanceof GodseyeHttpError) throw error;
      }
      throw new GodseyeHttpError(
        code,
        response.status,
        response.headers.get("X-Request-Id") ?? undefined,
      );
    }
    return response;
  };
  const json = async <T>(path: string, init: RequestInit, schema: z.ZodType<T>): Promise<T> => {
    const response = await send(path, init);
    try {
      return schema.parse(JSON.parse(await boundedResponse(response)));
    } catch (error) {
      if (error instanceof GodseyeHttpError) throw error;
      throw new GodseyeHttpError("INVALID_RESPONSE", response.status);
    }
  };
  return { send, json, scope, baseUrl: base.origin };
}
export type ApplicationTransport = ReturnType<typeof applicationTransport>;
export function jsonRequest(
  body: unknown,
  method = "POST",
  key?: string,
  signal?: AbortSignal,
): RequestInit {
  return {
    method,
    signal,
    headers: { "Content-Type": "application/json", ...(key ? { "Idempotency-Key": key } : {}) },
    body: JSON.stringify(body),
  };
}
