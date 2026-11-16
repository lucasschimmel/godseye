import { randomUUID } from "node:crypto";
import { AGENT_DEFAULTS, AGENT_TOOL_DESTINATION, LaunchAgentTask } from "@godseye/contracts";
import { type DatabaseAccess, schema } from "@godseye/store";
import { eq } from "drizzle-orm";
import {
  AGENT_DESTINATION,
  AGENT_TERMINAL,
  AGENT_TOOL,
  AGENTS_ADAPTER_ID,
  type AgentState,
  assertNotBusy,
  currentProfile,
  event,
  profileFor,
  profileView,
  type TaskRow,
  taskFor,
  taskView,
} from "./agents-state.js";
import { validateTaskToolGrant } from "./agents-tools-policy.js";
import { DomainError, parseInput } from "./errors.js";
import { recordRequest, requestFor } from "./foundation-data.js";
import { appendAudit, write } from "./journal.js";
import type { DelegatedTask } from "./orchestration-delegation.js";
import { type Actor, assertOwner } from "./policy.js";

export async function launchAgentTask(
  state: AgentState,
  actor: Actor,
  raw: unknown,
  key: string,
  stage?: (tx: DatabaseAccess, task: TaskRow) => Promise<void>,
  existingId?: string,
  delegated?: DelegatedTask,
) {
  if (!delegated) assertOwner(actor);
  const input = parseInput(LaunchAgentTask, raw);
  if (Buffer.byteLength(input.input, "utf8") > AGENT_DEFAULTS.maxInputBytes)
    throw new DomainError("INVALID_INPUT", "Agent input exceeds its byte limit", 422);
  const task = existingId
    ? await taskFor(state.store.db, existingId)
    : await write(state.store, async (tx) => {
        await delegated?.authorize(tx);
        const receipt = await requestFor(tx, actor, key, "agent.launch", input);
        if (receipt.existing) return taskFor(tx, receipt.existing.resourceId);
        const profile = await profileFor(tx, input.profileId);
        await currentProfile(state, tx, profile);
        validateTaskToolGrant(state, profile, input.toolGrant);
        if (profile.revision !== input.expectedRevision)
          throw new DomainError("REVISION_CONFLICT", "Agent profile changed", 409);
        const snapshot = profileView(state, profile);
        if (snapshot.runtime !== "available")
          throw new DomainError("CAPABILITY_UNAVAILABLE", "Hermes provider is unconfigured", 503);
        await assertNotBusy(tx, profile.id);
        const retained = await tx
          .select({ id: schema.agentTasks.id })
          .from(schema.agentTasks)
          .limit(AGENT_DEFAULTS.maxTasks);
        if (retained.length >= AGENT_DEFAULTS.maxTasks)
          throw new DomainError("AGENT_TASK_LIMIT", "Agent task retention capacity exceeded", 409);
        const row = {
          id: delegated?.taskId ?? randomUUID(),
          profileId: profile.id,
          projectId: profile.projectId,
          environmentId: profile.environmentId,
          profileRevision: profile.revision,
          profileSnapshot: snapshot,
          toolGrant: input.toolGrant ?? null,
          runId: null,
          state: "queued",
          providerRunId: null,
          input: input.input,
          output: null,
          reason: null,
          inputTokens: null,
          outputTokens: null,
          cancelRequested: false,
          submissionIntended: false,
          deadline: null,
          createdAt: state.now(),
          updatedAt: state.now(),
          finishedAt: null,
        };
        await tx.insert(schema.agentTasks).values(row);
        await stage?.(tx, row);
        await tx.insert(schema.resources).values({
          id: row.id,
          projectId: row.projectId,
          environmentId: row.environmentId,
          kind: "input",
          name: "Private Hermes task input",
          createdAt: state.now(),
        });
        await recordRequest(tx, state.request, key, receipt.digest, row.id, "agent.launch", false);
        await event(state, tx, row.id, "queued");
        await appendAudit(
          tx,
          actor,
          row.projectId,
          "agent.task.intended",
          `Intended scoped task ${row.id} for profile ${profile.id}`,
        );
        return row;
      });
  if (task.runId || AGENT_TERMINAL.includes(task.state)) return taskView(task);
  const profile = await profileFor(state.store.db, task.profileId);
  try {
    const plan = await state.foundation.createPlan(
      actor,
      {
        projectId: task.projectId,
        environmentId: task.environmentId,
        targetId: task.environmentId,
        expectedRevision: task.profileSnapshot.projectRevision,
        adapterId: AGENTS_ADAPTER_ID,
        command: {
          kind: "agent.run",
          profileId: task.profileId,
          skillVersionId: profile.skillRef,
          inputRef: task.id,
          grantRef: profile.grantRef,
        },
        maxCostMicros: task.profileSnapshot.limits.maxCostMicros,
        tools: [AGENT_TOOL, ...(task.toolGrant?.policy.tools ?? [])],
        destinations: [AGENT_DESTINATION, ...(task.toolGrant ? [AGENT_TOOL_DESTINATION] : [])],
      },
      `agent-plan:${task.id}`,
    );
    await state.foundation.enqueue(actor, plan.id, `agent-enqueue:${task.id}`);
  } catch (error) {
    if (
      delegated &&
      error instanceof DomainError &&
      [
        "HEAVY_QUEUE_FULL",
        "HEAVY_POOL_BUSY",
        "HEAVY_TASK_BUSY",
        "CODING_POOL_BUSY",
        "ADMISSION_PAUSED",
        "CAPACITY_EXCEEDED",
      ].includes(error.code)
    )
      throw error;
    await write(state.store, async (tx) => {
      const latest = await taskFor(tx, task.id);
      if (latest.runId || latest.cancelRequested || AGENT_TERMINAL.includes(latest.state)) return;
      const known = error instanceof DomainError;
      const status = known ? "failed" : "unknown";
      await tx
        .update(schema.agentTasks)
        .set({
          state: status,
          reason: known ? error.code : "ADMISSION_UNKNOWN",
          finishedAt: known ? state.now() : null,
          updatedAt: state.now(),
        })
        .where(eq(schema.agentTasks.id, task.id));
      await event(state, tx, task.id, status);
      if (known)
        await tx
          .update(schema.foundationRequests)
          .set({ terminalAt: state.now() })
          .where(eq(schema.foundationRequests.resourceId, task.id));
    });
    throw error;
  }
  return taskView(await taskFor(state.store.db, task.id));
}
