import type { AgentChatArtifactView, AgentChatProposalView } from "@godseye/contracts";
import {
  bigint,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
export const agentConversations = pgTable("agent_conversations", {
  id: uuid("id").primaryKey(),
  profileId: uuid("profile_id").notNull(),
  projectId: uuid("project_id").notNull(),
  environmentId: uuid("environment_id").notNull(),
  profileRevision: integer("profile_revision").notNull(),
  profileHash: text("profile_hash").notNull(),
  title: text("title").notNull(),
  revision: integer("revision").notNull(),
  cursor: integer("cursor").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
});
export const agentChatTurns = pgTable(
  "agent_chat_turns",
  {
    id: uuid("id").primaryKey(),
    conversationId: uuid("conversation_id").notNull(),
    sequence: integer("sequence").notNull(),
    taskId: uuid("task_id").notNull(),
    partialText: text("partial_text").notNull(),
    vendorSequence: bigint("vendor_sequence", { mode: "number" }).notNull(),
    history: jsonb("history").$type<{ role: "user" | "assistant"; content: string }[]>().notNull(),
    omittedTurns: integer("omitted_turns").notNull(),
  },
  (t) => [
    unique("agent_chat_turn_sequence").on(t.conversationId, t.sequence),
    unique("agent_chat_turn_task").on(t.taskId),
  ],
);
export const agentChatEvents = pgTable(
  "agent_chat_events",
  {
    id: uuid("id").primaryKey(),
    conversationId: uuid("conversation_id").notNull(),
    cursor: integer("cursor").notNull(),
    turnId: uuid("turn_id"),
    type: text("type").notNull(),
    text: text("text"),
    state: text("state"),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
  },
  (t) => [unique("agent_chat_event_cursor").on(t.conversationId, t.cursor)],
);
export const agentChatArtifacts = pgTable("agent_chat_artifacts", {
  id: uuid("id").primaryKey(),
  conversationId: uuid("conversation_id").notNull(),
  taskId: uuid("task_id").notNull(),
  data: jsonb("data").$type<AgentChatArtifactView>().notNull(),
});
export const agentChatProposals = pgTable("agent_chat_proposals", {
  id: uuid("id").primaryKey(),
  conversationId: uuid("conversation_id").notNull(),
  taskId: uuid("task_id").notNull(),
  data: jsonb("data").$type<AgentChatProposalView>().notNull(),
});
