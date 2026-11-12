import {
  AdmitRecovery,
  HttpId,
  LOCAL_DEFAULTS,
  PrepareArchiveCheck,
  PrepareBackup,
  PrepareRestore,
} from "@godseye/contracts";
import { DomainError, type InfrastructureEngine } from "@godseye/core";
import type { Hono } from "hono";
import type { ControlEnvironment } from "./api-types.js";
export function registerRecoveryRoutes(
  app: Hono<ControlEnvironment>,
  infrastructure?: InfrastructureEngine,
) {
  const base = `${LOCAL_DEFAULTS.apiBase}/recovery`;
  const recovery = () => {
    if (!infrastructure)
      throw new DomainError("CAPABILITY_UNAVAILABLE", "Recovery engine is unavailable", 503);
    return infrastructure.recovery;
  };
  app.get(base, async (c) => c.json(await recovery().overview(c.get("actor"))));
  app.post(`${base}/archives/preparations`, async (c) =>
    c.json(
      await recovery().prepareArchiveCheck(
        c.get("actor"),
        PrepareArchiveCheck.parse(await c.req.json()),
        c.req.header("idempotency-key") ?? "",
      ),
      201,
    ),
  );
  app.post(`${base}/backups/preparations`, async (c) =>
    c.json(
      await recovery().prepareBackup(
        c.get("actor"),
        PrepareBackup.parse(await c.req.json()),
        c.req.header("idempotency-key") ?? "",
      ),
      201,
    ),
  );
  app.post(`${base}/restores/preparations`, async (c) =>
    c.json(
      await recovery().prepareRestore(
        c.get("actor"),
        PrepareRestore.parse(await c.req.json()),
        c.req.header("idempotency-key") ?? "",
      ),
      201,
    ),
  );
  app.post(`${base}/admissions`, async (c) =>
    c.json(
      await recovery().admit(
        c.get("actor"),
        AdmitRecovery.parse(await c.req.json()),
        c.req.header("idempotency-key") ?? "",
      ),
      202,
    ),
  );
  app.get(`${base}/environments/:id/activation`, async (c) =>
    c.json(await recovery().assessActivation(c.get("actor"), HttpId.parse(c.req.param("id")))),
  );
}
