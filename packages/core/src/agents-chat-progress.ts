import type { ExecutionContext } from "@godseye/contracts";
import { schema } from "@godseye/store";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { chatEvent } from "./agents-chat-state.js";
import {
  AGENT_DESTINATION,
  AGENT_TOOL,
  type AgentState,
  currentProfile,
  profileFor,
  providerRequest,
  type TaskRow,
  taskFor,
} from "./agents-state.js";
import { DomainError } from "./errors.js";
import { runFor, validateLease } from "./foundation-data.js";
import { write } from "./journal.js";

const Delta = z
  .object({
    type: z.literal("text.delta"),
    sequence: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
    providerRunId: z.string().min(1).max(128),
    text: z.string().max(4096),
  })
  .strict();
export async function chatProgress(
  state: AgentState,
  context: ExecutionContext,
  taskId: string,
  raw: unknown,
  signal: AbortSignal,
) {
  const delta = Delta.parse(raw);
  if (Buffer.byteLength(delta.text, "utf8") > 4096)
    throw new DomainError("PROVIDER_REJECTED", "Progress frame too large", 502);
  await write(state.store, async (tx) => {
    await validateLease(state.request, tx, context);
    await state.foundation.assertDispatch(tx, context, {
      actorId: context.workerId,
      tool: AGENT_TOOL,
      destination: AGENT_DESTINATION,
      costMicros: 0,
    });
    const task = await taskFor(tx, taskId);
    const profile = await profileFor(tx, task.profileId);
    await currentProfile(state, tx, profile);
    const retained = await runFor(tx, context.runId);
    if (
      signal.aborted ||
      task.cancelRequested ||
      task.runId !== context.runId ||
      task.state !== "running" ||
      profile.hash !== task.profileSnapshot.hash ||
      !retained.run.leaseExpiresAt ||
      retained.run.leaseExpiresAt <= state.now()
    )
      throw new DomainError("FENCED", "Progress authority was revoked", 409);
    if (task.providerRunId && task.providerRunId !== delta.providerRunId)
      throw new DomainError("FENCED", "Progress provider identity changed", 409);
    const [turn] = await tx
      .select()
      .from(schema.agentChatTurns)
      .where(eq(schema.agentChatTurns.taskId, taskId));
    if (!turn) return;
    if (delta.sequence <= turn.vendorSequence) return;
    const partialText = turn.partialText + delta.text;
    if (Buffer.byteLength(partialText, "utf8") > 32768)
      throw new DomainError("PROVIDER_REJECTED", "Progress output too large", 502);
    await validateLease(state.request, tx, context);
    await state.foundation.assertDispatch(tx, context, {
      actorId: context.workerId,
      tool: AGENT_TOOL,
      destination: AGENT_DESTINATION,
      costMicros: 0,
    });
    if (signal.aborted) throw new DomainError("FENCED", "Progress was cancelled", 409);
    await tx
      .update(schema.agentTasks)
      .set({ providerRunId: delta.providerRunId })
      .where(eq(schema.agentTasks.id, taskId));
    await tx
      .update(schema.agentChatTurns)
      .set({ partialText, vendorSequence: delta.sequence })
      .where(eq(schema.agentChatTurns.id, turn.id));
    await chatEvent(state, tx, turn.conversationId, turn.id, "text.delta", delta.text);
  });
}
export async function chatRequest(state: AgentState, taskId: string) {
  const [turn] = await state.store.db
    .select()
    .from(schema.agentChatTurns)
    .where(eq(schema.agentChatTurns.taskId, taskId));
  return turn ? { id: turn.conversationId, history: turn.history } : undefined;
}

export async function chatProviderRequest(state: AgentState, task: TaskRow) {
  const conversation = await chatRequest(state, task.id);
  return { ...providerRequest(task), ...(conversation ? { conversation } : {}) };
}
