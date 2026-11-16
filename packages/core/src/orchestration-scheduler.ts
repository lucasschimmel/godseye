import type { OrchestrationChildView, OrchestrationDetailView } from "@godseye/contracts";
import { type DatabaseAccess, schema } from "@godseye/store";
import { eq } from "drizzle-orm";
import { DomainError } from "./errors.js";
import { write } from "./journal.js";
import { dependencyInput } from "./orchestration-authority.js";
import {
  childId,
  currentOrchestration,
  type OrchestrationState,
  orchestrationActor,
  orchestrationFor,
  saveOrchestration,
} from "./orchestration-state.js";
export async function refreshChildren(tx: DatabaseAccess, d: OrchestrationDetailView) {
  const children: OrchestrationChildView[] = [];
  for (const child of d.children) {
    if (!child.taskId) {
      children.push(child);
      continue;
    }
    const [a] =
      child.kind === "hermes"
        ? await tx.select().from(schema.agentTasks).where(eq(schema.agentTasks.id, child.taskId))
        : [];
    const [c] =
      child.kind === "coding"
        ? await tx.select().from(schema.codingTasks).where(eq(schema.codingTasks.id, child.taskId))
        : [];
    const status = a?.state ?? c?.metadata.state;
    if (!status) {
      children.push(child);
      continue;
    }
    const runId = a?.runId ?? c?.runId;
    const [operation] = runId
      ? await tx.select().from(schema.operations).where(eq(schema.operations.id, runId))
      : [];
    const terminal = ["succeeded", "failed", "cancelled"].includes(status);
    const state: OrchestrationChildView["state"] =
      terminal && operation && !["succeeded", "failed", "cancelled"].includes(operation.status)
        ? operation.status === "unknown"
          ? "unknown"
          : "running"
        : status === "queued" && !runId
          ? "intended"
          : status === "queued" ||
              status === "running" ||
              status === "cancel_requested" ||
              status === "reconciling"
            ? "running"
            : status === "unknown"
              ? "unknown"
              : status === "succeeded"
                ? "succeeded"
                : status === "cancelled"
                  ? "cancelled"
                  : "failed";
    children.push({ ...child, state, reason: a?.reason ?? c?.metadata.reason ?? null });
  }
  return { ...d, children };
}
/** Durable protective stop is retryable after restart; it never allocates or submits execution. */
export async function stopChildren(state: OrchestrationState, id: string) {
  const d = await orchestrationFor(state.store.db, id);
  for (const child of d.children) {
    if (!child.taskId || ["succeeded", "failed", "cancelled"].includes(child.state)) continue;
    const taskId = child.taskId;
    const runId = await write(state.store, async (tx) => {
      const latest = await orchestrationFor(tx, id);
      if (["approved", "running"].includes(latest.state))
        throw new DomainError("FENCED", "Active plan cannot request a protective stop", 409);
      if (child.kind === "hermes") {
        const [task] = await tx
          .select()
          .from(schema.agentTasks)
          .where(eq(schema.agentTasks.id, taskId));
        if (!task) {
          await saveOrchestration(state, tx, {
            ...latest,
            children: latest.children.map((c) =>
              c.taskId === taskId ? { ...c, state: "cancelled", reason: "NOT_STAGED" } : c,
            ),
          });
          return null;
        }
        if (["succeeded", "failed", "cancelled"].includes(task.state)) return task.runId;
        await tx
          .update(schema.agentTasks)
          .set({
            cancelRequested: true,
            state: task.runId ? "cancel_requested" : "cancelled",
            output: null,
            updatedAt: state.now(),
          })
          .where(eq(schema.agentTasks.id, taskId));
        return task.runId;
      }
      const [row] = await tx
        .select()
        .from(schema.codingTasks)
        .where(eq(schema.codingTasks.id, taskId));
      if (!row) {
        await saveOrchestration(state, tx, {
          ...latest,
          children: latest.children.map((c) =>
            c.taskId === taskId ? { ...c, state: "cancelled", reason: "NOT_STAGED" } : c,
          ),
        });
        return null;
      }
      if (["succeeded", "failed", "cancelled"].includes(row.metadata.state)) return row.runId;
      await tx
        .update(schema.codingTasks)
        .set({
          metadata: {
            ...row.metadata,
            state: row.runId ? "cancel_requested" : "cancelled",
            cleanupState: "revoked",
            updatedAt: state.now().toISOString(),
          },
          result: null,
        })
        .where(eq(schema.codingTasks.id, taskId));
      return row.runId;
    });
    if (runId)
      await state.foundation.cancelDelegated(
        orchestrationActor(d.plan.projectId),
        runId,
        `orchestration-stop:${taskId}`,
        {
          taskId,
          authorize: async (tx) => {
            const current = await orchestrationFor(tx, id);
            if (
              ["approved", "running"].includes(current.state) ||
              !current.children.some((c) => c.taskId === taskId)
            )
              throw new DomainError("FENCED", "Protective stop binding changed", 409);
          },
        },
      );
    if (child.kind === "hermes") {
      const [task] = await state.store.db
        .select()
        .from(schema.agentTasks)
        .where(eq(schema.agentTasks.id, taskId));
      if (task) {
        try {
          await state.agents.stopDelegated(taskId);
        } catch {
          await recordCleanupUncertain(state, id, taskId, "hermes");
        }
      }
    } else {
      const [task] = await state.store.db
        .select()
        .from(schema.codingTasks)
        .where(eq(schema.codingTasks.id, taskId));
      if (task) {
        try {
          await state.coding.stopDelegated(taskId);
        } catch {
          await recordCleanupUncertain(state, id, taskId, "coding");
        }
      }
    }
  }
}
async function recordCleanupUncertain(
  state: OrchestrationState,
  id: string,
  taskId: string,
  kind: "hermes" | "coding",
) {
  await write(state.store, async (tx) => {
    const d = await orchestrationFor(tx, id);
    await saveOrchestration(state, tx, { ...d, reason: "CLEANUP_UNCERTAIN" });
    if (kind === "hermes")
      await tx
        .update(schema.agentTasks)
        .set({ reason: "CLEANUP_UNCERTAIN" })
        .where(eq(schema.agentTasks.id, taskId));
    else {
      const [row] = await tx
        .select()
        .from(schema.codingTasks)
        .where(eq(schema.codingTasks.id, taskId));
      if (row)
        await tx
          .update(schema.codingTasks)
          .set({
            metadata: { ...row.metadata, reason: "CLEANUP_UNCERTAIN", cleanupState: "quarantined" },
          })
          .where(eq(schema.codingTasks.id, taskId));
    }
  });
}
export async function tickOrchestration(state: OrchestrationState, id: string) {
  const intent = await write(state.store, async (tx) => {
    let d = await refreshChildren(tx, await orchestrationFor(tx, id));
    if (!["approved", "running"].includes(d.state)) {
      await saveOrchestration(state, tx, d);
      return null;
    }
    try {
      await currentOrchestration(state, tx, d);
    } catch (error) {
      if (!(error instanceof DomainError)) throw error;
      await saveOrchestration(state, tx, {
        ...d,
        state:
          Date.parse(d.plan.expiresAt) <= state.now().getTime() ? "expired" : "cancel_requested",
        reason: error.code,
      });
      return null;
    }
    if (d.children.some((c) => ["failed", "unknown", "cancelled"].includes(c.state))) {
      await saveOrchestration(state, tx, {
        ...d,
        state: d.children.some((c) => c.state === "unknown") ? "unknown" : "failed",
        reason: "CHILD_BLOCKED",
      });
      return null;
    }
    if (d.children.every((c) => c.state === "succeeded")) {
      await saveOrchestration(state, tx, { ...d, state: "succeeded" });
      return null;
    }
    const live = d.children.find((c) => c.state === "running");
    if (live) {
      await saveOrchestration(state, tx, d);
      return null;
    }
    let child = d.children.find((c) => c.state === "intended");
    if (!child)
      child = d.children.find(
        (c) =>
          c.state === "pending" &&
          d.plan.steps
            .find((s) => s.step.id === c.stepId)
            ?.step.dependsOn.every((dep) =>
              d.children.some((p) => p.stepId === dep && p.state === "succeeded"),
            ),
      );
    if (!child) {
      await saveOrchestration(state, tx, d);
      return null;
    }
    const step = d.plan.steps.find((s) => s.step.id === child.stepId)?.step;
    if (!step) throw new DomainError("FENCED", "Missing frozen step", 409);
    if (step.kind === "clarification") {
      child.state = step.answer ? "succeeded" : "waiting_clarification";
      await saveOrchestration(state, tx, {
        ...d,
        state: step.answer ? "running" : "waiting_clarification",
      });
      return null;
    }
    child.taskId = childId(id, step.id);
    child.state = "intended";
    d = await saveOrchestration(state, tx, { ...d, state: "running" });
    try {
      return {
        d,
        step,
        taskId: child.taskId,
        input: step.kind === "hermes" ? await dependencyInput(tx, d, step.id) : null,
      };
    } catch (error) {
      if (!(error instanceof DomainError) || error.status >= 500) throw error;
      child.state = "failed";
      child.reason = error.code;
      await saveOrchestration(state, tx, {
        ...d,
        children: d.children.map((c) => (c.stepId === child.stepId ? child : c)),
        state: "failed",
        reason: error.code,
      });
      return null;
    }
  });
  if (!intent) {
    const d = await orchestrationFor(state.store.db, id);
    if (["cancel_requested", "expired", "failed"].includes(d.state)) await stopChildren(state, id);
    return;
  }
  const { d, step, taskId } = intent;
  const delegated = {
    taskId,
    authorize: async (tx: DatabaseAccess) => {
      const latest = await orchestrationFor(tx, id);
      await currentOrchestration(state, tx, latest);
      const child = latest.children.find((c) => c.stepId === step.id);
      if (child?.taskId !== taskId || !["intended", "running"].includes(child.state))
        throw new DomainError("FENCED", "Durable child identity changed", 409);
      if (step.kind === "hermes" && (await dependencyInput(tx, latest, step.id)) !== intent.input)
        throw new DomainError("FENCED", "Dependency results changed", 409);
    },
  };
  try {
    if (step.kind === "hermes")
      await state.agents.launchDelegated(
        orchestrationActor(d.plan.projectId),
        { profileId: step.profileId, expectedRevision: step.expectedRevision, input: intent.input },
        `orchestration-agent:${taskId}`,
        delegated,
      );
    else
      await state.coding.admitDelegated(
        orchestrationActor(d.plan.projectId),
        { preparationId: step.preparationId, expectedHash: step.expectedHash },
        `orchestration-coding:${taskId}`,
        delegated,
      );
  } catch (error) {
    await write(state.store, async (tx) => {
      let latest = await refreshChildren(tx, await orchestrationFor(tx, id));
      const child = latest.children.find((c) => c.taskId === taskId);
      if (child?.state !== "intended") {
        await saveOrchestration(state, tx, latest);
        return;
      }
      const known = error instanceof DomainError;
      if (
        known &&
        [
          "HEAVY_QUEUE_FULL",
          "HEAVY_POOL_BUSY",
          "HEAVY_TASK_BUSY",
          "CODING_POOL_BUSY",
          "AGENT_BUSY",
          "ADMISSION_PAUSED",
          "CAPACITY_EXCEEDED",
        ].includes(error.code)
      ) {
        await saveOrchestration(state, tx, latest);
        return;
      }
      child.state = known ? "failed" : "unknown";
      child.reason = known ? error.code : "ADMISSION_UNKNOWN";
      latest = { ...latest, state: known ? "failed" : "unknown", reason: child.reason };
      await saveOrchestration(state, tx, latest);
    });
  }
}
