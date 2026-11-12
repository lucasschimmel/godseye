import {
  AdmitInfrastructure,
  DeclareInventory,
  InfrastructureRevision,
  LOCAL_DEFAULTS,
  PrepareInfrastructure,
  SetAdmission,
} from "@godseye/contracts";
import { DomainError, type InfrastructureEngine } from "@godseye/core";
import type { Hono } from "hono";
import type { ControlEnvironment } from "./api-types.js";

export function registerInfrastructureRoutes(
  app: Hono<ControlEnvironment>,
  infrastructure?: InfrastructureEngine,
) {
  const base = `${LOCAL_DEFAULTS.apiBase}/infrastructure`;
  const available = () => {
    if (!infrastructure)
      throw new DomainError(
        "CAPABILITY_UNAVAILABLE",
        "Infrastructure inventory is unavailable",
        503,
      );
    return infrastructure;
  };
  app.get(base, async (c) => c.json(await available().overview(c.get("actor"))));
  app.get(`${base}/headroom`, async (c) => c.json(await available().headroom(c.get("actor"))));
  app.put(`${base}/admission`, async (c) =>
    c.json(
      await available().setAdmission(
        c.get("actor"),
        SetAdmission.parse(await c.req.json()),
        c.req.header("idempotency-key") ?? "",
      ),
    ),
  );
  app.put(`${base}/inventory`, async (c) =>
    c.json(
      await available().declareInventory(
        c.get("actor"),
        DeclareInventory.parse(await c.req.json()),
        c.req.header("idempotency-key") ?? "",
      ),
    ),
  );
  app.post(`${base}/refresh`, async (c) =>
    c.json(
      await available().refreshInventory(
        c.get("actor"),
        InfrastructureRevision.parse(await c.req.json()),
        c.req.header("idempotency-key") ?? "",
      ),
    ),
  );
  app.post(`${base}/preparations`, async (c) =>
    c.json(
      await available().prepare(
        c.get("actor"),
        PrepareInfrastructure.parse(await c.req.json()),
        c.req.header("idempotency-key") ?? "",
      ),
      201,
    ),
  );
  app.post(`${base}/admissions`, async (c) =>
    c.json(
      await available().admit(
        c.get("actor"),
        AdmitInfrastructure.parse(await c.req.json()),
        c.req.header("idempotency-key") ?? "",
      ),
      202,
    ),
  );
}
