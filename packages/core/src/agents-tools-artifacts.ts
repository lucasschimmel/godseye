import { randomUUID } from "node:crypto";
import { AgentChatArtifact, AgentToolObservation } from "@godseye/contracts";
import { type DatabaseAccess, schema } from "@godseye/store";
import { asc, eq } from "drizzle-orm";
import { chatEvent } from "./agents-chat-state.js";
import type { AgentState, TaskRow } from "./agents-state.js";
import { DomainError } from "./errors.js";
import { fingerprint } from "./journal.js";

/** Actual tool bytes use the existing immutable owner artifact journal and download path. */
export async function taskToolArtifacts(state: AgentState, tx: DatabaseAccess, task: TaskRow) {
  if (!task.toolGrant || task.cancelRequested || task.state !== "succeeded") return;
  const [turn] = await tx
    .select()
    .from(schema.agentChatTurns)
    .where(eq(schema.agentChatTurns.taskId, task.id));
  if (!turn) return;
  const existing = await tx
    .select({ id: schema.agentChatArtifacts.id })
    .from(schema.agentChatArtifacts)
    .where(eq(schema.agentChatArtifacts.taskId, task.id));
  const remaining = Math.max(0, 8 - existing.length);
  const calls = await tx
    .select()
    .from(schema.agentToolCalls)
    .where(eq(schema.agentToolCalls.taskId, task.id))
    .orderBy(asc(schema.agentToolCalls.sequence));
  const files = new Map<string, { contentUtf8: string; bytes: number; sha256: string }>();
  for (const call of calls) {
    if (call.state !== "succeeded" || !call.observation) continue;
    if (call.resultHash !== fingerprint(call.observation))
      throw new DomainError("JOURNAL_INCONSISTENT", "Tool artifact journal integrity failed", 500);
    for (const artifact of AgentToolObservation.parse(call.observation).artifacts)
      files.set(artifact.path, artifact);
  }
  for (const [path, file] of [...files].slice(0, remaining)) {
    const id = randomUUID();
    const data = AgentChatArtifact.parse({
      id,
      conversationId: turn.conversationId,
      turnId: turn.id,
      taskId: task.id,
      name: `tool-${id}-${path.split("/").at(-1)}`.slice(0, 120),
      mediaType: "text/plain",
      content: file.contentUtf8,
      bytes: file.bytes,
      sha256: file.sha256,
      createdAt: state.now().toISOString(),
    });
    await tx
      .insert(schema.agentChatArtifacts)
      .values({ id, conversationId: turn.conversationId, taskId: task.id, data });
    await chatEvent(state, tx, turn.conversationId, turn.id, "output.created");
  }
}
