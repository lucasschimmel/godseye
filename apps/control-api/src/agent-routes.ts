import {
  ChangeAgentProfile,
  ConfigureAgentProfile,
  CreateAgentProfile,
  EmptyRequest,
  HttpId,
  LaunchAgentTask,
  LOCAL_DEFAULTS,
} from "@godseye/contracts";
import { DomainError, type InfrastructureEngine } from "@godseye/core";
import type { Hono } from "hono";
import type { ControlEnvironment } from "./api-types.js";

/** Only the existing authenticated owner middleware can reach this metadata/task boundary. */
export function registerAgentRoutes(
  app: Hono<ControlEnvironment>,
  infrastructure?: InfrastructureEngine,
) {
  const base = `${LOCAL_DEFAULTS.apiBase}/agents`;
  const engine = () => {
    if (!infrastructure)
      throw new DomainError("CAPABILITY_UNAVAILABLE", "Agent Center is unavailable", 503);
    return infrastructure.agents;
  };
  app.get(base, async (c) => c.json(await engine().overview(c.get("actor"))));
  app.post(`${base}/profiles`, async (c) =>
    c.json(
      await engine().createProfile(
        c.get("actor"),
        CreateAgentProfile.parse(await c.req.json()),
        c.req.header("idempotency-key") ?? "",
      ),
      201,
    ),
  );
  app.post(`${base}/profiles/:id/configure`, async (c) =>
    c.json(
      await engine().configureProfile(
        c.get("actor"),
        HttpId.parse(c.req.param("id")),
        ConfigureAgentProfile.parse(await c.req.json()),
        c.req.header("idempotency-key") ?? "",
      ),
    ),
  );
  for (const action of ["pause", "resume"] as const)
    app.post(`${base}/profiles/:id/${action}`, async (c) =>
      c.json(
        await engine()[action](
          c.get("actor"),
          HttpId.parse(c.req.param("id")),
          ChangeAgentProfile.parse(await c.req.json()),
          c.req.header("idempotency-key") ?? "",
        ),
      ),
    );
  app.post(`${base}/tasks`, async (c) =>
    c.json(
      await engine().launch(
        c.get("actor"),
        LaunchAgentTask.parse(await c.req.json()),
        c.req.header("idempotency-key") ?? "",
      ),
      202,
    ),
  );
  app.get(`${base}/tasks/:id`, async (c) =>
    c.json(await engine().detail(c.get("actor"), HttpId.parse(c.req.param("id")))),
  );
  app.get(`${base}/tasks/:id/tools`, async (c) =>
    c.json(await engine().toolsDetail(c.get("actor"), HttpId.parse(c.req.param("id")))),
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
