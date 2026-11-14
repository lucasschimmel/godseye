import { createHash, randomUUID } from "node:crypto";
import {
  AGENT_CHAT_LIMITS,
  AgentChatArtifact,
  AgentChatProposal,
  ResolveAgentProposal,
} from "@godseye/contracts";
import { type DatabaseAccess, schema } from "@godseye/store";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { chatEvent, conversationFor } from "./agents-chat-state.js";
import {
  type AgentState,
  currentProfile,
  profileFor,
  type TaskRow,
  taskFor,
} from "./agents-state.js";
import { DomainError, parseInput } from "./errors.js";
import { currentEpoch, planFor, recordRequest, requestFor, runFor } from "./foundation-data.js";
import { appendAudit, write } from "./journal.js";
import { type Actor, assertOwner } from "./policy.js";

const Output = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("artifact"),
      name: z
        .string()
        .min(1)
        .max(120)
        .regex(/^[A-Za-z0-9][A-Za-z0-9 ._-]*$/)
        .refine((name) => !name.includes("..")),
      mediaType: AgentChatArtifact.shape.mediaType,
      content: z.string().max(AGENT_CHAT_LIMITS.artifactBytes),
    })
    .strict(),
  z
    .object({
      type: z.literal("approval"),
      planId: z.string().uuid(),
      expectedHash: z.string().regex(/^[a-f0-9]{64}$/),
      reason: z.string().min(1).max(512),
    })
    .strict(),
]);
/** The bounded parser and inserts share one transaction so partial extraction cannot survive rollback. */
export async function chatOutputs(state: AgentState, tx: DatabaseAccess, task: TaskRow) {
  if (task.state !== "succeeded" || task.cancelRequested || task.output === null) return;
  const [turn] = await tx
    .select()
    .from(schema.agentChatTurns)
    .where(eq(schema.agentChatTurns.taskId, task.id));
  if (!turn) return;
  const artifacts = await tx
    .select()
    .from(schema.agentChatArtifacts)
    .where(eq(schema.agentChatArtifacts.taskId, task.id));
  const proposals = await tx
    .select()
    .from(schema.agentChatProposals)
    .where(eq(schema.agentChatProposals.taskId, task.id));
  if (artifacts.length || proposals.length) return;
  const blocks = [...task.output.matchAll(/^```godseye-output-v1\r?\n([\s\S]*?)\r?\n```[ \t]*$/gm)];
  if (blocks.length > AGENT_CHAT_LIMITS.outputs) return;
  const seen = new Set<string>();
  for (const match of blocks) {
    let decoded: unknown;
    try {
      decoded = JSON.parse(match[1] ?? "");
    } catch {
      continue;
    }
    const parsed = Output.safeParse(decoded);
    if (!parsed.success) continue;
    const block = parsed.data;
    const identity = JSON.stringify(block);
    if (seen.has(identity)) continue;
    seen.add(identity);
    const id = randomUUID();
    const createdAt = state.now().toISOString();
    const base = {
      id,
      conversationId: turn.conversationId,
      turnId: turn.id,
      taskId: task.id,
      createdAt,
    };
    if (block.type === "artifact") {
      const bytes = Buffer.byteLength(block.content, "utf8");
      if (bytes > AGENT_CHAT_LIMITS.artifactBytes) continue;
      const extension = {
        "text/plain": "txt",
        "text/markdown": "md",
        "application/json": "json",
        "text/x-patch": "patch",
      }[block.mediaType];
      const data = AgentChatArtifact.parse({
        ...base,
        name: `draft-${id}.${extension}`,
        mediaType: block.mediaType,
        content: block.content,
        bytes,
        sha256: createHash("sha256").update(block.content, "utf8").digest("hex"),
      });
      await tx
        .insert(schema.agentChatArtifacts)
        .values({ id, conversationId: turn.conversationId, taskId: task.id, data });
    } else {
      const [plan] = await tx
        .select()
        .from(schema.executionPlans)
        .where(eq(schema.executionPlans.id, block.planId));
      if (
        !plan?.requiresApproval ||
        plan.projectId !== task.projectId ||
        plan.environmentId !== task.environmentId ||
        plan.hash !== block.expectedHash
      )
        continue;
      const parsedProposal = AgentChatProposal.safeParse({
        ...base,
        planId: plan.id,
        expectedHash: plan.hash,
        projectId: plan.projectId,
        environmentId: plan.environmentId,
        targetId: plan.targetId,
        expectedRevision: plan.expectedRevision,
        command: JSON.stringify(plan.command),
        reason: block.reason,
        status: "pending",
        expiresAt: new Date(state.now().getTime() + AGENT_CHAT_LIMITS.proposalMs).toISOString(),
        resolvedAt: null,
      });
      if (!parsedProposal.success) continue;
      await tx.insert(schema.agentChatProposals).values({
        id,
        conversationId: turn.conversationId,
        taskId: task.id,
        data: parsedProposal.data,
      });
    }
    await appendAudit(
      tx,
      { id: "hermes-output-broker", kind: "service", projectIds: [task.projectId] },
      task.projectId,
      "agent.output.created",
      `Stored ${block.type} ${id} from task ${task.id}`,
    );
    await chatEvent(state, tx, turn.conversationId, turn.id, "output.created");
  }
}
export function artifactView(row: typeof schema.agentChatArtifacts.$inferSelect) {
  const artifact = AgentChatArtifact.parse(row.data);
  if (
    artifact.id !== row.id ||
    artifact.conversationId !== row.conversationId ||
    artifact.taskId !== row.taskId ||
    artifact.bytes !== Buffer.byteLength(artifact.content, "utf8") ||
    artifact.sha256 !== createHash("sha256").update(artifact.content, "utf8").digest("hex")
  )
    throw new DomainError("JOURNAL_INCONSISTENT", "Artifact integrity failed", 500);
  return artifact;
}
export async function proposalView(
  state: AgentState,
  tx: DatabaseAccess,
  row: typeof schema.agentChatProposals.$inferSelect,
  actor: Actor,
) {
  const proposal = AgentChatProposal.parse(row.data);
  if (proposal.status !== "pending") return proposal;
  const [plan] = await tx
    .select()
    .from(schema.executionPlans)
    .where(eq(schema.executionPlans.id, proposal.planId));
  const [project] = await tx
    .select()
    .from(schema.projects)
    .where(eq(schema.projects.id, proposal.projectId));
  let sourceCurrent = true;
  try {
    const conversation = await conversationFor(state, tx, actor, row.conversationId, true);
    const source = await taskFor(tx, proposal.taskId);
    const execution = source.runId ? await runFor(tx, source.runId) : null;
    sourceCurrent =
      source.state === "succeeded" &&
      !source.cancelRequested &&
      source.profileSnapshot.hash === conversation.profileHash &&
      execution !== null &&
      execution.run.epoch === (await currentEpoch(tx, conversation.environmentId));
  } catch (error) {
    if (!(error instanceof DomainError)) throw error;
    sourceCurrent = false;
  }
  const status =
    new Date(proposal.expiresAt) <= state.now()
      ? "expired"
      : !sourceCurrent ||
          !plan ||
          plan.hash !== proposal.expectedHash ||
          plan.projectId !== proposal.projectId ||
          plan.environmentId !== proposal.environmentId ||
          plan.expectedRevision !== project?.revision ||
          plan.targetId !== proposal.targetId ||
          JSON.stringify(plan.command) !== proposal.command
        ? "stale"
        : "pending";
  return AgentChatProposal.parse({ ...proposal, status });
}
export async function chatArtifact(state: AgentState, actor: Actor, id: string) {
  assertOwner(actor);
  const [row] = await state.store.db
    .select()
    .from(schema.agentChatArtifacts)
    .where(eq(schema.agentChatArtifacts.id, id));
  if (!row) throw new DomainError("NOT_FOUND", "Artifact not found", 404);
  await conversationFor(state, state.store.db, actor, row.conversationId);
  return artifactView(row);
}
/** Validation and the real Foundation approval stay in one transaction, including receipt and decision. */
export async function chatResolve(
  state: AgentState,
  actor: Actor,
  id: string,
  raw: unknown,
  key: string,
) {
  assertOwner(actor);
  const input = parseInput(ResolveAgentProposal, raw);
  if (input.decision === "approve") state.foundation.assertFreshOwner(actor);
  return write(state.store, async (tx) => {
    const [row] = await tx
      .select()
      .from(schema.agentChatProposals)
      .where(eq(schema.agentChatProposals.id, id));
    if (!row) throw new DomainError("NOT_FOUND", "Proposal not found", 404);
    const [storedConversation] = await tx
      .select()
      .from(schema.agentConversations)
      .where(eq(schema.agentConversations.id, row.conversationId));
    if (!storedConversation)
      throw new DomainError("JOURNAL_INCONSISTENT", "Proposal conversation missing", 500);
    const conversation =
      input.decision === "approve"
        ? await conversationFor(state, tx, actor, row.conversationId, true)
        : storedConversation;
    const proposal = AgentChatProposal.parse(row.data);
    const receipt = await requestFor(tx, actor, key, "chat.resolve", { id, ...input });
    if (receipt.existing) return proposal;
    if (
      proposal.id !== id ||
      proposal.conversationId !== row.conversationId ||
      proposal.taskId !== row.taskId ||
      proposal.projectId !== conversation.projectId ||
      proposal.environmentId !== conversation.environmentId
    )
      throw new DomainError("JOURNAL_INCONSISTENT", "Proposal scope is inconsistent", 500);
    if (proposal.status !== "pending")
      throw new DomainError("INVALID_TRANSITION", "Proposal already resolved", 409);
    if (proposal.expectedHash !== input.expectedHash)
      throw new DomainError("APPROVAL_MISMATCH", "Proposal hash changed", 409);
    if (input.decision === "approve" && new Date(proposal.expiresAt) <= state.now())
      throw new DomainError("PROPOSAL_EXPIRED", "Proposal expired", 409);
    if (input.decision === "approve") {
      const sourceTask = await taskFor(tx, proposal.taskId);
      const sourceRun = sourceTask.runId ? await runFor(tx, sourceTask.runId) : null;
      if (
        sourceTask.state !== "succeeded" ||
        sourceTask.cancelRequested ||
        sourceTask.profileSnapshot.hash !== conversation.profileHash ||
        !sourceRun ||
        sourceRun.run.epoch !== (await currentEpoch(tx, conversation.environmentId))
      )
        throw new DomainError("PROPOSAL_STALE", "Proposal source authority changed", 409);
      const profile = await profileFor(tx, conversation.profileId);
      await currentProfile(state, tx, profile);
      const plan = await planFor(tx, actor, proposal.planId);
      const [project] = await tx
        .select()
        .from(schema.projects)
        .where(eq(schema.projects.id, conversation.projectId));
      if (
        plan.hash !== proposal.expectedHash ||
        plan.projectId !== conversation.projectId ||
        plan.environmentId !== conversation.environmentId ||
        plan.targetId !== proposal.targetId ||
        plan.expectedRevision !== proposal.expectedRevision ||
        JSON.stringify(plan.command) !== proposal.command ||
        project?.revision !== plan.expectedRevision
      )
        throw new DomainError("PROPOSAL_STALE", "Proposal target changed", 409);
      if (input.decision === "approve")
        await state.foundation.approveInTransaction(
          tx,
          actor,
          plan.id,
          plan.hash,
          `chat-approve:${id}`,
        );
    }
    if (input.decision === "approve") {
      state.foundation.assertFreshOwner(actor);
      if (new Date(proposal.expiresAt) <= state.now())
        throw new DomainError("PROPOSAL_EXPIRED", "Proposal expired during decision", 409);
    }
    const data = AgentChatProposal.parse({
      ...proposal,
      status: input.decision === "approve" ? "approved" : "rejected",
      resolvedAt: state.now().toISOString(),
    });
    await tx
      .update(schema.agentChatProposals)
      .set({ data })
      .where(eq(schema.agentChatProposals.id, id));
    await recordRequest(tx, state.request, key, receipt.digest, id, "chat.resolve");
    await appendAudit(
      tx,
      actor,
      conversation.projectId,
      "agent.proposal.resolved",
      `Resolved proposal ${id}: ${data.status}`,
    );
    await chatEvent(state, tx, row.conversationId, proposal.turnId, "proposal.resolved");
    return data;
  });
}
