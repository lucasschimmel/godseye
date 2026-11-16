import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import { secureHeaders } from "hono/secure-headers";
import { z } from "zod";
import {
  applicationAuth,
  assertApplicationAuthRoute,
  handleApplicationAuth,
  requireApplicationSession,
} from "./auth.js";
import {
  APP_API_HEADER,
  APP_API_VERSION,
  APP_BASE,
  APP_ENVIRONMENT_HEADER,
  APP_PROJECT_HEADER,
  ApplicationError,
} from "./contracts.js";
import { applicationRouteRegistry } from "./custom.js";
import {
  applicationEventStream,
  type PublishApplicationEvent,
  publishApplicationEvent,
} from "./events.js";
import { registerFileRoutes } from "./file-routes.js";
import { acquireApplicationInstance } from "./instance.js";
import { flushApplicationJobs, readApplicationJobEvent } from "./jobs-bridge.js";
import { prepareApplicationFiles } from "./private-files.js";
import {
  applicationSnapshot,
  exportApplicationRecovery,
  importApplicationRecovery,
} from "./recovery.js";
import { session } from "./schema.js";
import { type ApplicationBackendOptions, applicationState, guardApplication } from "./state.js";

/** Dedicated application listener: never mount under the owner control API. */
export async function createApplicationBackend(options: ApplicationBackendOptions) {
  const state = applicationState(options);
  if (state.store.runtimeActive)
    throw new ApplicationError("INSTANCE_LOCKED", "Application store already has a runtime", 409);
  state.store.runtimeActive = true;
  let releaseFiles: () => Promise<void>;
  try {
    await prepareApplicationFiles(state);
    releaseFiles = await acquireApplicationInstance(state.filesRoot);
  } catch (error) {
    state.store.runtimeActive = false;
    throw error;
  }
  const auth = applicationAuth(state);
  const app = new Hono();
  app.use("*", secureHeaders());
  app.use("*", async (context, next) => {
    context.header(APP_API_HEADER, APP_API_VERSION);
    context.header("Cache-Control", "no-store");
    context.header("X-Request-Id", randomUUID());
    const url = new URL(context.req.url);
    if ((context.req.header("host") ?? url.host) !== new URL(state.baseUrl).host)
      throw new ApplicationError("INVALID_HOST", "Application host is not allowed", 403);
    const origin = context.req.header("origin");
    if (origin && !state.origins.includes(origin))
      throw new ApplicationError("INVALID_ORIGIN", "Application origin is not allowed", 403);
    if (context.req.method === "OPTIONS") {
      const requested = context.req.header("access-control-request-method");
      const allowed = [
        "content-type",
        "x-godseye-project",
        "x-godseye-environment",
        "x-godseye-app-version",
        "idempotency-key",
        "if-match",
        "upload-offset",
        "last-event-id",
        "range",
      ];
      const headers = (context.req.header("access-control-request-headers") ?? "")
        .split(",")
        .map((value) => value.trim().toLowerCase())
        .filter(Boolean);
      if (
        !origin ||
        !requested ||
        !["GET", "POST", "PUT", "DELETE"].includes(requested) ||
        headers.some((value) => !allowed.includes(value))
      )
        throw new ApplicationError(
          "INVALID_PREFLIGHT",
          "Application preflight is not allowed",
          403,
        );
      context.header("Access-Control-Allow-Origin", origin);
      context.header("Access-Control-Allow-Credentials", "true");
      context.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE");
      context.header("Access-Control-Allow-Headers", allowed.join(", "));
      context.header("Vary", "Origin");
      return context.body(null, 204);
    }
    const oauthCallback =
      context.req.method === "GET" &&
      /^\/api\/app\/v1\/auth\/callback\/[a-z][a-z0-9-]*$/.test(url.pathname);
    // OAuth redirects cannot attach custom headers; their cell is fixed by listener and signed state.
    if (
      !oauthCallback &&
      (context.req.header(APP_PROJECT_HEADER) !== state.scope.projectId ||
        context.req.header(APP_ENVIRONMENT_HEADER) !== state.scope.environmentId)
    )
      throw new ApplicationError(
        "CELL_SCOPE_MISMATCH",
        "Exact application cell scope is required",
        403,
      );
    const version = context.req.header(APP_API_HEADER);
    if (version && version !== APP_API_VERSION)
      throw new ApplicationError(
        "UNSUPPORTED_VERSION",
        "Application API version is unsupported",
        422,
      );
    if (origin) {
      context.header("Access-Control-Allow-Origin", origin);
      context.header("Access-Control-Allow-Credentials", "true");
      context.header("Access-Control-Expose-Headers", APP_API_HEADER);
      context.header("Vary", "Origin");
    }
    const requestEpoch = await guardApplication(state);
    await state.requestEpoch.run(requestEpoch, next);
    context.header(APP_API_HEADER, APP_API_VERSION);
    context.header("Cache-Control", "no-store");
  });
  app.get(`${APP_BASE}/health`, (context) =>
    context.json({
      scope: state.scope,
      apiVersion: APP_API_VERSION,
      mode: "local",
      qualified: false,
    }),
  );
  app.all(`${APP_BASE}/auth/*`, (context) =>
    state.store.exclusive(async () => {
      const authPath = context.req.path.slice(`${APP_BASE}/auth`.length);
      assertApplicationAuthRoute(state, authPath, context.req.method);
      if (context.req.method === "POST") {
        if (context.req.header("content-type")?.split(";")[0] !== "application/json")
          throw new ApplicationError("INVALID_CONTENT_TYPE", "JSON content type is required", 415);
        const body = await boundedBody(context.req.raw, 16384);
        let value: unknown;
        try {
          value = JSON.parse(new TextDecoder().decode(body));
        } catch {
          throw new ApplicationError("INVALID_JSON", "Malformed JSON body", 400);
        }
        const path = context.req.path.slice(`${APP_BASE}/auth`.length);
        const email = z.email().max(254),
          password = z.string().min(1).max(128);
        const shapes: Record<string, z.ZodType> = {
          "/sign-up/email": z
            .object({ name: z.string().min(1).max(100), email, password: password.min(12) })
            .strict(),
          "/sign-in/email": z
            .object({ email, password, rememberMe: z.boolean().optional() })
            .strict(),
          "/sign-out": z.object({}).strict(),
          "/revoke-sessions": z.object({}).strict(),
          "/revoke-other-sessions": z.object({}).strict(),
          "/revoke-session": z.object({ sessionId: z.string().min(1).max(100) }).strict(),
          "/change-password": z
            .object({
              currentPassword: password,
              newPassword: password.min(12),
              revokeOtherSessions: z.boolean().optional(),
            })
            .strict(),
          "/sign-in/social": z
            .object({
              provider: z.string().max(50),
              callbackURL: z.url(),
              disableRedirect: z.boolean().optional(),
            })
            .strict(),
        };
        if (shapes[path] && !shapes[path].safeParse(value).success)
          throw new ApplicationError(
            "INVALID_INPUT",
            "Invalid application authentication input",
            422,
          );
        if (path === "/sign-in/social") {
          const input = value as { provider: string; callbackURL: string };
          if (
            !state.oauthProviders.some((provider) => provider.providerId === input.provider) ||
            !state.origins.includes(new URL(input.callbackURL).origin)
          )
            throw new ApplicationError(
              "INVALID_OAUTH_TARGET",
              "OAuth provider and callback origin must be configured",
              403,
            );
        }
        if (path === "/revoke-session") {
          const identity = await requireApplicationSession(state, auth, context.req.raw.headers);
          const id = (value as { sessionId: string }).sessionId;
          const [target] = await state.store.db
            .select()
            .from(session)
            .where(and(eq(session.id, id), eq(session.userId, identity.user.id)));
          if (!target)
            throw new ApplicationError("NOT_FOUND", "Application session not found", 404);
          const epoch = await guardApplication(state);
          await auth.api.revokeSession({
            headers: context.req.raw.headers,
            body: { token: target.token },
          });
          await guardApplication(state, epoch);
          return context.json({ revoked: true });
        }
        return handleApplicationAuth(
          state,
          auth,
          new Request(context.req.url, { method: "POST", headers: context.req.raw.headers, body }),
        );
      }
      return handleApplicationAuth(state, auth, context.req.raw);
    }),
  );
  registerFileRoutes(app, state, auth);
  app.get(`${APP_BASE}/events`, (context) => applicationEventStream(state, auth, context.req.raw));
  options.routes?.(applicationRouteRegistry(app, state, auth));
  app.notFound((context) =>
    context.json({ error: { code: "NOT_FOUND", message: "Application route not found" } }, 404),
  );
  app.onError((error, context) => {
    if (error instanceof ApplicationError)
      return context.json(
        { error: { code: error.code, message: error.message } },
        error.status as 400,
      );
    return context.json(
      { error: { code: "INTERNAL_ERROR", message: "Application operation failed" } },
      500,
    );
  });
  let closing: Promise<void> | undefined;
  return {
    app,
    state,
    auth,
    publishEvent: (input: PublishApplicationEvent) => publishApplicationEvent(state, input),
    flushJobs: (input?: { signal?: AbortSignal; limit?: number }) =>
      flushApplicationJobs(state, input),
    readJobEvent: (id: string) => readApplicationJobEvent(state, id),
    snapshot: () => state.store.exclusive(() => applicationSnapshot(state)),
    exportRecovery: (input: { directory: string }) => exportApplicationRecovery(state, input),
    importRecovery: (input: { directory: string; sourceAuthMaterial: string }) =>
      importApplicationRecovery(state, input),
    close() {
      closing ??= (async () => {
        state.closed = true;
        const downloadClosers = [...state.downloadClosers.values()];
        for (const controller of state.streams) controller.abort();
        for (const controller of state.downloads) controller.abort();
        await Promise.all(downloadClosers.map((close) => close()));
        await state.store.close();
        await releaseFiles();
        state.store.runtimeActive = false;
      })();
      return closing;
    },
  };
}
export async function boundedBody(request: Request, maximum: number) {
  const reader = request.body?.getReader();
  if (!reader) return new Uint8Array();
  let size = 0;
  const parts: Uint8Array[] = [];
  try {
    while (true) {
      const item = await reader.read();
      if (item.done) break;
      size += item.value.byteLength;
      if (size > maximum) {
        await reader.cancel();
        throw new ApplicationError(
          "BODY_TOO_LARGE",
          "Application request exceeds its byte limit",
          413,
        );
      }
      parts.push(item.value);
    }
  } finally {
    reader.releaseLock();
  }
  const result = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.byteLength;
  }
  return result;
}
