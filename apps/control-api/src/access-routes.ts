import {
  AccessRevision,
  ActivateAccessSlot,
  CreateAccessSlot,
  CreateServiceIdentity,
  LOCAL_DEFAULTS,
} from "@godseye/contracts";
import { type AccessBroker, DomainError } from "@godseye/core";
import type { Hono } from "hono";
import { z } from "zod";
import type { ControlEnvironment } from "./api-types.js";

export function registerAccessRoutes(app: Hono<ControlEnvironment>, broker?: AccessBroker) {
  const base = `${LOCAL_DEFAULTS.apiBase}/access`;
  const available = () => {
    if (!broker)
      throw new DomainError("CAPABILITY_UNAVAILABLE", "Local access broker is unavailable", 503);
    return broker;
  };
  const id = (value: string) => z.string().uuid().parse(value);
  app.get(base, (c) =>
    available()
      .overview(c.get("actor"))
      .then((data) => c.json(data)),
  );
  app.post(`${base}/identities`, async (c) =>
    c.json(
      await available().createIdentity(
        c.get("actor"),
        CreateServiceIdentity.parse(await c.req.json()),
        c.req.header("idempotency-key") ?? "",
      ),
      201,
    ),
  );
  app.post(`${base}/slots`, async (c) =>
    c.json(
      await available().createSlot(
        c.get("actor"),
        CreateAccessSlot.parse(await c.req.json()),
        c.req.header("idempotency-key") ?? "",
      ),
      201,
    ),
  );
  app.post(`${base}/identities/:id/revoke`, async (c) => {
    const input = AccessRevision.parse(await c.req.json());
    return c.json(
      await available().revokeIdentity(
        c.get("actor"),
        id(c.req.param("id")),
        input.expectedRevision,
        c.req.header("idempotency-key") ?? "",
      ),
    );
  });
  app.post(`${base}/slots/:id/activate`, async (c) => {
    const input = ActivateAccessSlot.parse(await c.req.json());
    return c.json(
      await available().activate(
        c.get("actor"),
        id(c.req.param("id")),
        input.adapterId,
        input.expectedRevision,
        c.req.header("idempotency-key") ?? "",
      ),
    );
  });
  app.post(`${base}/operations/:id/reconcile`, async (c) => {
    z.object({})
      .strict()
      .parse(await c.req.json());
    return c.json(
      await available().reconcile(
        c.get("actor"),
        id(c.req.param("id")),
        c.req.header("idempotency-key") ?? "",
      ),
    );
  });
}
