import {
  CONTROL_API_VERSION,
  controlPath,
  findControlEndpoint,
  LOCAL_DEFAULTS,
  parseControlResponse,
} from "@godseye/contracts";
import { type Actor, DomainError } from "@godseye/core";
import type { Hono, MiddlewareHandler } from "hono";
export type ControlEnvironment = { Variables: { requestId: string; actor: Actor } };

/** First-party metadata only. Native vendor authentication and streaming/file protocols are excluded. */
export function registerControlResponseValidation(app: Hono<ControlEnvironment>) {
  const validate: MiddlewareHandler<ControlEnvironment> = async (context, next) => {
    await next();
    if (
      !context.res.ok ||
      (!findControlEndpoint(context.req.method, context.req.path) &&
        controlPath(context.req.path) !== "/openapi.json")
    )
      return;
    const previous = context.res;
    let body: unknown;
    try {
      body = parseControlResponse(
        context.req.method,
        context.req.path,
        await previous.json(),
        CONTROL_API_VERSION,
      );
    } catch {
      throw new DomainError(
        "INTERNAL_ERROR",
        "Control response violated its published contract",
        500,
      );
    }
    context.res = Response.json(body, { status: previous.status, headers: previous.headers });
  };
  app.use(`${LOCAL_DEFAULTS.apiBase}/*`, validate);
  app.use("/hooks/github", validate);
}
