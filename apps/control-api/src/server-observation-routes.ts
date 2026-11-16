import { LOCAL_DEFAULTS } from "@godseye/contracts";
import type { ServerObserver } from "@godseye/core";
import type { Hono } from "hono";
import type { ControlEnvironment } from "./api-types.js";

/** Owner-only, read-only observations of the server the control API runs on. */
export function registerServerObservationRoutes(
  app: Hono<ControlEnvironment>,
  observer: ServerObserver,
) {
  app.get(`${LOCAL_DEFAULTS.apiBase}/infrastructure/server`, async (c) =>
    c.json(await observer.observe(c.get("actor"))),
  );
}
