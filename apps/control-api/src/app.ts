import { randomUUID } from "node:crypto";
import {
  CONTROL_API_HEADER,
  CONTROL_API_VERSION,
  findControlEndpoint,
  IdempotencyKey,
  LOCAL_DEFAULTS,
  OperationRequest,
  RepositoryConfiguration,
} from "@godseye/contracts";
import {
  type AccessBroker,
  type ControlPlane,
  DomainError,
  type FoundationEngine,
  type InfrastructureEngine,
  ServerObserver,
} from "@godseye/core";
import { APIError } from "better-auth/api";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { HTTPException } from "hono/http-exception";
import { secureHeaders } from "hono/secure-headers";
import { z } from "zod";
import { registerAccessRoutes } from "./access-routes.js";
import { assertLoopbackAdministration } from "./admin-guard.js";
import { registerAgentChatRoutes } from "./agent-chat-routes.js";
import { registerAgentChatTransport } from "./agent-chat-transport.js";
import { registerAgentRoutes } from "./agent-routes.js";
import { type ControlEnvironment, registerControlResponseValidation } from "./api-types.js";
import { registerBackendRoutes } from "./backend-routes.js";
import { registerCodingRoutes } from "./coding-routes.js";
import type { Configuration } from "./config.js";
import { registerDatabaseRoutes } from "./database-routes.js";
import { registerDeliveryRoutes } from "./delivery-routes.js";
import { DOMAIN_ASK_PATH, registerDomainRoutes } from "./domain-routes.js";
import { registerFoundationRoutes } from "./foundation-routes.js";
import type { OwnerIdentity } from "./identity/index.js";
import { registerInfrastructureRoutes } from "./infra-routes.js";
import { registerJobsRoutes } from "./jobs-routes.js";
import { registerLifecycleRoutes } from "./lifecycle-routes.js";
import { registerObservabilityRoutes } from "./observability-routes.js";
import { registerOpenApi } from "./openapi.js";
import { registerOrchestrationRoutes } from "./orchestration-routes.js";
import { registerProtectionRoutes } from "./protection-routes.js";
import { registerRecoveryRoutes } from "./recovery-routes.js";
import { registerServerObservationRoutes } from "./server-observation-routes.js";
import { registerUsageRoutes } from "./usage-routes.js";

const Uuid = z.string().uuid();
const RepositoryUpdate = z
  .object({ repository: RepositoryConfiguration, expectedRevision: z.number().int().nonnegative() })
  .strict();

/**
 * Owner adapter for the loopback (local) or private-network (server) listener. In server mode the
 * public edge may forward only the signed webhook and health; this app never faces the Internet.
 */
export function createApp(
  core: ControlPlane,
  config: Configuration,
  identity?: OwnerIdentity,
  engine?: FoundationEngine,
  broker?: AccessBroker,
  infrastructure?: InfrastructureEngine,
  serverObserver: ServerObserver = new ServerObserver(config.serverObservation),
) {
  if (config.mode === "server" && (!identity || !config.ownerOrigin.startsWith("https://")))
    throw new Error("Server mode requires owner identity and an https owner origin");
  const app = new Hono<ControlEnvironment>();
  // Route registration is below the shared authentication and response-validation middleware.
  app.use("*", secureHeaders());
  app.use("*", async (context, next) => {
    context.set("requestId", randomUUID());
    context.header("Cache-Control", "no-store");
    context.header("X-Request-Id", context.get("requestId"));
    if (
      context.req.path.startsWith(`${LOCAL_DEFAULTS.apiBase}/`) ||
      context.req.path === "/hooks/github"
    ) {
      context.header(CONTROL_API_HEADER, CONTROL_API_VERSION);
      const version = context.req.header(CONTROL_API_HEADER);
      if (version && version !== CONTROL_API_VERSION)
        throw new DomainError(
          "UNSUPPORTED_VERSION",
          "The requested control API version is not supported",
          422,
        );
    }
    // The edge reaches the ask guard by its private gateway address, so only that read is exempt.
    const askGuard = context.req.method === "GET" && context.req.path === DOMAIN_ASK_PATH;
    if (
      !askGuard &&
      !config.hosts.includes(context.req.header("host") ?? new URL(context.req.url).host)
    ) {
      throw new DomainError("INVALID_HOST", "Local host is not allowed", 403);
    }
    const origin = context.req.header("origin");
    if (origin && !config.origins.includes(origin))
      throw new DomainError("INVALID_ORIGIN", "Request origin is not allowed", 403);
    if (
      !["GET", "HEAD"].includes(context.req.method) &&
      context.req.header("content-type")?.split(";")[0]?.trim() !== "application/json"
    ) {
      throw new DomainError("INVALID_CONTENT_TYPE", "JSON content type is required", 415);
    }
    await next();
  });
  app.use(
    "*",
    bodyLimit({
      maxSize: LOCAL_DEFAULTS.bodyLimitBytes,
      onError: () => {
        throw new DomainError("BODY_TOO_LARGE", "Request body is too large", 413);
      },
    }),
  );
  const base = LOCAL_DEFAULTS.apiBase;
  registerControlResponseValidation(app);
  app.all("/api/auth/*", async (c) =>
    identity
      ? identity.handle(c.req.raw)
      : c.json(
          { error: { code: "UNAUTHENTICATED", message: "Owner identity is unavailable" } },
          401,
        ),
  );
  app.use(`${base}/*`, async (c, next) => {
    if (
      [
        `${base}/health`,
        `${base}/owner/session`,
        `${base}/owner/local-command`,
        DOMAIN_ASK_PATH,
      ].includes(c.req.path)
    )
      return next();
    if (!identity)
      throw new DomainError("UNAUTHENTICATED", "Owner authentication is required", 401);
    return identity.exclusive(async () => {
      const actor = await identity.actor(c.req.raw.headers);
      if (!actor) throw new DomainError("UNAUTHENTICATED", "Owner authentication is required", 401);
      c.set("actor", actor);
      const endpoint = findControlEndpoint(c.req.method, c.req.path);
      if (
        endpoint?.idempotent &&
        !IdempotencyKey.safeParse(c.req.header("idempotency-key")).success
      )
        throw new DomainError(
          "INVALID_IDEMPOTENCY_KEY",
          "A valid idempotency key is required",
          400,
        );
      await identity.flushAudit();
      await next();
      await identity.flushAudit();
    });
  });
  app.get(`${base}/owner/session`, async (c) =>
    identity
      ? identity.exclusive(async () => c.json(await identity.status(c.req.raw.headers)))
      : c.json({ authenticated: false, configured: false, origin: config.ownerOrigin }),
  );
  app.get(`${base}/owner/security`, (c) => {
    if (!identity)
      throw new DomainError("UNAUTHENTICATED", "Owner authentication is required", 401);
    return identity.security(c.req.raw.headers).then((result) => c.json(result));
  });
  app.post(`${base}/owner/local-command`, async (c) => {
    assertLoopbackAdministration(c, config);
    if (!identity) throw new DomainError("UNAUTHENTICATED", "Owner identity is unavailable", 401);
    const raw = await c.req.text();
    const input = z
      .object({ intent: z.enum(["setup", "recover"]) })
      .strict()
      .parse(JSON.parse(raw));
    return c.json(await identity.localCommand(raw, c.req.raw.headers, input.intent));
  });
  for (const kind of ["sessions", "passkeys"] as const)
    app.post(`${base}/owner/${kind}/:id/revoke`, async (c) => {
      z.object({})
        .strict()
        .parse(await c.req.json());
      if (!identity)
        throw new DomainError("UNAUTHENTICATED", "Owner authentication is required", 401);
      const method = kind === "sessions" ? identity.revokeSession : identity.revokePasskey;
      return c.json(
        await method(c.req.raw.headers, c.req.param("id"), c.req.header("idempotency-key") ?? ""),
      );
    });
  app.get(`${base}/health`, (c) =>
    c.json({
      status: "ok",
      mode: config.mode,
      serverConnected: config.mode === "server",
    }),
  );
  app.get(`${base}/overview`, async (c) =>
    c.json(
      await core.overview(c.get("actor"), {
        mode: config.mode === "server" ? "server" : "local",
        secretsConfigured: Boolean(config.baoAddress),
      }),
    ),
  );
  app.get(`${base}/projects`, async (c) => c.json(await core.listProjects(c.get("actor"))));
  app.post(`${base}/projects`, async (c) =>
    c.json(
      await core.createProject(
        c.get("actor"),
        await c.req.json(),
        c.req.header("idempotency-key") ?? "",
      ),
      201,
    ),
  );
  app.get(`${base}/projects/:id`, async (c) =>
    c.json(await core.getProject(c.get("actor"), Uuid.parse(c.req.param("id")))),
  );
  app.put(`${base}/projects/:id/repository`, async (c) => {
    const id = Uuid.parse(c.req.param("id"));
    const { repository, expectedRevision } = RepositoryUpdate.parse(await c.req.json());
    return c.json(
      await core.configureRepository(
        c.get("actor"),
        id,
        repository,
        expectedRevision,
        c.req.header("idempotency-key") ?? "",
      ),
    );
  });
  app.post(`${base}/projects/:id/operations`, async (c) =>
    c.json(
      await core.requestOperation(
        c.get("actor"),
        Uuid.parse(c.req.param("id")),
        OperationRequest.parse(await c.req.json()),
        c.req.header("idempotency-key") ?? "",
      ),
      201,
    ),
  );
  app.get(`${base}/operations`, async (c) => c.json(await core.listOperations(c.get("actor"))));
  app.get(`${base}/operations/:id`, async (c) =>
    c.json(await core.getOperation(c.get("actor"), Uuid.parse(c.req.param("id")))),
  );
  app.get(`${base}/ci/runs`, async (c) => c.json(await core.listCiRuns(c.get("actor"))));
  app.get(`${base}/audit`, async (c) => c.json(await core.listAudit(c.get("actor"))));
  app.post("/hooks/github", async (c) =>
    c.json(
      await core.receiveGithubDelivery(
        {
          rawBody: new Uint8Array(await c.req.arrayBuffer()),
          deliveryId: c.req.header("x-github-delivery") ?? "",
          event: c.req.header("x-github-event") ?? "",
          signature: c.req.header("x-hub-signature-256"),
        },
        config.githubWebhookKey ?? "",
      ),
      202,
    ),
  );
  registerFoundationRoutes(app, engine);
  registerAccessRoutes(app, broker);
  registerInfrastructureRoutes(app, infrastructure);
  registerServerObservationRoutes(app, serverObserver);
  registerDatabaseRoutes(app, core, infrastructure);
  registerBackendRoutes(app, core);
  registerRecoveryRoutes(app, infrastructure);
  registerProtectionRoutes(app, infrastructure);
  registerDeliveryRoutes(app, infrastructure);
  registerJobsRoutes(app, infrastructure);
  registerAgentRoutes(app, infrastructure);
  registerCodingRoutes(app, infrastructure);
  registerUsageRoutes(app, infrastructure);
  registerObservabilityRoutes(app, infrastructure?.observability);
  registerOrchestrationRoutes(app, infrastructure);
  registerAgentChatRoutes(app, infrastructure);
  if (infrastructure && identity)
    registerAgentChatTransport(app, infrastructure.agents, (headers) => identity.actor(headers));
  registerLifecycleRoutes(app, infrastructure);
  registerDomainRoutes(app, infrastructure);
  registerOpenApi(app);
  app.notFound((c) =>
    c.json(
      { error: { code: "NOT_FOUND", message: "Route not found", requestId: c.get("requestId") } },
      404,
    ),
  );
  app.onError((error, c) => {
    const status =
      error instanceof DomainError
        ? error.status
        : error instanceof z.ZodError
          ? 422
          : error instanceof SyntaxError
            ? 400
            : error instanceof APIError
              ? error.statusCode
              : error instanceof HTTPException
                ? error.status
                : 500;
    const code =
      error instanceof DomainError
        ? error.code
        : status === 401
          ? "UNAUTHENTICATED"
          : status === 403
            ? "STEP_UP_REQUIRED"
            : status === 400 || status === 422
              ? "INVALID_INPUT"
              : "INTERNAL_ERROR";
    const message =
      error instanceof DomainError
        ? error.message
        : status === 400 || status === 422
          ? "Invalid request input"
          : "Request could not be completed";
    if (status >= 500)
      console.error(
        JSON.stringify({
          event: "control.request.failed",
          requestId: c.get("requestId"),
          status,
          code,
        }),
      );
    return c.json(
      { error: { code, message, requestId: c.get("requestId") } },
      status as 400 | 401 | 403 | 404 | 409 | 413 | 415 | 422 | 500 | 503,
    );
  });
  return app;
}
