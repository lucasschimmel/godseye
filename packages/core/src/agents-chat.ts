import { randomUUID } from "node:crypto";
import {
  AGENT_CHAT_LIMITS,
  AgentConversationDetail,
  AgentConversationList,
  CreateAgentConversation,
  SendAgentChatTurn,
} from "@godseye/contracts";
import { schema } from "@godseye/store";
import { asc, desc, eq } from "drizzle-orm";
import { artifactView, proposalView } from "./agents-chat-outputs.js";
import { chatEvent, chatHistory, conversationFor, conversationView } from "./agents-chat-state.js";
import { launchAgentTask } from "./agents-runs.js";
import { type AgentState, currentProfile, profileFor, taskFor, taskView } from "./agents-state.js";
import { DomainError, parseInput } from "./errors.js";
import { recordRequest, requestFor } from "./foundation-data.js";
import { appendAudit, fingerprint, write } from "./journal.js";
import { type Actor, assertOwner } from "./policy.js";
export async function chatList(state: AgentState, actor: Actor) {
  assertOwner(actor);
  const rows = await state.store.db
    .select()
    .from(schema.agentConversations)
    .orderBy(desc(schema.agentConversations.updatedAt))
    .limit(AGENT_CHAT_LIMITS.conversations);
  return AgentConversationList.parse({ conversations: rows.map(conversationView) });
}
export async function chatCreate(state: AgentState, actor: Actor, raw: unknown, key: string) {
  assertOwner(actor);
  const input = parseInput(CreateAgentConversation, raw);
  const id = await write(state.store, async (tx) => {
    const receipt = await requestFor(tx, actor, key, "chat.create", input);
    if (receipt.existing) return receipt.existing.resourceId;
    const profile = await profileFor(tx, input.profileId);
    await currentProfile(state, tx, profile);
    if (profile.revision !== input.expectedRevision)
      throw new DomainError("REVISION_CONFLICT", "Agent profile changed", 409);
    const rows = await tx
      .select({ id: schema.agentConversations.id })
      .from(schema.agentConversations)
      .limit(AGENT_CHAT_LIMITS.conversations);
    if (rows.length >= AGENT_CHAT_LIMITS.conversations)
      throw new DomainError("CHAT_LIMIT", "Conversation capacity exceeded", 409);
    const id = randomUUID();
    await tx.insert(schema.agentConversations).values({
      id,
      profileId: profile.id,
      projectId: profile.projectId,
      environmentId: profile.environmentId,
      profileRevision: profile.revision,
      profileHash: profile.hash,
      title: input.title,
      revision: 0,
      cursor: 0,
      createdAt: state.now(),
      updatedAt: state.now(),
    });
    await recordRequest(tx, state.request, key, receipt.digest, id, "chat.create");
    await appendAudit(
      tx,
      actor,
      profile.projectId,
      "agent.conversation.created",
      `Created scoped conversation ${id} for profile ${profile.id}`,
    );
    return id;
  });
  return chatDetail(state, actor, id);
}
export async function chatDetail(state: AgentState, actor: Actor, id: string) {
  return write(state.store, async (tx) => {
    const conversation = await conversationFor(state, tx, actor, id);
    const rows = await tx
      .select()
      .from(schema.agentChatTurns)
      .where(eq(schema.agentChatTurns.conversationId, id))
      .orderBy(asc(schema.agentChatTurns.sequence));
    const turns = [];
    for (const row of rows)
      turns.push({
        id: row.id,
        conversationId: id,
        sequence: row.sequence,
        task: taskView(await taskFor(tx, row.taskId)),
        partialText: row.partialText,
        omittedTurns: row.omittedTurns,
      });
    const artifacts = await tx
      .select()
      .from(schema.agentChatArtifacts)
      .where(eq(schema.agentChatArtifacts.conversationId, id));
    const proposals = await tx
      .select()
      .from(schema.agentChatProposals)
      .where(eq(schema.agentChatProposals.conversationId, id));
    return AgentConversationDetail.parse({
      conversation: conversationView(conversation),
      turns,
      artifacts: artifacts.map(artifactView),
      proposals: await Promise.all(proposals.map((row) => proposalView(state, tx, row, actor))),
    });
  });
}
/** Kept together to make replay and the atomic turn/task staging boundary reviewable. */
export async function chatSend(
  state: AgentState,
  actor: Actor,
  id: string,
  raw: unknown,
  key: string,
) {
  assertOwner(actor);
  const input = parseInput(SendAgentChatTurn, raw);
  const existing = await write(state.store, async (tx) => {
    await conversationFor(state, tx, actor, id, true);
    const receipt = await requestFor(tx, actor, key, "chat.send", { id, ...input });
    if (!receipt.existing) return null;
    const [turn] = await tx
      .select()
      .from(schema.agentChatTurns)
      .where(eq(schema.agentChatTurns.id, receipt.existing.resourceId));
    if (!turn)
      throw new DomainError("JOURNAL_INCONSISTENT", "Conversation receipt is inconsistent", 500);
    return turn;
  });
  if (existing) {
    const task = await taskFor(state.store.db, existing.taskId);
    await launchAgentTask(
      state,
      actor,
      { profileId: task.profileId, expectedRevision: task.profileRevision, input: task.input },
      `chat-task:${task.id}`,
      undefined,
      task.id,
    );
    return chatDetail(state, actor, id);
  }
  const conversation = await conversationFor(state, state.store.db, actor, id, true);
  await launchAgentTask(
    state,
    actor,
    {
      profileId: conversation.profileId,
      expectedRevision: conversation.profileRevision,
      input: input.input,
      ...(input.toolGrant ? { toolGrant: input.toolGrant } : {}),
    },
    `chat-task:${fingerprint({ key })}`,
    async (tx, task) => {
      const latest = await conversationFor(state, tx, actor, id, true);
      const receipt = await requestFor(tx, actor, key, "chat.send", { id, ...input });
      if (receipt.existing) throw new DomainError("REVISION_CONFLICT", "Turn already exists", 409);
      if (latest.revision !== input.expectedRevision)
        throw new DomainError("REVISION_CONFLICT", "Conversation changed", 409);
      if (latest.revision >= AGENT_CHAT_LIMITS.turns)
        throw new DomainError("CHAT_LIMIT", "Turn capacity exceeded", 409);
      const context = await chatHistory(tx, id);
      const turnId = randomUUID();
      await tx.insert(schema.agentChatTurns).values({
        id: turnId,
        conversationId: id,
        taskId: task.id,
        sequence: latest.revision + 1,
        partialText: "",
        vendorSequence: -1,
        ...context,
      });
      await tx
        .update(schema.agentConversations)
        .set({ revision: latest.revision + 1, updatedAt: state.now() })
        .where(eq(schema.agentConversations.id, id));
      await recordRequest(tx, state.request, key, receipt.digest, turnId, "chat.send");
      await appendAudit(
        tx,
        actor,
        task.projectId,
        "agent.turn.created",
        `Created turn ${turnId} linking task ${task.id}`,
      );
      await chatEvent(state, tx, id, turnId, "turn.created");
    },
  );
  return chatDetail(state, actor, id);
}
