import {
  CreateNotificationChannel,
  HttpId,
  LOCAL_DEFAULTS,
  RemoveNotificationChannel,
  TestNotificationChannel,
} from "@godseye/contracts";
import { DomainError, type InfrastructureEngine } from "@godseye/core";
import type { Hono } from "hono";
import type { ControlEnvironment } from "./api-types.js";

/**
 * Owner notification channels. Responses carry only the display host and fixed result codes;
 * the webhook URL and signing secret are accepted once and never returned or logged.
 */
export function registerNotificationRoutes(
  app: Hono<ControlEnvironment>,
  infrastructure?: InfrastructureEngine,
) {
  const base = `${LOCAL_DEFAULTS.apiBase}/notifications/channels`;
  const engine = () => {
    if (!infrastructure)
      throw new DomainError("CAPABILITY_UNAVAILABLE", "Notification channels are unavailable", 503);
    return infrastructure.notifications;
  };
  const key = (c: { req: { header(name: string): string | undefined } }) =>
    c.req.header("idempotency-key") ?? "";
  app.get(base, async (c) => c.json(await engine().overview(c.get("actor"))));
  app.post(base, async (c) =>
    c.json(
      await engine().create(
        c.get("actor"),
        CreateNotificationChannel.parse(await c.req.json()),
        key(c),
      ),
      201,
    ),
  );
  app.post(`${base}/:id/test`, async (c) =>
    c.json(
      await engine().test(
        c.get("actor"),
        HttpId.parse(c.req.param("id")),
        TestNotificationChannel.parse(await c.req.json()),
        key(c),
      ),
    ),
  );
  app.post(`${base}/:id/remove`, async (c) =>
    c.json(
      await engine().remove(
        c.get("actor"),
        HttpId.parse(c.req.param("id")),
        RemoveNotificationChannel.parse(await c.req.json()),
        key(c),
      ),
    ),
  );
}
