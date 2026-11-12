import {
  CreateProjectExport,
  HttpId,
  LOCAL_DEFAULTS,
  PurgeProject,
  QuarantineProject,
  ReleaseQuarantine,
  ResumeProject,
  SuspendProject,
} from "@godseye/contracts";
import { DomainError, type InfrastructureEngine } from "@godseye/core";
import type { Hono } from "hono";
import type { ControlEnvironment } from "./api-types.js";

/** Staged project deletion and metadata export; owner-only, revision and idempotency protected. */
export function registerLifecycleRoutes(
  app: Hono<ControlEnvironment>,
  infrastructure?: InfrastructureEngine,
) {
  const base = LOCAL_DEFAULTS.apiBase;
  const engine = () => {
    if (!infrastructure)
      throw new DomainError("CAPABILITY_UNAVAILABLE", "Lifecycle engine is unavailable", 503);
    return infrastructure.lifecycle;
  };
  const key = (c: { req: { header(name: string): string | undefined } }) =>
    c.req.header("idempotency-key") ?? "";
  app.get(`${base}/projects/:id/lifecycle`, async (c) =>
    c.json(await engine().view(c.get("actor"), HttpId.parse(c.req.param("id")))),
  );
  app.post(`${base}/projects/:id/lifecycle/suspend`, async (c) =>
    c.json(
      await engine().suspend(
        c.get("actor"),
        HttpId.parse(c.req.param("id")),
        SuspendProject.parse(await c.req.json()),
        key(c),
      ),
    ),
  );
  app.post(`${base}/projects/:id/lifecycle/resume`, async (c) =>
    c.json(
      await engine().resume(
        c.get("actor"),
        HttpId.parse(c.req.param("id")),
        ResumeProject.parse(await c.req.json()),
        key(c),
      ),
    ),
  );
  app.post(`${base}/projects/:id/lifecycle/quarantine`, async (c) =>
    c.json(
      await engine().quarantine(
        c.get("actor"),
        HttpId.parse(c.req.param("id")),
        QuarantineProject.parse(await c.req.json()),
        key(c),
      ),
    ),
  );
  app.post(`${base}/projects/:id/lifecycle/release`, async (c) =>
    c.json(
      await engine().release(
        c.get("actor"),
        HttpId.parse(c.req.param("id")),
        ReleaseQuarantine.parse(await c.req.json()),
        key(c),
      ),
    ),
  );
  app.post(`${base}/projects/:id/lifecycle/purge`, async (c) =>
    c.json(
      await engine().purge(
        c.get("actor"),
        HttpId.parse(c.req.param("id")),
        PurgeProject.parse(await c.req.json()),
        key(c),
      ),
    ),
  );
  app.post(`${base}/projects/:id/exports`, async (c) =>
    c.json(
      await engine().exportMetadata(
        c.get("actor"),
        HttpId.parse(c.req.param("id")),
        CreateProjectExport.parse(await c.req.json()),
        key(c),
      ),
      201,
    ),
  );
  app.get(`${base}/projects/:id/exports/:exportId`, async (c) =>
    c.json(
      await engine().exportById(
        c.get("actor"),
        HttpId.parse(c.req.param("id")),
        HttpId.parse(c.req.param("exportId")),
      ),
    ),
  );
}
