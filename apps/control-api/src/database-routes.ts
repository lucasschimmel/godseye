import {
  AdmitDatabase,
  CreateEnvironment,
  HttpId,
  LOCAL_DEFAULTS,
  PrepareDatabase,
  UpdateEnvironment,
  UpdateProject,
} from "@godseye/contracts";
import { type ControlPlane, DomainError, type InfrastructureEngine } from "@godseye/core";
import type { Hono } from "hono";
import type { ControlEnvironment } from "./api-types.js";
export function registerDatabaseRoutes(
  app: Hono<ControlEnvironment>,
  core: ControlPlane,
  infrastructure?: InfrastructureEngine,
) {
  const base = LOCAL_DEFAULTS.apiBase;
  const database = () => {
    if (!infrastructure)
      throw new DomainError(
        "CAPABILITY_UNAVAILABLE",
        "Database preparation engine is unavailable",
        503,
      );
    return infrastructure.database;
  };
  app.get(`${base}/databases`, async (c) => c.json(await database().overview(c.get("actor"))));
  app.post(`${base}/databases/preparations`, async (c) =>
    c.json(
      await database().prepare(
        c.get("actor"),
        PrepareDatabase.parse(await c.req.json()),
        c.req.header("idempotency-key") ?? "",
      ),
      201,
    ),
  );
  app.post(`${base}/databases/admissions`, async (c) =>
    c.json(
      await database().admit(
        c.get("actor"),
        AdmitDatabase.parse(await c.req.json()),
        c.req.header("idempotency-key") ?? "",
      ),
      202,
    ),
  );
  app.put(`${base}/projects/:id`, async (c) =>
    c.json(
      await core.updateProject(
        c.get("actor"),
        HttpId.parse(c.req.param("id")),
        UpdateProject.parse(await c.req.json()),
        c.req.header("idempotency-key") ?? "",
      ),
    ),
  );
  app.post(`${base}/projects/:id/environments`, async (c) =>
    c.json(
      await core.createEnvironment(
        c.get("actor"),
        HttpId.parse(c.req.param("id")),
        CreateEnvironment.parse(await c.req.json()),
        c.req.header("idempotency-key") ?? "",
      ),
      201,
    ),
  );
  app.put(`${base}/projects/:id/environments/:environmentId`, async (c) =>
    c.json(
      await core.updateEnvironment(
        c.get("actor"),
        HttpId.parse(c.req.param("id")),
        HttpId.parse(c.req.param("environmentId")),
        UpdateEnvironment.parse(await c.req.json()),
        c.req.header("idempotency-key") ?? "",
      ),
    ),
  );
}
