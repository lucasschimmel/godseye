import { setTimeout as wait } from "node:timers/promises";
import type { EffectOutcomeInput, ExecutionContext } from "@godseye/contracts";
import { AttemptOutcome } from "@godseye/contracts";
import { schema } from "@godseye/store";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { chatProgress, chatProviderRequest } from "./agents-chat-progress.js";
import type { AgentObservation } from "./agents-provider.js";
import {
  AGENT_DESTINATION,
  AGENT_TOOL,
  type AgentState,
  currentProfile,
  event,
  profileFor,
  type TaskRow,
  taskFor,
} from "./agents-state.js";
import { executeTaskTool } from "./agents-tools.js";
import { allocationFor, prepareTaskTools, stopTaskTools } from "./agents-tools-lifecycle.js";
import { DomainError } from "./errors.js";
import { currentEpoch, runFor, validateLease } from "./foundation-data.js";
import { fingerprint, write } from "./journal.js";
import { assertOrchestrationDispatch } from "./orchestration-authority.js";
import { attemptReporter } from "./usage-attempts.js";

const Observation = z
  .object({
    state: z.enum(["running", "succeeded", "failed", "cancelled", "unknown"]),
    providerRunId: z.string().min(1).max(128).nullable(),
    output: z.string().max(32768).optional(),
    inputTokens: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).optional(),
    outputTokens: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).optional(),
    stopped: z.boolean(),
    attempts: z.array(AttemptOutcome).max(64).optional(),
  })
  .strict();
export async function executionTask(
  state: AgentState,
  context: ExecutionContext,
  readOnly = false,
) {
  return write(state.store, async (tx) => {
    if (context.command.kind !== "agent.run")
      throw new DomainError("FENCED", "Not a Hermes command", 409);
    await validateLease(state.request, tx, context, readOnly);
    const task = await taskFor(tx, context.command.inputRef);
    if (
      task.runId !== context.runId ||
      task.projectId !== context.projectId ||
      task.environmentId !== context.environmentId ||
      task.profileId !== context.command.profileId ||
      task.profileSnapshot.hash === undefined
    )
      throw new DomainError("FENCED", "Hermes task mapping changed", 409);
    if (!readOnly) {
      if (task.cancelRequested) throw new DomainError("FENCED", "Hermes task was cancelled", 409);
      const profile = await profileFor(tx, task.profileId);
      await currentProfile(state, tx, profile);
      if (profile.revision !== task.profileRevision || profile.hash !== task.profileSnapshot.hash)
        throw new DomainError("FENCED", "Hermes profile policy changed", 409);
    }
    return task;
  });
}
async function observe(
  state: AgentState,
  context: ExecutionContext,
  raw: AgentObservation,
  readOnly = false,
): Promise<EffectOutcomeInput> {
  const observation = Observation.parse(raw);
  for (const outcome of raw.attempts ?? [])
    await attemptReporter(state.store, context.runId, state.now).outcome(
      AttemptOutcome.parse(outcome),
    );
  if (observation.output !== undefined && Buffer.byteLength(observation.output, "utf8") > 32768)
    throw new DomainError("PROVIDER_REJECTED", "Hermes output exceeds its byte limit", 502);
  const task = await executionTask(state, context, readOnly);
  if (task.toolGrant && observation.stopped && observation.state === "succeeded") {
    const allocation = await allocationFor(state, task.id);
    const calls = await state.store.db
      .select()
      .from(schema.agentToolCalls)
      .where(eq(schema.agentToolCalls.taskId, task.id));
    if (!allocation?.stopped || calls.some((call) => !["succeeded", "failed"].includes(call.state)))
      observation.state = "failed";
  }
  const final =
    observation.stopped &&
    ["succeeded", "failed", "cancelled"].includes(observation.state) &&
    (observation.state !== "succeeded" || observation.providerRunId !== null);
  const status = await write(state.store, async (tx) => {
    await validateLease(state.request, tx, context, readOnly);
    const latest = await taskFor(tx, task.id);
    if (latest.providerRunId && observation.providerRunId !== latest.providerRunId)
      throw new DomainError("FENCED", "Hermes provider identity changed", 409);
    if (!readOnly && latest.cancelRequested)
      throw new DomainError("FENCED", "Hermes task was cancelled", 409);
    if (!readOnly) {
      const profile = await profileFor(tx, latest.profileId);
      await currentProfile(state, tx, profile);
      if (profile.hash !== latest.profileSnapshot.hash)
        throw new DomainError("FENCED", "Hermes profile changed during observation", 409);
    }
    let revoked = latest.cancelRequested;
    let reason = latest.reason;
    if (readOnly && !revoked) {
      const { run } = await runFor(tx, context.runId);
      revoked = run.epoch !== (await currentEpoch(tx, latest.environmentId));
      if (!revoked) {
        try {
          await assertOrchestrationDispatch(tx, context.command, state.now);
          const profile = await profileFor(tx, latest.profileId);
          await currentProfile(state, tx, profile);
          revoked = profile.hash !== latest.profileSnapshot.hash;
        } catch (error) {
          if (!(error instanceof DomainError)) throw error;
          revoked = true;
        }
      }
      if (revoked) reason = "AUTHORITY_REVOKED";
    }
    await validateLease(state.request, tx, context, readOnly);
    // Physical completion releases capacity, but never restores revoked logical authority.
    const next = final
      ? revoked
        ? "cancelled"
        : observation.state
      : revoked
        ? "cancel_requested"
        : observation.state === "running"
          ? "running"
          : "unknown";
    await tx
      .update(schema.agentTasks)
      .set({
        providerRunId: observation.providerRunId ?? latest.providerRunId,
        state: next,
        cancelRequested: revoked,
        reason,
        output: revoked
          ? null
          : final && observation.state === "succeeded"
            ? (observation.output ?? null)
            : latest.output,
        inputTokens: observation.inputTokens ?? latest.inputTokens,
        outputTokens: observation.outputTokens ?? latest.outputTokens,
        updatedAt: state.now(),
      })
      .where(eq(schema.agentTasks.id, task.id));
    await event(state, tx, task.id, next);
    try {
      await assertOrchestrationDispatch(tx, context.command, state.now);
    } catch (error) {
      if (!readOnly || !(error instanceof DomainError)) throw error;
      const masked = final ? "cancelled" : "cancel_requested";
      await tx
        .update(schema.agentTasks)
        .set({ state: masked, cancelRequested: true, reason: "AUTHORITY_REVOKED", output: null })
        .where(eq(schema.agentTasks.id, task.id));
      await event(state, tx, task.id, masked);
      return masked;
    }
    return next;
  });
  if (!final) return { status: "unknown", costMicros: task.profileSnapshot.limits.maxCostMicros };
  return {
    status: status === "succeeded" ? "succeeded" : "failed",
    costMicros: task.profileSnapshot.limits.maxCostMicros,
    evidenceRef: `hermes:${task.id}:${fingerprint({ providerRunId: observation.providerRunId, state: status, stopped: true })}`,
  };
}
export async function stopAgentExecution(state: AgentState, context: ExecutionContext) {
  const taskId = context.command.kind === "agent.run" ? context.command.inputRef : null;
  if (!taskId) return;
  state.aborts.get(taskId)?.abort();
  const task = await taskFor(state.store.db, taskId);
  if (task.runId !== context.runId) return;
  if (task.submissionIntended && state.provider) await stopAgentTask(state, task);
  await stopTaskTools(state, task);
}
/** One retained actual stop call per task; a deadline never frees its occupied slot. */
export async function stopAgentTask(state: AgentState, task: TaskRow): Promise<void> {
  if (!state.provider) return;
  const request = await chatProviderRequest(state, task);
  let actual = state.stops.get(task.id);
  if (!actual) {
    actual = state.provider.stop(request, AbortSignal.timeout(5000));
    state.stops.set(task.id, actual);
    const retained = actual;
    void actual
      .finally(() => {
        if (state.stops.get(task.id) === retained) state.stops.delete(task.id);
      })
      .catch(() => undefined);
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      actual,
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, 5000);
      }),
    ]);
  } catch {
    return;
  } finally {
    // Unknown state and retained admission are the explicit failure outcome.
    if (timer) clearTimeout(timer);
  }
}
/** Preserve actual-call capacity past deadlines; late completions cannot acquire renewed authority. */
export async function executeAgent(
  state: AgentState,
  context: ExecutionContext,
): Promise<EffectOutcomeInput> {
  const initial = await executionTask(state, context);
  const provider = state.provider;
  if (!provider?.qualified || !provider.supports(initial.profileSnapshot))
    return { status: "failed", evidenceRef: "hermes:unconfigured", costMicros: 0 };
  if (state.calls.has(initial.id))
    return { status: "unknown", costMicros: initial.profileSnapshot.limits.maxCostMicros };
  const controller = new AbortController();
  state.aborts.set(initial.id, controller);
  const duration = state.timeoutMs(initial.profileSnapshot.limits.timeoutSeconds);
  if (!Number.isSafeInteger(duration) || duration < 1)
    throw new Error("Invalid Hermes deadline policy");
  const assertActive = async () => {
    if (controller.signal.aborted)
      throw new DomainError("FENCED", "Hermes task deadline or cancellation passed", 409);
    await write(state.store, async (tx) => {
      await state.foundation.assertDispatch(tx, context, {
        actorId: context.workerId,
        tool: AGENT_TOOL,
        destination: AGENT_DESTINATION,
        costMicros: 0,
      });
      const task = await taskFor(tx, initial.id);
      const profile = await profileFor(tx, task.profileId);
      await currentProfile(state, tx, profile);
      if (
        task.cancelRequested ||
        profile.hash !== task.profileSnapshot.hash ||
        task.runId !== context.runId
      )
        throw new DomainError("FENCED", "Hermes task authority changed before dispatch", 409);
      const retained = await runFor(tx, context.runId);
      if (
        controller.signal.aborted ||
        !retained.run.leaseExpiresAt ||
        retained.run.leaseExpiresAt.getTime() <= state.now().getTime()
      )
        throw new DomainError("FENCED", "Hermes dispatch lease elapsed during authorization", 409);
    });
    if (controller.signal.aborted) throw new DomainError("FENCED", "Hermes task was fenced", 409);
  };
  const work = (async (): Promise<EffectOutcomeInput> => {
    await write(state.store, async (tx) => {
      await validateLease(state.request, tx, context);
      const task = await taskFor(tx, initial.id);
      if (task.cancelRequested)
        throw new DomainError("FENCED", "Hermes task cancelled before submission", 409);
      await tx
        .update(schema.agentTasks)
        .set({
          submissionIntended: true,
          state: "running",
          deadline:
            task.deadline ??
            new Date(state.now().getTime() + initial.profileSnapshot.limits.timeoutSeconds * 1000),
          updatedAt: state.now(),
        })
        .where(eq(schema.agentTasks.id, task.id));
      await event(state, tx, task.id, "running");
    });
    await assertActive();
    const task = await taskFor(state.store.db, initial.id);
    await state.foundation.authorizeGrant(context, {
      actorId: context.workerId,
      tool: AGENT_TOOL,
      destination: AGENT_DESTINATION,
      costMicros: initial.profileSnapshot.limits.maxCostMicros,
    });
    const request = await chatProviderRequest(state, task);
    await assertActive();
    let observation = await provider.submit(request, {
      attempts: attemptReporter(state.store, context.runId, state.now, context),
      signal: controller.signal,
      assertActive,
      onEvent: (delta) => chatProgress(state, context, task.id, delta, controller.signal),
      ...(task.toolGrant
        ? {
            prepareTools: () =>
              prepareTaskTools(state, task, context, controller.signal, assertActive),
            onToolCall: (call: import("@godseye/contracts").AgentToolCall) =>
              executeTaskTool(state, context, call, controller.signal, assertActive),
          }
        : {}),
    });
    for (;;) {
      await assertActive();
      if (observation.stopped && !(await stopTaskTools(state, task)))
        return { status: "unknown", costMicros: initial.profileSnapshot.limits.maxCostMicros };
      await assertActive();
      const result = await observe(state, context, observation);
      if (observation.state !== "running" || observation.stopped) return result;
      await wait(state.pollMs, undefined, { signal: controller.signal });
      await assertActive();
      observation = await provider.inspect(
        await chatProviderRequest(state, await taskFor(state.store.db, initial.id)),
        controller.signal,
      );
    }
  })();
  state.calls.set(initial.id, work);
  void work
    .finally(() => {
      if (state.calls.get(initial.id) === work) state.calls.delete(initial.id);
      if (state.aborts.get(initial.id) === controller) state.aborts.delete(initial.id);
    })
    .catch(() => undefined);
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<EffectOutcomeInput>((resolve) => {
    timeout = setTimeout(() => {
      controller.abort();
      resolve({ status: "unknown", costMicros: initial.profileSnapshot.limits.maxCostMicros });
    }, duration);
  });
  try {
    return await Promise.race([work, expired]);
  } catch {
    controller.abort();
    return { status: "unknown", costMicros: initial.profileSnapshot.limits.maxCostMicros };
  } finally {
    if (timeout) clearTimeout(timeout);
    if (controller.signal.aborted) await stopAgentExecution(state, context);
  }
}
export async function reconcileAgent(
  state: AgentState,
  context: ExecutionContext,
): Promise<EffectOutcomeInput> {
  const task = await executionTask(state, context, true);
  const unknown: EffectOutcomeInput = {
    status: "unknown",
    costMicros: task.profileSnapshot.limits.maxCostMicros,
  };
  if (!state.provider?.qualified || state.calls.has(task.id) || state.stops.has(task.id))
    return unknown;
  if (!task.submissionIntended)
    return { status: "failed", costMicros: 0, evidenceRef: `hermes:${task.id}:not-submitted` };
  const signal = AbortSignal.timeout(5000);
  const observation = await state.provider.inspect(await chatProviderRequest(state, task), signal);
  if (observation.stopped && !(await stopTaskTools(state, task))) return unknown;
  return observe(state, context, observation, true);
}
