import { LOCAL_DEFAULTS } from "@godseye/contracts";
import type { PlatformBuilds } from "@godseye/core";
import type { Hono } from "hono";
import type { ControlEnvironment } from "./api-types.js";

/** Owner-only, read-only list of the platform's own Jenkins builds. */
export function registerPlatformBuildsRoutes(
  app: Hono<ControlEnvironment>,
  builds: PlatformBuilds,
) {
  app.get(`${LOCAL_DEFAULTS.apiBase}/infrastructure/jenkins`, async (c) =>
    c.json(await builds.observe(c.get("actor"))),
  );
}
