import type { CreateExecutionPlanInput } from "@godseye/contracts";
import { ORCHESTRATION_DEFAULTS, ProposeOrchestration } from "@godseye/contracts";
import { type DatabaseAccess, type Store, schema } from "@godseye/store";
import { eq } from "drizzle-orm";
import type { AgentEngine } from "./agents.js";
import type { CodingEngine } from "./coding.js";
import { DomainError, parseInput } from "./errors.js";
import { foundationState, recordRequest, requestFor } from "./foundation-data.js";
import type { FoundationEngine } from "./foundations.js";
import { appendAudit, write } from "./journal.js";
import { delegatedOrchestration } from "./orchestration-authority.js";
import {
  answerOrchestration,
  decideOrchestration,
  orchestrationOverview,
  prepareOrchestration,
  proposalFromTask,
} from "./orchestration-plans.js";
import { refreshChildren, stopChildren, tickOrchestration } from "./orchestration-scheduler.js";
import {
  type OrchestrationState,
  orchestrationActor,
  orchestrationFor,
  saveOrchestration,
} from "./orchestration-state.js";
import { type Actor, assertOwner } from "./policy.js";
export class OrchestrationEngine {
  private state!: OrchestrationState;
  constructor(
    private readonly store: Store,
    private readonly now: () => Date = () => new Date(),
  ) {}
  bind(foundation: FoundationEngine, agents: AgentEngine, coding: CodingEngine) {
    this.state = {
      store: this.store,
      now: this.now,
      foundation,
      agents,
      coding,
      request: foundationState(this.store, { now: this.now }),
    };
  }
  prepare(actor: Actor, input: unknown, key: string) {
    return prepareOrchestration(this.state, actor, input, key);
  }
  overview(actor: Actor) {
    return orchestrationOverview(this.state, actor);
  }
  detail(actor: Actor, id: string) {
    assertOwner(actor);
    return orchestrationFor(this.store.db, id);
  }
  approve(actor: Actor, id: string, input: unknown, key: string) {
    return decideOrchestration(this.state, actor, id, input, key, true);
  }
  reject(actor: Actor, id: string, input: unknown, key: string) {
    return decideOrchestration(this.state, actor, id, input, key, false);
  }
  answer(actor: Actor, id: string, input: unknown, key: string) {
    return answerOrchestration(this.state, actor, id, input, key);
  }
  delegatedAuthority(
    tx: DatabaseAccess,
    plan: CreateExecutionPlanInput,
    phase: "create" | "enqueue" | "approval",
    actor?: Actor,
  ) {
    return delegatedOrchestration(this.state, tx, plan, phase, actor);
  }
  async reserve(tx: DatabaseAccess, plan: CreateExecutionPlanInput) {
    await delegatedOrchestration(this.state, tx, plan, "approval");
  }
  propose(actor: Actor, raw: unknown, key: string) {
    assertOwner(actor);
    const input = parseInput(ProposeOrchestration, raw);
    return write(this.store, async (tx) => {
      const receipt = await requestFor(tx, actor, key, "orchestration.propose", input);
      if (receipt.existing) return orchestrationFor(tx, receipt.existing.resourceId);
      const detail = await proposalFromTask(this.state, tx, input.taskId);
      if (!detail)
        throw new DomainError(
          "INVALID_PROPOSAL",
          "Successful current Hermes output must contain a complete strict plan JSON",
          422,
        );
      await recordRequest(
        tx,
        this.state.request,
        key,
        receipt.digest,
        detail.plan.id,
        "orchestration.propose",
      );
      await appendAudit(
        tx,
        actor,
        detail.plan.projectId,
        "orchestration.proposed",
        `Imported pending proposal from task ${input.taskId}`,
      );
      return detail;
    });
  }
  async cancel(actor: Actor, id: string, key: string) {
    assertOwner(actor);
    await write(this.store, async (tx) => {
      const receipt = await requestFor(tx, actor, key, "orchestration.cancel", { id }),
        d = await orchestrationFor(tx, id);
      if (receipt.existing) return;
      if (!["succeeded", "cancelled", "rejected"].includes(d.state))
        await saveOrchestration(this.state, tx, {
          ...d,
          state: "cancel_requested",
          reason: "OWNER_CANCELLED",
        });
      await recordRequest(tx, this.state.request, key, receipt.digest, id, "orchestration.cancel");
      await appendAudit(
        tx,
        actor,
        d.plan.projectId,
        "orchestration.cancel_requested",
        `Revoked all child authority for plan ${id}`,
      );
    });
    const current = await orchestrationFor(this.store.db, id);
    if (current.state === "cancel_requested") await stopChildren(this.state, id);
    return this.refresh(id);
  }
  async reconcile(actor: Actor, id: string, key: string) {
    assertOwner(actor);
    const replay = await write(this.store, async (tx) => {
      const receipt = await requestFor(tx, actor, key, "orchestration.reconcile", { id });
      return Boolean(receipt.existing);
    });
    if (replay) return this.detail(actor, id);
    const d = await orchestrationFor(this.store.db, id);
    for (const child of d.children) {
      if (!child.taskId || !["unknown", "running"].includes(child.state)) continue;
      const [a] =
        child.kind === "hermes"
          ? await this.store.db
              .select()
              .from(schema.agentTasks)
              .where(eq(schema.agentTasks.id, child.taskId))
          : [];
      const [c] =
        child.kind === "coding"
          ? await this.store.db
              .select()
              .from(schema.codingTasks)
              .where(eq(schema.codingTasks.id, child.taskId))
          : [];
      const runId = a?.runId ?? c?.runId;
      const [op] = runId
        ? await this.store.db
            .select()
            .from(schema.operations)
            .where(eq(schema.operations.id, runId))
        : [];
      if (op?.status === "unknown")
        await this.state.foundation.reconcile(
          actor,
          op.id,
          `orchestration-reconcile:${child.taskId}:${key.slice(-24)}`,
        );
    }
    return write(this.store, async (tx) => {
      const receipt = await requestFor(tx, actor, key, "orchestration.reconcile", { id });
      const latest = await refreshChildren(tx, await orchestrationFor(tx, id));
      const result = await saveOrchestration(this.state, tx, latest);
      if (!receipt.existing) {
        await recordRequest(
          tx,
          this.state.request,
          key,
          receipt.digest,
          id,
          "orchestration.reconcile",
        );
        await appendAudit(
          tx,
          actor,
          d.plan.projectId,
          "orchestration.reconciled",
          `Observed retained child effects for plan ${id}`,
        );
      }
      return result;
    });
  }
  private refresh(id: string) {
    return write(this.store, async (tx) => {
      let d = await refreshChildren(tx, await orchestrationFor(tx, id));
      if (
        d.state === "cancel_requested" &&
        d.children.every((c) => !c.taskId || ["succeeded", "failed", "cancelled"].includes(c.state))
      )
        d = { ...d, state: "cancelled" };
      // Unknown plans never resume dispatch, even when physical reconciliation succeeds.
      return saveOrchestration(this.state, tx, d);
    });
  }
  async tick() {
    const rows = await this.store.db.select().from(schema.orchestrationPlans);
    for (const row of rows)
      if (
        ["approved", "running", "cancel_requested", "expired", "unknown", "failed"].includes(
          row.metadata.state,
        )
      ) {
        await tickOrchestration(this.state, row.id);
        await this.refresh(row.id);
      }
    // Source operations are committed before extraction; malformed outputs remain inert text.
    const tasks = await this.store.db
      .select()
      .from(schema.agentTasks)
      .where(eq(schema.agentTasks.state, "succeeded"));
    const processed = await this.store.db
      .select()
      .from(schema.foundationRequests)
      .where(eq(schema.foundationRequests.kind, "orchestration.source"));
    const seen = new Set(processed.map((r) => r.resourceId));
    for (const task of tasks)
      if (!seen.has(task.id))
        await write(this.store, async (tx) => {
          const key = `orchestration-source:${task.id}`,
            actor = orchestrationActor(task.projectId);
          const receipt = await requestFor(tx, actor, key, "orchestration.source", {
            taskId: task.id,
          });
          if (receipt.existing) return;
          await proposalFromTask(this.state, tx, task.id);
          await recordRequest(
            tx,
            this.state.request,
            key,
            receipt.digest,
            task.id,
            "orchestration.source",
            false,
          );
        });
  }
}
export async function runOrchestrationScheduler(
  engine: OrchestrationEngine,
  options: { signal: AbortSignal; idleMs?: number },
) {
  const idleMs = options.idleMs ?? ORCHESTRATION_DEFAULTS.schedulerMs;
  if (!Number.isSafeInteger(idleMs) || idleMs < 1)
    throw new Error("Invalid orchestration scheduler policy");
  while (!options.signal.aborted) {
    await engine.tick();
    await new Promise<void>((resolve) => {
      const done = () => {
        clearTimeout(timer);
        options.signal.removeEventListener("abort", done);
        resolve();
      };
      const timer = setTimeout(done, idleMs);
      options.signal.addEventListener("abort", done, { once: true });
      if (options.signal.aborted) done();
    });
  }
}
