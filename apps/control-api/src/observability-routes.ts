import {
  IngestTelemetry,
  LOCAL_DEFAULTS,
  ObservabilityQuery,
  RegisterTelemetrySource,
} from "@godseye/contracts";
import { DomainError, type ObservabilityEngine } from "@godseye/core";
import type { Hono } from "hono";
import type { ControlEnvironment } from "./api-types.js";
export function registerObservabilityRoutes(
  app: Hono<ControlEnvironment>,
  observability?: ObservabilityEngine,
) {
  const base = LOCAL_DEFAULTS.apiBase;
  const engine = () => {
    if (!observability)
      throw new DomainError("CAPABILITY_UNAVAILABLE", "Observability is unavailable", 503);
    return observability;
  };
  app.get(`${base}/observability/health`, async (c) =>
    c.json(await engine().health(c.get("actor"), ObservabilityQuery.parse(c.req.query()))),
  );
  app.get(`${base}/observability/logs`, async (c) =>
    c.json(await engine().logs(c.get("actor"), ObservabilityQuery.parse(c.req.query()))),
  );
  app.get(`${base}/observability/metrics`, async (c) =>
    c.json(await engine().metrics(c.get("actor"), ObservabilityQuery.parse(c.req.query()))),
  );
  app.get(`${base}/observability/timeline`, async (c) =>
    c.json(await engine().timeline(c.get("actor"), ObservabilityQuery.parse(c.req.query()))),
  );
  app.get(`${base}/overview/operational`, async (c) =>
    c.json(await engine().overview(c.get("actor"))),
  );
  app.post(`${base}/observability/sources`, async (c) =>
    c.json(
      await engine().registerSource(
        c.get("actor"),
        RegisterTelemetrySource.parse(await c.req.json()),
        c.req.header("idempotency-key") ?? "",
      ),
      201,
    ),
  );
  app.post(`${base}/observability/sources/:id/records`, async (c) =>
    c.json(
      await engine().ingest(
        c.get("actor"),
        c.req.param("id"),
        IngestTelemetry.parse(await c.req.json()),
        c.req.header("idempotency-key") ?? "",
      ),
      201,
    ),
  );
}
