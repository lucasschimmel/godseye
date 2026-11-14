import { createHash } from "node:crypto";
import {
  AgentTaskToolsDetail,
  AgentToolAllocationObservation,
  AgentToolAllocationRequest,
  AgentToolCallView,
  AgentToolObservation,
  type ExecutionContext,
} from "@godseye/contracts";
import { schema } from "@godseye/store";
import { asc, eq } from "drizzle-orm";
import type { AgentState, TaskRow } from "./agents-state.js";
import { taskFor } from "./agents-state.js";
import { assertToolCommitFence } from "./agents-tools-fence.js";
import { DomainError } from "./errors.js";
import { fingerprint, write } from "./journal.js";
import { type Actor, assertOwner } from "./policy.js";

export async function allocationFor(state: AgentState, taskId: string) {
  const [allocation] = await state.store.db
    .select()
    .from(schema.agentToolAllocations)
    .where(eq(schema.agentToolAllocations.taskId, taskId));
  if (allocation && allocation.requestHash !== fingerprint(allocation.request))
    throw new DomainError("JOURNAL_INCONSISTENT", "Task workspace integrity failed", 500);
  if (allocation) AgentToolAllocationRequest.parse(allocation.request);
  return allocation;
}
export async function prepareTaskTools(
  state: AgentState,
  task: TaskRow,
  context: ExecutionContext,
  signal: AbortSignal,
  assertActive: () => Promise<void>,
) {
  if (!task.toolGrant) return;
  const admissionTool = task.toolGrant.policy.tools[0];
  if (!admissionTool) throw new DomainError("FORBIDDEN", "Task tool catalog is empty", 403);
  const executor = state.toolExecutor;
  if (!executor?.qualified || !executor.supports(task.toolGrant))
    throw new DomainError("CAPABILITY_UNAVAILABLE", "Isolated task tools are unavailable", 503);
  await assertActive();
  if (await allocationFor(state, task.id))
    throw new DomainError(
      "TOOL_EXECUTION_UNKNOWN",
      "Existing workspace requires reconciliation",
      409,
    );
  const request: AgentToolAllocationRequest = {
    taskId: task.id,
    projectId: task.projectId,
    environmentId: task.environmentId,
    profileHash: task.profileSnapshot.hash,
    policyHash: fingerprint(task.toolGrant),
    correlationId: task.id,
    deadline: new Date(
      Math.min(
        new Date(task.deadline ?? state.now()).getTime(),
        state.now().getTime() + task.toolGrant.policy.timeoutSeconds * 1000,
      ),
    ).toISOString(),
    grant: task.toolGrant,
  };
  await write(state.store, async (tx) => {
    await state.foundation.assertDispatch(tx, context, {
      actorId: context.workerId,
      tool: task.toolGrant?.policy.tools[0] ?? "",
      destination: "local.hermes-tools",
      costMicros: 0,
    });
    await tx.insert(schema.agentToolAllocations).values({
      taskId: task.id,
      request,
      requestHash: fingerprint(request),
      state: "intended",
      stopped: false,
      writeBytes:
        task.toolGrant?.workspace.files.reduce(
          (n, f) => n + Buffer.byteLength(f.content, "utf8"),
          0,
        ) ?? 0,
      createdAt: state.now(),
      updatedAt: state.now(),
    });
    await assertToolCommitFence(state, tx, context, admissionTool, request.deadline, signal);
  });
  const result = AgentToolAllocationObservation.parse(
    await executor.prepare(request, { signal, assertActive }),
  );
  await assertActive();
  if (
    result.state !== "available" ||
    result.stopped ||
    result.receipt?.profileHash !== request.profileHash
  )
    throw new DomainError(
      "CAPABILITY_UNAVAILABLE",
      "Isolated workspace preparation was not proven",
      503,
    );
  await write(state.store, async (tx) => {
    await state.foundation.assertDispatch(tx, context, {
      actorId: context.workerId,
      tool: task.toolGrant?.policy.tools[0] ?? "",
      destination: "local.hermes-tools",
      costMicros: 0,
    });
    await tx
      .update(schema.agentToolAllocations)
      .set({ state: "available", receipt: result.receipt, updatedAt: state.now() })
      .where(eq(schema.agentToolAllocations.taskId, task.id));
    await assertToolCommitFence(state, tx, context, admissionTool, request.deadline, signal);
  });
}
/** Stop only the retained allocation; no repair, new allocation, or grant renewal. */
export async function stopTaskTools(state: AgentState, task: TaskRow): Promise<boolean> {
  if (!task.toolGrant) return true;
  const retained = await allocationFor(state, task.id);
  if (!retained) return true;
  if (retained.stopped) return true;
  if (!state.toolExecutor) return false;
  try {
    const observed = AgentToolAllocationObservation.parse(
      await state.toolExecutor.stop(retained.request, AbortSignal.timeout(5000)),
    );
    const exact = observed.receipt
      ? observed.receipt.profileHash === retained.request.profileHash &&
        (!retained.receipt || fingerprint(observed.receipt) === fingerprint(retained.receipt))
      : retained.receipt === null;
    const stopped = observed.state === "stopped" && observed.stopped && exact;
    await write(state.store, async (tx) => {
      await tx
        .update(schema.agentToolAllocations)
        .set({
          state: stopped ? "stopped" : "unknown",
          stopped: Boolean(stopped),
          receipt: retained.receipt ?? observed.receipt,
          updatedAt: state.now(),
        })
        .where(eq(schema.agentToolAllocations.taskId, task.id));
    });
    return Boolean(stopped);
  } catch {
    await write(state.store, async (tx) => {
      await tx
        .update(schema.agentToolAllocations)
        .set({ state: "unknown", stopped: false, updatedAt: state.now() })
        .where(eq(schema.agentToolAllocations.taskId, task.id));
    });
    return false;
  }
}
export async function taskToolsDetail(state: AgentState, actor: Actor, taskId: string) {
  assertOwner(actor);
  const task = await taskFor(state.store.db, taskId),
    allocation = await allocationFor(state, taskId);
  const calls = await state.store.db
    .select()
    .from(schema.agentToolCalls)
    .where(eq(schema.agentToolCalls.taskId, taskId))
    .orderBy(asc(schema.agentToolCalls.sequence));
  const files = new Map<
    string,
    import("@godseye/contracts").AgentToolObservation["artifacts"][number]
  >();
  const validated = new Map<string, import("@godseye/contracts").AgentToolObservation>();
  for (const call of calls) {
    if (!call.observation || !["succeeded", "failed"].includes(call.state)) continue;
    const observation = AgentToolObservation.parse(call.observation);
    if (
      call.resultHash !== fingerprint(observation) ||
      call.inputHash !== fingerprint({ name: call.name, arguments: call.arguments }) ||
      !allocation?.receipt ||
      fingerprint(observation.receipt) !== fingerprint(allocation.receipt)
    )
      throw new DomainError("JOURNAL_INCONSISTENT", "Tool receipt integrity failed", 500);
    for (const artifact of observation.artifacts)
      if (
        artifact.bytes !== Buffer.byteLength(artifact.contentUtf8, "utf8") ||
        artifact.sha256 !== createHash("sha256").update(artifact.contentUtf8, "utf8").digest("hex")
      )
        throw new DomainError("JOURNAL_INCONSISTENT", "Tool file integrity failed", 500);
    validated.set(call.id, observation);
  }
  if (task.state === "succeeded" && !task.cancelRequested && allocation?.stopped) {
    for (const call of calls) {
      const observation = validated.get(call.id);
      if (call.state !== "succeeded" || !observation) continue;
      for (const file of observation.artifacts) files.set(file.path, file);
    }
  }
  return AgentTaskToolsDetail.parse({
    taskId,
    toolGrant: task.toolGrant,
    state: allocation?.state ?? (task.toolGrant ? "intended" : "disabled"),
    stopped: allocation?.stopped ?? !task.toolGrant,
    artifacts: [...files.values()].slice(0, 8),
    usage: {
      calls: calls.length,
      readBytes: allocation?.readBytes ?? 0,
      writeBytes: allocation?.writeBytes ?? 0,
      outputBytes: allocation?.outputBytes ?? 0,
    },
    calls: calls.map((call) =>
      AgentToolCallView.parse({
        id: call.id,
        taskId,
        sequence: call.sequence,
        name: call.name,
        state: call.state,
        inputHash: call.inputHash,
        result: validated.get(call.id)?.result ?? null,
        resultHash: call.resultHash,
        createdAt: call.createdAt.toISOString(),
        updatedAt: call.updatedAt.toISOString(),
      }),
    ),
  });
}
