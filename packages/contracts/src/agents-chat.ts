import { z } from "zod";
import { AgentTask } from "./agents.js";
import { AgentTaskToolSelection } from "./agents-tools.js";

export const AGENT_CHAT_LIMITS = {
  conversations: 64,
  turns: 100,
  events: 256,
  historyMessages: 4,
  historyBytes: 16384,
  partialBytes: 32768,
  artifactBytes: 16384,
  outputs: 8,
  proposalMs: 3600000,
} as const;
const Id = z.string().uuid();
const Revision = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const Moment = z.string().datetime();
const Hash = z.string().regex(/^[a-f0-9]{64}$/);
export const CreateAgentConversation = z
  .object({ profileId: Id, expectedRevision: Revision, title: z.string().trim().min(1).max(120) })
  .strict();
export const SendAgentChatTurn = z
  .object({
    input: z.string().trim().min(1).max(8192),
    expectedRevision: Revision,
    toolGrant: AgentTaskToolSelection.optional(),
  })
  .strict();
export const ResolveAgentProposal = z
  .object({ decision: z.enum(["approve", "reject"]), expectedHash: Hash })
  .strict();
export const AgentConversation = z
  .object({
    id: Id,
    profileId: Id,
    projectId: Id,
    environmentId: Id,
    profileRevision: Revision,
    profileHash: Hash,
    title: z.string().max(120),
    revision: Revision,
    cursor: Revision,
    createdAt: Moment,
    updatedAt: Moment,
  })
  .strict();
export const AgentChatTurn = z
  .object({
    id: Id,
    conversationId: Id,
    sequence: Revision,
    task: AgentTask,
    partialText: z.string().max(32768),
    omittedTurns: Revision,
  })
  .strict();
export const AgentChatArtifact = z
  .object({
    id: Id,
    conversationId: Id,
    turnId: Id,
    taskId: Id,
    name: z.string().max(120),
    mediaType: z.enum(["text/plain", "text/markdown", "application/json", "text/x-patch"]),
    content: z.string().max(16384),
    sha256: Hash,
    bytes: Revision,
    createdAt: Moment,
  })
  .strict();
export const AgentChatProposal = z
  .object({
    id: Id,
    conversationId: Id,
    turnId: Id,
    taskId: Id,
    planId: Id,
    expectedHash: Hash,
    projectId: Id,
    environmentId: Id,
    targetId: Id,
    expectedRevision: Revision,
    command: z.string().max(4096),
    reason: z.string().max(512),
    status: z.enum(["pending", "approved", "rejected", "expired", "stale"]),
    createdAt: Moment,
    expiresAt: Moment,
    resolvedAt: Moment.nullable(),
  })
  .strict();
export const AgentChatEvent = z
  .object({
    conversationId: Id,
    cursor: Revision,
    turnId: Id.nullable(),
    type: z.enum([
      "turn.created",
      "task.state",
      "text.delta",
      "output.created",
      "proposal.resolved",
    ]),
    text: z.string().max(4096).nullable(),
    state: z.string().max(40).nullable(),
    occurredAt: Moment,
  })
  .strict();
export const AgentConversationList = z
  .object({ conversations: z.array(AgentConversation).max(64) })
  .strict();
export const AgentConversationDetail = z
  .object({
    conversation: AgentConversation,
    turns: z.array(AgentChatTurn).max(100),
    artifacts: z.array(AgentChatArtifact).max(800),
    proposals: z.array(AgentChatProposal).max(800),
  })
  .strict();
export const AgentChatEvents = z
  .object({ reset: z.boolean(), cursor: Revision, events: z.array(AgentChatEvent).max(256) })
  .strict();
export type AgentConversationView = z.infer<typeof AgentConversation>;
export type AgentConversationDetailView = z.infer<typeof AgentConversationDetail>;
export type AgentChatArtifactView = z.infer<typeof AgentChatArtifact>;
export type AgentChatProposalView = z.infer<typeof AgentChatProposal>;
export type AgentChatEventView = z.infer<typeof AgentChatEvent>;
export type AgentChatEventsView = z.infer<typeof AgentChatEvents>;
export type CreateAgentConversationInput = z.infer<typeof CreateAgentConversation>;
export type SendAgentChatTurnInput = z.infer<typeof SendAgentChatTurn>;
export type ResolveAgentProposalInput = z.infer<typeof ResolveAgentProposal>;
