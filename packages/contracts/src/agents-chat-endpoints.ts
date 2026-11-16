import {
  AgentChatProposal,
  AgentConversationDetail,
  AgentConversationList,
  CreateAgentConversation,
  ResolveAgentProposal,
  SendAgentChatTurn,
} from "./agents-chat.js";
import type { ControlEndpoint } from "./http-endpoints.js";

export const AGENT_CHAT_HTTP_ENDPOINTS = [
  {
    method: "GET",
    path: "/agents/conversations",
    operationId: "agentConversations",
    response: AgentConversationList,
    success: 200,
    access: "owner",
  },
  {
    method: "POST",
    path: "/agents/conversations",
    operationId: "createAgentConversation",
    request: CreateAgentConversation,
    response: AgentConversationDetail,
    success: 201,
    access: "owner",
    idempotent: true,
  },
  {
    method: "GET",
    path: "/agents/conversations/:id",
    operationId: "agentConversation",
    response: AgentConversationDetail,
    success: 200,
    access: "owner",
  },
  {
    method: "POST",
    path: "/agents/conversations/:id/turns",
    operationId: "sendAgentChatTurn",
    request: SendAgentChatTurn,
    response: AgentConversationDetail,
    success: 202,
    access: "owner",
    idempotent: true,
  },
  {
    method: "POST",
    path: "/agents/proposals/:id/resolve",
    operationId: "resolveAgentProposal",
    request: ResolveAgentProposal,
    response: AgentChatProposal,
    success: 200,
    access: "owner",
    idempotent: true,
  },
] as const satisfies readonly ControlEndpoint[];
