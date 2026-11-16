import { AgentTaskToolsDetail } from "./agents-tools.js";
import type { ControlEndpoint } from "./http-endpoints.js";
export const AGENT_TOOLS_HTTP_ENDPOINTS = [
  {
    method: "GET",
    path: "/agents/tasks/:id/tools",
    operationId: "agentTaskTools",
    response: AgentTaskToolsDetail,
    success: 200,
    access: "owner",
  },
] as const satisfies readonly ControlEndpoint[];
