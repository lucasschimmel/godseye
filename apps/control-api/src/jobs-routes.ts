import {
  CancelJobRun,
  JobDefinitionChange,
  LOCAL_DEFAULTS,
  ReconcileJobRun,
  ReconcileOutbox,
  RegisterJobDefinition,
  TriggerJob,
} from "@godseye/contracts";
import { DomainError, type InfrastructureEngine } from "@godseye/core";
import type { Hono } from "hono";
import { z } from "zod";
import type { ControlEnvironment } from "./api-types.js";

const Id = z.string().uuid();
export function registerJobsRoutes(
  app: Hono<ControlEnvironment>,
  infrastructure?: InfrastructureEngine,
) {
  const engine = () => {
    if (!infrastructure)
      throw new DomainError("CAPABILITY_UNAVAILABLE", "Job engine is unavailable", 503);
    return infrastructure.jobs;
  };
  const base = `${LOCAL_DEFAULTS.apiBase}/jobs`;
  const key = (header: string | undefined) => header ?? "";
  app.get(base, async (c) => c.json(await engine().overview(c.get("actor"))));
  app.post(`${base}/definitions`, async (c) =>
    c.json(
      await engine().registerDefinition(
        c.get("actor"),
        RegisterJobDefinition.parse(await c.req.json()),
        key(c.req.header("idempotency-key")),
      ),
      201,
    ),
  );
  for (const action of ["pause", "resume"] as const)
    app.post(`${base}/definitions/:id/${action}`, async (c) => {
      const { expectedRevision } = JobDefinitionChange.parse(await c.req.json());
      return c.json(
        await engine()[action](
          c.get("actor"),
          Id.parse(c.req.param("id")),
          expectedRevision,
          key(c.req.header("idempotency-key")),
        ),
      );
    });
  app.post(`${base}/definitions/:id/trigger`, async (c) =>
    c.json(
      await engine().trigger(
        c.get("actor"),
        Id.parse(c.req.param("id")),
        TriggerJob.parse(await c.req.json()),
        key(c.req.header("idempotency-key")),
      ),
      202,
    ),
  );
  app.post(`${base}/runs/:id/cancel`, async (c) =>
    c.json(
      await engine().cancel(
        c.get("actor"),
        Id.parse(c.req.param("id")),
        CancelJobRun.parse(await c.req.json()),
        key(c.req.header("idempotency-key")),
      ),
    ),
  );
  app.post(`${base}/runs/:id/reconcile`, async (c) =>
    c.json(
      await engine().reconcileRun(
        c.get("actor"),
        Id.parse(c.req.param("id")),
        ReconcileJobRun.parse(await c.req.json()),
        key(c.req.header("idempotency-key")),
      ),
    ),
  );
  app.post(`${base}/outbox/:id/reconcile`, async (c) =>
    c.json(
      await engine().reconcileOutbox(
        c.get("actor"),
        Id.parse(c.req.param("id")),
        ReconcileOutbox.parse(await c.req.json()),
        key(c.req.header("idempotency-key")),
      ),
    ),
  );
}
