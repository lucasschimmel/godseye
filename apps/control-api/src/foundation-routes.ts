import {
  ApprovalRequest,
  AuditExportQuery,
  BudgetUpdateRequest,
  CreateExecutionPlan,
  EmptyRequest,
  HttpId,
  IdempotencyKey,
  LOCAL_DEFAULTS,
  RegisterResource,
} from "@godseye/contracts";
import { DomainError, type FoundationEngine } from "@godseye/core";
import type { Hono } from "hono";
import type { ControlEnvironment } from "./api-types.js";

export function registerFoundationRoutes(app: Hono<ControlEnvironment>, engine?: FoundationEngine) {
  const base = LOCAL_DEFAULTS.apiBase;
  const service = () => {
    if (!engine)
      throw new DomainError("CAPABILITY_UNAVAILABLE", "The foundation broker is unavailable", 503);
    return engine;
  };
  app.post(`${base}/foundation/resources`, async (c) =>
    c.json(
      await service().registerResource(
        c.get("actor"),
        RegisterResource.parse(await c.req.json()),
        IdempotencyKey.parse(c.req.header("idempotency-key")),
      ),
      201,
    ),
  );
  app.get(`${base}/foundation/budgets/:projectId`, async (c) =>
    c.json(await service().getBudget(c.get("actor"), HttpId.parse(c.req.param("projectId")))),
  );
  app.put(`${base}/foundation/budgets/:projectId`, async (c) =>
    c.json(
      await service().configureBudget(
        c.get("actor"),
        HttpId.parse(c.req.param("projectId")),
        BudgetUpdateRequest.parse(await c.req.json()),
        IdempotencyKey.parse(c.req.header("idempotency-key")),
      ),
    ),
  );
  app.post(`${base}/foundation/plans`, async (c) =>
    c.json(
      await service().createPlan(
        c.get("actor"),
        CreateExecutionPlan.parse(await c.req.json()),
        IdempotencyKey.parse(c.req.header("idempotency-key")),
      ),
      201,
    ),
  );
  app.get(`${base}/foundation/plans/:id`, async (c) =>
    c.json(await service().getPlan(c.get("actor"), HttpId.parse(c.req.param("id")))),
  );
  app.post(`${base}/foundation/plans/:id/approve`, async (c) => {
    const { expectedHash } = ApprovalRequest.parse(await c.req.json());
    return c.json(
      await service().approve(
        c.get("actor"),
        HttpId.parse(c.req.param("id")),
        expectedHash,
        IdempotencyKey.parse(c.req.header("idempotency-key")),
      ),
    );
  });
  app.post(`${base}/foundation/plans/:id/enqueue`, async (c) => {
    EmptyRequest.parse(await c.req.json());
    return c.json(
      await service().enqueue(
        c.get("actor"),
        HttpId.parse(c.req.param("id")),
        IdempotencyKey.parse(c.req.header("idempotency-key")),
      ),
      201,
    );
  });
  app.get(`${base}/foundation/runs`, async (c) => c.json(await service().listRuns(c.get("actor"))));
  app.get(`${base}/foundation/runs/:id`, async (c) =>
    c.json(await service().getRun(c.get("actor"), HttpId.parse(c.req.param("id")))),
  );
  for (const action of ["cancel", "reconcile"] as const)
    app.post(`${base}/foundation/runs/:id/${action}`, async (c) => {
      EmptyRequest.parse(await c.req.json());
      return c.json(
        await service()[action](
          c.get("actor"),
          HttpId.parse(c.req.param("id")),
          IdempotencyKey.parse(c.req.header("idempotency-key")),
        ),
      );
    });
  app.get(`${base}/audit/anchor`, async (c) => c.json(await service().auditAnchor(c.get("actor"))));
  app.get(`${base}/audit/export`, async (c) => {
    const query = new URL(c.req.url).searchParams;
    for (const name of query.keys())
      if (query.getAll(name).length > 1)
        throw new DomainError(
          "INVALID_INPUT",
          "Duplicate audit query parameters are not allowed",
          422,
        );
    const { cursor, limit } = AuditExportQuery.parse(Object.fromEntries(query));
    return c.json(await service().exportAudit(c.get("actor"), cursor, limit));
  });
}
