import {
  EmptyRequest,
  HttpId,
  ImportUsageInvoice,
  LOCAL_DEFAULTS,
  PutUsageBudget,
  PutUsagePrice,
  UsageQuery,
} from "@godseye/contracts";
import { DomainError, type InfrastructureEngine } from "@godseye/core";
import type { Hono } from "hono";
import type { ControlEnvironment } from "./api-types.js";
export function registerUsageRoutes(
  app: Hono<ControlEnvironment>,
  infrastructure?: InfrastructureEngine,
) {
  const base = `${LOCAL_DEFAULTS.apiBase}/usage`;
  const engine = () => {
    if (!infrastructure)
      throw new DomainError("CAPABILITY_UNAVAILABLE", "Usage accounting unavailable", 503);
    return infrastructure.usage;
  };
  app.get(base, async (c) =>
    c.json(await engine().overview(c.get("actor"), UsageQuery.parse(c.req.query()))),
  );
  app.get(`${base}/resources`, async (c) => c.json(await engine().resources(c.get("actor"))));
  app.post(`${base}/prices`, async (c) =>
    c.json(
      await engine().putPrice(
        c.get("actor"),
        PutUsagePrice.parse(await c.req.json()),
        c.req.header("idempotency-key") ?? "",
      ),
      201,
    ),
  );
  app.put(`${base}/budgets`, async (c) =>
    c.json(
      await engine().putBudget(
        c.get("actor"),
        PutUsageBudget.parse(await c.req.json()),
        c.req.header("idempotency-key") ?? "",
      ),
    ),
  );
  app.post(`${base}/invoices`, async (c) =>
    c.json(
      await engine().importInvoice(
        c.get("actor"),
        ImportUsageInvoice.parse(await c.req.json()),
        c.req.header("idempotency-key") ?? "",
      ),
      201,
    ),
  );
  app.post(`${base}/invoices/:id/reconcile`, async (c) => {
    EmptyRequest.parse(await c.req.json());
    return c.json(
      await engine().reconcileInvoice(
        c.get("actor"),
        HttpId.parse(c.req.param("id")),
        c.req.header("idempotency-key") ?? "",
      ),
    );
  });
}
