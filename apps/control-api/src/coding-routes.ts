import {
  AdmitCodingTask,
  EmptyRequest,
  HttpId,
  LOCAL_DEFAULTS,
  PrepareCodingTask,
} from "@godseye/contracts";
import { DomainError, type InfrastructureEngine } from "@godseye/core";
import type { Hono } from "hono";
import type { ControlEnvironment } from "./api-types.js";

export function registerCodingRoutes(
  app: Hono<ControlEnvironment>,
  infrastructure?: InfrastructureEngine,
) {
  const base = `${LOCAL_DEFAULTS.apiBase}/agents/coding`;
  const engine = () => {
    if (!infrastructure)
      throw new DomainError("CAPABILITY_UNAVAILABLE", "Coding runners are unavailable", 503);
    return infrastructure.coding;
  };
  app.get(base, async (c) => c.json(await engine().overview(c.get("actor"))));
  app.post(`${base}/preparations`, async (c) =>
    c.json(
      await engine().prepare(
        c.get("actor"),
        PrepareCodingTask.parse(await c.req.json()),
        c.req.header("idempotency-key") ?? "",
      ),
      201,
    ),
  );
  app.get(`${base}/preparations/:id`, async (c) =>
    c.json(await engine().preparation(c.get("actor"), HttpId.parse(c.req.param("id")))),
  );
  app.post(`${base}/tasks`, async (c) =>
    c.json(
      await engine().admit(
        c.get("actor"),
        AdmitCodingTask.parse(await c.req.json()),
        c.req.header("idempotency-key") ?? "",
      ),
      202,
    ),
  );
  app.get(`${base}/tasks/:id`, async (c) =>
    c.json(await engine().detail(c.get("actor"), HttpId.parse(c.req.param("id")))),
  );
  for (const action of ["cancel", "reconcile"] as const)
    app.post(`${base}/tasks/:id/${action}`, async (c) => {
      EmptyRequest.parse(await c.req.json());
      return c.json(
        await engine()[action](
          c.get("actor"),
          HttpId.parse(c.req.param("id")),
          c.req.header("idempotency-key") ?? "",
        ),
      );
    });
}
