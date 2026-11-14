import { createHash, randomUUID } from "node:crypto";
import {
  AGENT_TOOL_DESTINATION,
  AgentToolArguments,
  AgentToolCall,
  AgentToolObservation,
  type ExecutionContext,
} from "@godseye/contracts";
import { type DatabaseAccess, schema } from "@godseye/store";
import { and, eq } from "drizzle-orm";
import { executionTask } from "./agents-execution.js";
import { type AgentState, currentProfile, profileFor, taskFor } from "./agents-state.js";
import { assertToolCommitFence } from "./agents-tools-fence.js";
import { allocationFor } from "./agents-tools-lifecycle.js";
import { DomainError } from "./errors.js";
import { appendAudit, fingerprint, write } from "./journal.js";

async function assertToolTransaction(
  state: AgentState,
  tx: DatabaseAccess,
  context: ExecutionContext,
  tool: import("@godseye/contracts").AgentToolName,
) {
  if (context.command.kind !== "agent.run")
    throw new DomainError("FENCED", "Invalid task command", 409);
  await state.foundation.assertDispatch(tx, context, {
    actorId: context.workerId,
    tool,
    destination: AGENT_TOOL_DESTINATION,
    costMicros: 0,
  });
  const task = await taskFor(tx, context.command.inputRef),
    profile = await profileFor(tx, task.profileId);
  await currentProfile(state, tx, profile);
  const [allocation] = await tx
    .select()
    .from(schema.agentToolAllocations)
    .where(eq(schema.agentToolAllocations.taskId, task.id));
  if (
    task.cancelRequested ||
    task.runId !== context.runId ||
    task.profileSnapshot.hash !== profile.hash ||
    !task.toolGrant?.policy.tools.includes(tool) ||
    allocation?.state !== "available" ||
    allocation.stopped ||
    allocation.requestHash !== fingerprint(allocation.request) ||
    allocation.request.policyHash !== fingerprint(task.toolGrant) ||
    allocation.request.profileHash !== profile.hash ||
    allocation.request.taskId !== task.id ||
    allocation.request.projectId !== task.projectId ||
    allocation.request.environmentId !== task.environmentId ||
    new Date(allocation.request.deadline) <= state.now()
  )
    throw new DomainError("FENCED", "Task tool authority changed before journal publication", 409);
  return allocation;
}

/** One immutable intent per native call; unknown outcomes are never physically replayed. */
export async function executeTaskTool(
  state: AgentState,
  context: ExecutionContext,
  raw: unknown,
  signal: AbortSignal,
  assertActive: () => Promise<void>,
): Promise<string> {
  const call = AgentToolCall.parse(raw);
  const args = AgentToolArguments[call.name].parse(call.arguments);
  const inputHash = fingerprint({ name: call.name, arguments: args });
  const assertToolActive = async () => {
    await assertActive();
    await write(state.store, async (tx) => {
      await assertToolTransaction(state, tx, context, call.name);
    });
    const active = await allocationFor(
      state,
      context.command.kind === "agent.run" ? context.command.inputRef : "",
    );
    if (
      active?.state !== "available" ||
      active.stopped ||
      new Date(active.request.deadline) <= state.now()
    )
      throw new DomainError("FENCED", "Task tool allocation expired or stopped", 409);
    await assertActive();
  };
  await assertToolActive();
  const task = await executionTask(state, context),
    allocation = await allocationFor(state, task.id);
  const grant = task.toolGrant;
  if (
    !grant?.policy.tools.includes(call.name) ||
    !allocation ||
    allocation.state !== "available" ||
    allocation.stopped ||
    allocation.request.policyHash !== fingerprint(grant) ||
    new Date(allocation.request.deadline) <= state.now() ||
    !state.toolExecutor?.qualified
  )
    throw new DomainError("FORBIDDEN", "Task does not authorize this isolated tool", 403);
  const retained = await write(state.store, async (tx) => {
    const currentAllocation = await assertToolTransaction(state, tx, context, call.name);
    const [existing] = await tx
      .select()
      .from(schema.agentToolCalls)
      .where(
        and(
          eq(schema.agentToolCalls.taskId, task.id),
          eq(schema.agentToolCalls.modelCallId, call.id),
        ),
      );
    if (existing) {
      if (existing.inputHash !== inputHash)
        throw new DomainError(
          "IDEMPOTENCY_CONFLICT",
          "Tool call identity has different arguments",
          409,
        );
      if (!["succeeded", "failed"].includes(existing.state) || !existing.observation)
        throw new DomainError("TOOL_EXECUTION_UNKNOWN", "Tool call requires reconciliation", 409);
      if (existing.resultHash !== fingerprint(existing.observation))
        throw new DomainError("JOURNAL_INCONSISTENT", "Tool result integrity failed", 500);
      const proven = AgentToolObservation.parse(existing.observation);
      if (
        existing.inputHash !==
          fingerprint({ name: existing.name, arguments: existing.arguments }) ||
        !currentAllocation.receipt ||
        fingerprint(proven.receipt) !== fingerprint(currentAllocation.receipt) ||
        existing.runId !== context.runId ||
        existing.epoch !== context.epoch
      )
        throw new DomainError("JOURNAL_INCONSISTENT", "Tool receipt identity failed", 500);
      await assertToolCommitFence(
        state,
        tx,
        context,
        call.name,
        currentAllocation.request.deadline,
        signal,
      );
      return existing;
    }
    const previous = await tx
      .select()
      .from(schema.agentToolCalls)
      .where(eq(schema.agentToolCalls.taskId, task.id));
    if (previous.some((item) => !["succeeded", "failed"].includes(item.state)))
      throw new DomainError(
        "TOOL_EXECUTION_UNKNOWN",
        "Another tool call still owns this workspace",
        409,
      );
    if (previous.length >= grant.policy.maxCalls)
      throw new DomainError("TOOL_BUDGET_EXCEEDED", "Task tool call budget is exhausted", 409);
    const [quota] = await tx
      .select()
      .from(schema.agentToolAllocations)
      .where(eq(schema.agentToolAllocations.taskId, task.id));
    const writeBytes =
      call.name === "godseye_workspace_write" && "content" in args
        ? Buffer.byteLength(args.content, "utf8")
        : 0;
    if (
      !quota ||
      quota.writeBytes + writeBytes > grant.policy.maxWriteBytes ||
      writeBytes > grant.policy.maxWorkspaceBytes ||
      quota.outputBytes >= grant.policy.maxOutputBytes
    )
      throw new DomainError("TOOL_BUDGET_EXCEEDED", "Task tool byte budget is exhausted", 409);
    const row = {
      id: randomUUID(),
      taskId: task.id,
      modelCallId: call.id,
      sequence: previous.length + 1,
      name: call.name,
      arguments: args,
      inputHash,
      state: "intended",
      runId: context.runId,
      grantId: context.grantId,
      epoch: context.epoch,
      fence: context.fence,
      observation: null,
      resultHash: null,
      createdAt: state.now(),
      updatedAt: state.now(),
    };
    await tx.insert(schema.agentToolCalls).values(row);
    await appendAudit(
      tx,
      { id: "hermes-tool-broker", kind: "service", projectIds: [task.projectId] },
      task.projectId,
      "agent.tool.intended",
      `Intended tool call ${row.id} for task ${task.id}`,
    );
    await assertToolCommitFence(
      state,
      tx,
      context,
      call.name,
      currentAllocation.request.deadline,
      signal,
    );
    return row;
  });
  if (retained.observation) {
    await assertToolActive();
    return retained.observation.result;
  }
  try {
    await assertToolActive();
    const observation = AgentToolObservation.parse(
      await state.toolExecutor.execute(
        {
          allocation: allocation.request,
          callId: retained.id,
          name: call.name,
          arguments: args,
          inputHash,
          sequence: retained.sequence,
        },
        { signal, assertActive: assertToolActive },
      ),
    );
    await assertToolActive();
    if (!allocation.receipt || fingerprint(observation.receipt) !== fingerprint(allocation.receipt))
      throw new DomainError("FENCED", "Tool allocation identity changed", 409);
    const artifactBytes = observation.artifacts.reduce((total, artifact) => {
      if (
        artifact.bytes !== Buffer.byteLength(artifact.contentUtf8, "utf8") ||
        artifact.sha256 !== createHash("sha256").update(artifact.contentUtf8, "utf8").digest("hex")
      )
        throw new DomainError("PROVIDER_REJECTED", "Tool artifact integrity failed", 502);
      return total + artifact.bytes;
    }, 0);
    const outputBytes = Buffer.byteLength(observation.result, "utf8") + artifactBytes;
    await write(state.store, async (tx) => {
      const publishing = await assertToolTransaction(state, tx, context, call.name);
      if (fingerprint(publishing.receipt) !== fingerprint(observation.receipt))
        throw new DomainError("FENCED", "Tool receipt changed before publication", 409);
      const [current] = await tx
        .select()
        .from(schema.agentToolAllocations)
        .where(eq(schema.agentToolAllocations.taskId, task.id));
      if (
        current?.state !== "available" ||
        current.stopped ||
        current.readBytes + observation.usage.readBytes > grant.policy.maxReadBytes ||
        current.writeBytes + observation.usage.writeBytes > grant.policy.maxWriteBytes ||
        observation.usage.workspaceBytes > grant.policy.maxWorkspaceBytes ||
        current.outputBytes + outputBytes > grant.policy.maxOutputBytes
      )
        throw new DomainError(
          "TOOL_BUDGET_EXCEEDED",
          "Tool result exceeds the immutable task budget",
          409,
        );
      await tx
        .update(schema.agentToolAllocations)
        .set({
          readBytes: current.readBytes + observation.usage.readBytes,
          writeBytes: current.writeBytes + observation.usage.writeBytes,
          outputBytes: current.outputBytes + outputBytes,
          updatedAt: state.now(),
        })
        .where(eq(schema.agentToolAllocations.taskId, task.id));
      await tx
        .update(schema.agentToolCalls)
        .set({
          state: observation.state,
          observation,
          resultHash: fingerprint(observation),
          updatedAt: state.now(),
        })
        .where(eq(schema.agentToolCalls.id, retained.id));
      await assertToolCommitFence(
        state,
        tx,
        context,
        call.name,
        publishing.request.deadline,
        signal,
      );
    });
    await assertToolActive();
    if (observation.state === "unknown")
      throw new DomainError(
        "TOOL_EXECUTION_UNKNOWN",
        "Tool execution requires reconciliation",
        409,
      );
    return observation.result;
  } catch (error) {
    await write(state.store, async (tx) => {
      await tx
        .update(schema.agentToolCalls)
        .set({ state: "unknown", updatedAt: state.now() })
        .where(eq(schema.agentToolCalls.id, retained.id));
    });
    throw error;
  }
}
