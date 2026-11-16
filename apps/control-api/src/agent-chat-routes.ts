import {
  CreateAgentConversation,
  HttpId,
  LOCAL_DEFAULTS,
  ResolveAgentProposal,
  SendAgentChatTurn,
} from "@godseye/contracts";
import { DomainError, type InfrastructureEngine } from "@godseye/core";
import type { Hono } from "hono";
import type { ControlEnvironment } from "./api-types.js";
export function registerAgentChatRoutes(
  app: Hono<ControlEnvironment>,
  infrastructure?: InfrastructureEngine,
) {
  const base = `${LOCAL_DEFAULTS.apiBase}/agents`;
  const engine = () => {
    if (!infrastructure)
      throw new DomainError("CAPABILITY_UNAVAILABLE", "Agent chat is unavailable", 503);
    return infrastructure.agents;
  };
  app.get(`${base}/conversations`, async (c) => c.json(await engine().chatList(c.get("actor"))));
  app.post(`${base}/conversations`, async (c) =>
    c.json(
      await engine().chatCreate(
        c.get("actor"),
        CreateAgentConversation.parse(await c.req.json()),
        c.req.header("idempotency-key") ?? "",
      ),
      201,
    ),
  );
  app.get(`${base}/conversations/:id`, async (c) =>
    c.json(await engine().chatDetail(c.get("actor"), HttpId.parse(c.req.param("id")))),
  );
  app.post(`${base}/conversations/:id/turns`, async (c) =>
    c.json(
      await engine().chatSend(
        c.get("actor"),
        HttpId.parse(c.req.param("id")),
        SendAgentChatTurn.parse(await c.req.json()),
        c.req.header("idempotency-key") ?? "",
      ),
      202,
    ),
  );
  app.post(`${base}/proposals/:id/resolve`, async (c) =>
    c.json(
      await engine().chatResolve(
        c.get("actor"),
        HttpId.parse(c.req.param("id")),
        ResolveAgentProposal.parse(await c.req.json()),
        c.req.header("idempotency-key") ?? "",
      ),
    ),
  );
}
