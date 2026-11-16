import {
  AddProjectDomain,
  DomainAskQuery,
  HttpId,
  LOCAL_DEFAULTS,
  RemoveProjectDomain,
  VerifyProjectDomain,
} from "@godseye/contracts";
import { DomainError, type InfrastructureEngine } from "@godseye/core";
import type { Hono } from "hono";
import type { ControlEnvironment } from "./api-types.js";

/** Public path the edge Caddy calls before an on-demand certificate; it carries no authority. */
export const DOMAIN_ASK_PATH = `${LOCAL_DEFAULTS.apiBase}/domains/ask`;

/** Custom application domains: owner commands plus the unauthenticated edge `ask` guard. */
export function registerDomainRoutes(
  app: Hono<ControlEnvironment>,
  infrastructure?: InfrastructureEngine,
) {
  const base = LOCAL_DEFAULTS.apiBase;
  const engine = () => {
    if (!infrastructure)
      throw new DomainError("CAPABILITY_UNAVAILABLE", "Domain engine is unavailable", 503);
    return infrastructure.domains;
  };
  const key = (c: { req: { header(name: string): string | undefined } }) =>
    c.req.header("idempotency-key") ?? "";
  app.get(DOMAIN_ASK_PATH, async (c) => {
    const { domain } = DomainAskQuery.parse(c.req.query());
    if (!(await engine().servable(domain)))
      throw new DomainError("NOT_FOUND", "Domain is not served by this platform", 404);
    return c.json({ allowed: true as const });
  });
  app.get(`${base}/projects/:id/domains`, async (c) =>
    c.json(await engine().list(c.get("actor"), HttpId.parse(c.req.param("id")))),
  );
  app.post(`${base}/projects/:id/domains`, async (c) =>
    c.json(
      await engine().add(
        c.get("actor"),
        HttpId.parse(c.req.param("id")),
        AddProjectDomain.parse(await c.req.json()),
        key(c),
      ),
      201,
    ),
  );
  for (const action of ["verify", "remove"] as const)
    app.post(`${base}/projects/:id/domains/:domainId/${action}`, async (c) => {
      const projectId = HttpId.parse(c.req.param("id"));
      const domainId = HttpId.parse(c.req.param("domainId"));
      const body = await c.req.json();
      return c.json(
        action === "verify"
          ? await engine().verify(
              c.get("actor"),
              projectId,
              domainId,
              VerifyProjectDomain.parse(body),
              key(c),
            )
          : await engine().remove(
              c.get("actor"),
              projectId,
              domainId,
              RemoveProjectDomain.parse(body),
              key(c),
            ),
      );
    });
}
