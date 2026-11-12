import {
  AcknowledgeIncident,
  EmptyRequest,
  HttpId,
  LOCAL_DEFAULTS,
  MuteIncident,
  ResolveIncident,
  RotateDatabaseRole,
} from "@godseye/contracts";
import { DomainError, type InfrastructureEngine } from "@godseye/core";
import type { Hono } from "hono";
import type { ControlEnvironment } from "./api-types.js";

/** Backup, rotation and incident views; read-only status never depends on provider health. */
export function registerProtectionRoutes(
  app: Hono<ControlEnvironment>,
  infrastructure?: InfrastructureEngine,
) {
  const base = LOCAL_DEFAULTS.apiBase;
  const engine = () => {
    if (!infrastructure)
      throw new DomainError("CAPABILITY_UNAVAILABLE", "Protection engines are unavailable", 503);
    return infrastructure;
  };
  const key = (c: { req: { header(name: string): string | undefined } }) =>
    c.req.header("idempotency-key") ?? "";
  app.get(`${base}/databases/backups`, async (c) =>
    c.json(await engine().recovery.backups(c.get("actor"))),
  );
  app.get(`${base}/databases/rotations`, async (c) =>
    c.json(await engine().rotation.overview(c.get("actor"))),
  );
  app.post(`${base}/databases/rotations`, async (c) =>
    c.json(
      await engine().rotation.rotate(
        c.get("actor"),
        RotateDatabaseRole.parse(await c.req.json()),
        key(c),
      ),
      202,
    ),
  );
  app.post(`${base}/databases/rotations/:id/reconcile`, async (c) => {
    EmptyRequest.parse(await c.req.json());
    return c.json(
      await engine().rotation.reconcile(c.get("actor"), HttpId.parse(c.req.param("id")), key(c)),
    );
  });
  app.get(`${base}/incidents`, async (c) =>
    c.json(await engine().incidents.overview(c.get("actor"))),
  );
  app.post(`${base}/incidents/evaluations`, async (c) => {
    EmptyRequest.parse(await c.req.json());
    return c.json(await engine().incidents.evaluate(c.get("actor"), key(c)));
  });
  app.post(`${base}/incidents/:id/acknowledge`, async (c) =>
    c.json(
      await engine().incidents.acknowledge(
        c.get("actor"),
        HttpId.parse(c.req.param("id")),
        AcknowledgeIncident.parse(await c.req.json()),
        key(c),
      ),
    ),
  );
  app.post(`${base}/incidents/:id/mute`, async (c) =>
    c.json(
      await engine().incidents.mute(
        c.get("actor"),
        HttpId.parse(c.req.param("id")),
        MuteIncident.parse(await c.req.json()),
        key(c),
      ),
    ),
  );
  app.post(`${base}/incidents/:id/resolve`, async (c) =>
    c.json(
      await engine().incidents.resolve(
        c.get("actor"),
        HttpId.parse(c.req.param("id")),
        ResolveIncident.parse(await c.req.json()),
        key(c),
      ),
    ),
  );
}
