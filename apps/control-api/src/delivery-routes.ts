import {
  AdmitDelivery,
  CreateDeliveryPolicy,
  LOCAL_DEFAULTS,
  PrepareDelivery,
  SynchronizeDelivery,
} from "@godseye/contracts";
import { DomainError, type InfrastructureEngine } from "@godseye/core";
import type { Hono } from "hono";
import { z } from "zod";
import type { ControlEnvironment } from "./api-types.js";

export function registerDeliveryRoutes(
  app: Hono<ControlEnvironment>,
  infrastructure?: InfrastructureEngine,
) {
  const engine = () => {
    if (!infrastructure)
      throw new DomainError("CAPABILITY_UNAVAILABLE", "Delivery engine is unavailable", 503);
    return infrastructure.delivery;
  };
  const base = `${LOCAL_DEFAULTS.apiBase}/delivery`;
  app.get(base, async (c) => c.json(await engine().overview(c.get("actor"))));
  app.post(`${base}/policies`, async (c) =>
    c.json(
      await engine().createPolicy(
        c.get("actor"),
        CreateDeliveryPolicy.parse(await c.req.json()),
        c.req.header("idempotency-key") ?? "",
      ),
      201,
    ),
  );
  app.post(`${base}/policies/:id/revoke`, async (c) => {
    const { expectedRevision } = z
      .object({ expectedRevision: z.number().int().nonnegative() })
      .strict()
      .parse(await c.req.json());
    return c.json(
      await engine().revokePolicy(
        c.get("actor"),
        z.string().uuid().parse(c.req.param("id")),
        expectedRevision,
        c.req.header("idempotency-key") ?? "",
      ),
    );
  });
  app.post(`${base}/synchronize`, async (c) =>
    c.json(
      await engine().synchronize(
        c.get("actor"),
        SynchronizeDelivery.parse(await c.req.json()),
        c.req.header("idempotency-key") ?? "",
      ),
    ),
  );
  app.post(`${base}/preparations`, async (c) =>
    c.json(
      await engine().prepare(
        c.get("actor"),
        PrepareDelivery.parse(await c.req.json()),
        c.req.header("idempotency-key") ?? "",
      ),
      201,
    ),
  );
  app.post(`${base}/admissions`, async (c) =>
    c.json(
      await engine().admit(
        c.get("actor"),
        AdmitDelivery.parse(await c.req.json()),
        c.req.header("idempotency-key") ?? "",
      ),
      201,
    ),
  );
  app.post(`${base}/cleanup`, async (c) => {
    z.object({})
      .strict()
      .parse(await c.req.json());
    return c.json(
      await engine().cleanupExpired(c.get("actor"), c.req.header("idempotency-key") ?? ""),
    );
  });
}
