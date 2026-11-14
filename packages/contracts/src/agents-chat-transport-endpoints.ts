import { z } from "zod";
import { AgentChatEvent } from "./agents-chat.js";
import type { ControlEndpoint } from "./http-endpoints.js";

export const AGENT_CHAT_TRANSPORT_ENDPOINTS = [
  {
    method: "GET",
    path: "/agents/conversations/:id/events",
    operationId: "streamAgentConversation",
    response: AgentChatEvent,
    success: 200,
    access: "owner",
    transport: "sse",
  },
  {
    method: "GET",
    path: "/agents/artifacts/:id/download",
    operationId: "downloadAgentArtifact",
    response: z.string().max(16384),
    success: 200,
    access: "owner",
    transport: "attachment",
  },
] as const satisfies readonly ControlEndpoint[];
