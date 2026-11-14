import {
  AnswerOrchestration,
  DecideOrchestration,
  EmptyRequest,
  HttpId,
  LOCAL_DEFAULTS,
  PrepareOrchestration,
  ProposeOrchestration,
} from "@godseye/contracts";
import { DomainError, type InfrastructureEngine } from "@godseye/core";
import type { Hono } from "hono";
import type { ControlEnvironment } from "./api-types.js";
export function registerOrchestrationRoutes(
  app: Hono<ControlEnvironment>,
  infrastructure?: InfrastructureEngine,
) {
  const base = `${LOCAL_DEFAULTS.apiBase}/agents/orchestration`;
  const engine = () => {
    if (!infrastructure)
      throw new DomainError("CAPABILITY_UNAVAILABLE", "Orchestration is unavailable", 503);
    return infrastructure.orchestration;
  };
  app.get(base, async (c) => c.json(await engine().overview(c.get("actor"))));
  app.post(`${base}/plans`, async (c) =>
    c.json(
      await engine().prepare(
        c.get("actor"),
        PrepareOrchestration.parse(await c.req.json()),
        c.req.header("idempotency-key") ?? "",
      ),
      201,
    ),
  );
  app.post(`${base}/proposals`, async (c) =>
    c.json(
      await engine().propose(
        c.get("actor"),
        ProposeOrchestration.parse(await c.req.json()),
        c.req.header("idempotency-key") ?? "",
      ),
      201,
    ),
  );
  app.get(`${base}/plans/:id`, async (c) =>
    c.json(await engine().detail(c.get("actor"), HttpId.parse(c.req.param("id")))),
  );
  for (const action of ["approve", "reject", "answer"] as const)
    app.post(`${base}/plans/:id/${action}`, async (c) =>
      c.json(
        await engine()[action](
          c.get("actor"),
          HttpId.parse(c.req.param("id")),
          (action === "answer" ? AnswerOrchestration : DecideOrchestration).parse(
            await c.req.json(),
          ),
          c.req.header("idempotency-key") ?? "",
        ),
        action === "answer" ? 201 : 200,
      ),
    );
  for (const action of ["cancel", "reconcile"] as const)
    app.post(`${base}/plans/:id/${action}`, async (c) => {
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
