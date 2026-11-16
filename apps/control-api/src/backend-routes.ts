import { ConfigureBackend, HttpId, LOCAL_DEFAULTS } from "@godseye/contracts";
import type { ControlPlane } from "@godseye/core";
import type { Hono } from "hono";
import type { ControlEnvironment } from "./api-types.js";

export function registerBackendRoutes(app: Hono<ControlEnvironment>, core: ControlPlane) {
  const path = `${LOCAL_DEFAULTS.apiBase}/projects/:id/environments/:environmentId/backend`;
  app.get(path, async (c) =>
    c.json(
      await core.backendConfiguration(
        c.get("actor"),
        HttpId.parse(c.req.param("id")),
        HttpId.parse(c.req.param("environmentId")),
      ),
    ),
  );
  app.put(path, async (c) =>
    c.json(
      await core.configureBackend(
        c.get("actor"),
        HttpId.parse(c.req.param("id")),
        HttpId.parse(c.req.param("environmentId")),
        ConfigureBackend.parse(await c.req.json()),
        c.req.header("idempotency-key") ?? "",
      ),
    ),
  );
}
