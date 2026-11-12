import { createControlOpenApi, LOCAL_DEFAULTS } from "@godseye/contracts";
import type { Hono } from "hono";
import type { ControlEnvironment } from "./api-types.js";

export function registerOpenApi(app: Hono<ControlEnvironment>) {
  const document = createControlOpenApi();
  app.get(`${LOCAL_DEFAULTS.apiBase}/openapi.json`, (context) => context.json(document));
}
