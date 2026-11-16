import { randomUUID } from "node:crypto";
import {
  AGENT_CHAT_LIMITS,
  AgentChatEvents,
  type AgentChatEventView,
  AgentConversation,
} from "@godseye/contracts";
import { type DatabaseAccess, schema } from "@godseye/store";
import { and, asc, eq, gt, sql } from "drizzle-orm";
import { type AgentState, currentProfile, profileFor, taskFor } from "./agents-state.js";
import { DomainError } from "./errors.js";
import { write } from "./journal.js";
import { type Actor, assertOwner } from "./policy.js";
export type ConversationRow = typeof schema.agentConversations.$inferSelect;
export function conversationView(row: ConversationRow) {
  return AgentConversation.parse({
    ...row,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  });
}
export async function conversationFor(
  state: AgentState,
  tx: DatabaseAccess,
  actor: Actor,
  id: string,
  requireActive = false,
) {
  assertOwner(actor);
  const [row] = await tx
    .select()
    .from(schema.agentConversations)
    .where(eq(schema.agentConversations.id, id));
  if (!row) throw new DomainError("NOT_FOUND", "Conversation not found", 404);
  if (!requireActive) return row;
  const profile = await profileFor(tx, row.profileId);
  await currentProfile(state, tx, profile);
  if (profile.hash !== row.profileHash || profile.revision !== row.profileRevision)
    throw new DomainError("AGENT_PROFILE_STALE", "Conversation profile changed", 409);
  return row;
}
export async function chatEvent(
  state: AgentState,
  tx: DatabaseAccess,
  conversationId: string,
  turnId: string | null,
  type: AgentChatEventView["type"],
  text: string | null = null,
  status: string | null = null,
) {
  const [row] = await tx
    .select()
    .from(schema.agentConversations)
    .where(eq(schema.agentConversations.id, conversationId));
  if (!row) throw new DomainError("NOT_FOUND", "Conversation not found", 404);
  const cursor = row.cursor + 1;
  await tx
    .update(schema.agentConversations)
    .set({ cursor, updatedAt: state.now() })
    .where(eq(schema.agentConversations.id, conversationId));
  await tx.insert(schema.agentChatEvents).values({
    id: randomUUID(),
    conversationId,
    cursor,
    turnId,
    type,
    text,
    state: status,
    occurredAt: state.now(),
  });
  await tx
    .delete(schema.agentChatEvents)
    .where(
      and(
        eq(schema.agentChatEvents.conversationId, conversationId),
        sql`${schema.agentChatEvents.cursor} <= ${cursor - AGENT_CHAT_LIMITS.events}`,
      ),
    );
}
export async function chatTaskEvent(
  state: AgentState,
  tx: DatabaseAccess,
  taskId: string,
  status: string,
) {
  const [turn] = await tx
    .select()
    .from(schema.agentChatTurns)
    .where(eq(schema.agentChatTurns.taskId, taskId));
  if (turn) await chatEvent(state, tx, turn.conversationId, turn.id, "task.state", null, status);
}
export async function chatHistory(tx: DatabaseAccess, conversationId: string) {
  const turns = await tx
    .select()
    .from(schema.agentChatTurns)
    .where(eq(schema.agentChatTurns.conversationId, conversationId))
    .orderBy(asc(schema.agentChatTurns.sequence));
  const pairs: { role: "user" | "assistant"; content: string }[][] = [];
  for (const turn of turns) {
    const task = await taskFor(tx, turn.taskId);
    if (
      task.state === "succeeded" &&
      task.finishedAt !== null &&
      !task.cancelRequested &&
      task.output !== null
    )
      pairs.push([
        { role: "user", content: task.input },
        { role: "assistant", content: task.output },
      ]);
  }
  const history: { role: "user" | "assistant"; content: string }[] = [];
  let used = 0;
  for (const pair of pairs.slice().reverse()) {
    const bytes = pair.reduce((n, m) => n + Buffer.byteLength(m.content, "utf8"), 0);
    if (
      history.length + 2 > AGENT_CHAT_LIMITS.historyMessages ||
      used + bytes > AGENT_CHAT_LIMITS.historyBytes
    )
      break;
    history.unshift(...pair);
    used += bytes;
  }
  return { history, omittedTurns: turns.length - history.length / 2 };
}
export async function readChatEvents(state: AgentState, actor: Actor, id: string, after: number) {
  if (!Number.isSafeInteger(after) || after < 0)
    throw new DomainError("INVALID_INPUT", "Invalid chat cursor", 422);
  return write(state.store, async (tx) => {
    const row = await conversationFor(state, tx, actor, id);
    const reset = after > row.cursor || after < Math.max(0, row.cursor - AGENT_CHAT_LIMITS.events);
    const rows = reset
      ? []
      : await tx
          .select()
          .from(schema.agentChatEvents)
          .where(
            and(
              eq(schema.agentChatEvents.conversationId, id),
              gt(schema.agentChatEvents.cursor, after),
            ),
          )
          .orderBy(asc(schema.agentChatEvents.cursor))
          .limit(AGENT_CHAT_LIMITS.events);
    return AgentChatEvents.parse({
      reset,
      cursor: row.cursor,
      events: rows.map(({ id: _id, ...event }) => ({
        ...event,
        occurredAt: event.occurredAt.toISOString(),
      })),
    });
  });
}
