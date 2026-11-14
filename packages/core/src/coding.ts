import {
  CODING_DEFAULTS,
  CodingOverview,
  CodingTaskDetail,
  type ExecutionAdapter,
} from "@godseye/contracts";
import { type DatabaseAccess, type Store, schema } from "@godseye/store";
import { desc, eq } from "drizzle-orm";
import { executeCoding, stopCoding } from "./coding-execution.js";
import { admitCoding, prepareCoding } from "./coding-preparation.js";
import {
  CODING_ADAPTER_ID,
  CODING_DESTINATION,
  CODING_TERMINAL,
  CODING_TOOL,
  type CodingOptions,
  type CodingState,
  codingActor,
  codingScope,
  codingTaskFor,
  preparationFor,
  updateCodingTask,
} from "./coding-state.js";
import { DomainError } from "./errors.js";
import { foundationState, recordRequest, requestFor } from "./foundation-data.js";
import type { FoundationEngine } from "./foundations.js";
import { appendAudit, fingerprint, write } from "./journal.js";
import { assertOrchestrationTask } from "./orchestration-authority.js";
import type { DelegatedTask } from "./orchestration-delegation.js";
import { type Actor, assertOwner } from "./policy.js";

export type { CodingOptions } from "./coding-state.js";
export { CODING_ADAPTER_ID } from "./coding-state.js";
/** Durable repository tasks share Foundation admission; no project code runs on the controller. */
export class CodingEngine {
  private state!: CodingState;
  readonly adapter: ExecutionAdapter;
  constructor(
    private readonly store: Store,
    private readonly options: CodingOptions = {},
  ) {
    this.adapter = {
      id: CODING_ADAPTER_ID,
      qualified: options.provider?.qualified === true,
      execute: (context) => executeCoding(this.state, context),
      reconcile: (context) => executeCoding(this.state, context, true),
      onFenced: async (context) => {
        if (context.command.kind === "coding.run")
          await stopCoding(this.state, context.command.taskId);
      },
    };
  }
  bind(foundation: FoundationEngine) {
    this.state = {
      store: this.store,
      foundation,
      request: foundationState(this.store, { now: this.options.now }),
      now: this.options.now ?? (() => new Date()),
      provider: this.options.provider,
      capacity: this.options.capacity,
      calls: new Map(),
      aborts: new Map(),
    };
  }
  prepare(actor: Actor, input: unknown, key: string) {
    return prepareCoding(this.state, actor, input, key);
  }
  admit(actor: Actor, input: unknown, key: string) {
    return admitCoding(this.state, actor, input, key);
  }
  admitDelegated(actor: Actor, input: unknown, key: string, delegated: DelegatedTask) {
    return admitCoding(this.state, actor, input, key, delegated);
  }
  preparation(actor: Actor, id: string) {
    assertOwner(actor);
    return preparationFor(this.store.db, id);
  }
  async detail(actor: Actor, id: string) {
    assertOwner(actor);
    const { row, task } = await codingTaskFor(this.store.db, id);
    return CodingTaskDetail.parse({
      task,
      preparation: await preparationFor(this.store.db, task.preparationId),
      result: row.result,
    });
  }
  async overview(actor: Actor) {
    assertOwner(actor);
    const preparations = await this.store.db
      .select()
      .from(schema.codingPreparations)
      .orderBy(desc(schema.codingPreparations.createdAt))
      .limit(CODING_DEFAULTS.maxPreparations);
    const tasks = await this.store.db
      .select()
      .from(schema.codingTasks)
      .orderBy(desc(schema.codingTasks.createdAt))
      .limit(CODING_DEFAULTS.maxTasks);
    const capabilities =
      this.options.provider?.capabilities() ??
      (["codex", "claude-code"] as const).map((runner) => ({
        runner,
        available: false,
        version: null,
        reason: "Disposable KVM and bounded vendor API broker are not qualified",
        isolation: "disposable-kvm" as const,
        billing: "unavailable" as const,
        auth: "task-scoped-broker" as const,
      }));
    if (new Set(capabilities.map((item) => item.runner)).size !== 2 || capabilities.length !== 2)
      throw new DomainError("PROVIDER_REJECTED", "Coding capability catalog is inconsistent", 502);
    return CodingOverview.parse({
      capabilities: capabilities.map((capability) => {
        const capacity = this.options.capacity;
        const configured =
          capacity &&
          Object.values(capacity).every((value) => Number.isSafeInteger(value) && value > 0);
        return capability.available && (!configured || !this.options.provider?.qualified)
          ? {
              ...capability,
              available: false,
              billing: "unavailable" as const,
              reason: "Coding resource pool including VMM overhead is not configured",
            }
          : capability;
      }),
      preparations: preparations.map((row) => row.metadata),
      tasks: tasks.map((row) => row.metadata),
    });
  }
  async reserve(
    tx: DatabaseAccess,
    plan: typeof schema.executionPlans.$inferSelect,
    runId: string,
  ) {
    if (plan.adapterId !== CODING_ADAPTER_ID) return;
    if (plan.command.kind !== "coding.run")
      throw new DomainError("FORBIDDEN", "Invalid coding plan", 403);
    const { task } = await codingTaskFor(tx, plan.command.taskId);
    const p = await preparationFor(tx, task.preparationId);
    await codingScope(this.state, tx, codingActor(task.projectId), p, p.repositoryHash);
    if (
      task.runId ||
      task.state !== "queued" ||
      p.id !== plan.command.preparationId ||
      p.hash !== plan.command.preparationHash ||
      task.projectId !== plan.projectId ||
      task.environmentId !== plan.environmentId ||
      plan.targetId !== task.environmentId ||
      plan.expectedRevision !== p.expectedProjectRevision ||
      plan.maxCostMicros !== p.limits.maxCostMicros ||
      fingerprint(plan.tools) !== fingerprint([CODING_TOOL]) ||
      fingerprint(plan.destinations) !== fingerprint([CODING_DESTINATION])
    )
      throw new DomainError("FENCED", "Coding admission does not match immutable task", 409);
    const others = await tx.select().from(schema.codingTasks);
    if (
      others.some(
        (row) => row.id !== task.id && row.runId && !CODING_TERMINAL.includes(row.metadata.state),
      )
    )
      throw new DomainError(
        "CODING_POOL_BUSY",
        "Coding resource pool is occupied or awaiting physical cleanup",
        429,
      );
    await updateCodingTask(this.state, tx, task, { runId });
  }
  async settlement(tx: DatabaseAccess, runId: string, status: string) {
    const [row] = await tx
      .select()
      .from(schema.codingTasks)
      .where(eq(schema.codingTasks.runId, runId));
    if (!row) return;
    const task = row.metadata;
    let revoked = false;
    try {
      await assertOrchestrationTask(tx, task.id, this.state.now);
    } catch (error) {
      if (!(error instanceof DomainError)) throw error;
      revoked = true;
    }
    if (revoked)
      await tx
        .update(schema.codingTasks)
        .set({ result: null })
        .where(eq(schema.codingTasks.id, task.id));
    const stopped = task.cleanupState === "stopped" || !task.submissionIntended;
    const final = status !== "unknown" && stopped;
    const next = final
      ? task.state === "cancel_requested" || task.state === "cancelled"
        ? "cancelled"
        : status === "succeeded"
          ? "succeeded"
          : "failed"
      : task.state === "cancel_requested"
        ? "cancel_requested"
        : "unknown";
    await updateCodingTask(this.state, tx, task, {
      state: revoked ? (final ? "cancelled" : "cancel_requested") : next,
      finishedAt: final ? this.state.now().toISOString() : null,
    });
    if (final)
      await tx
        .update(schema.foundationRequests)
        .set({ terminalAt: this.state.now() })
        .where(eq(schema.foundationRequests.resourceId, task.id));
  }
  async uncertainty(tx: DatabaseAccess, runId: string) {
    const [operation] = await tx
      .select()
      .from(schema.operations)
      .where(eq(schema.operations.id, runId));
    if (
      ["ACTIVATION_FENCED", "CANCELLED_WITH_UNCERTAIN_EFFECT"].includes(operation?.errorCode ?? "")
    ) {
      const [row] = await tx
        .select()
        .from(schema.codingTasks)
        .where(eq(schema.codingTasks.runId, runId));
      if (row)
        await updateCodingTask(this.state, tx, row.metadata, {
          state: "cancel_requested",
          cleanupState: "revoked",
          reason: "AUTHORITY_REVOKED",
        });
    }
    return this.settlement(tx, runId, "unknown");
  }
  async releaseQueued(tx: DatabaseAccess, runId: string) {
    const [row] = await tx
      .select()
      .from(schema.codingTasks)
      .where(eq(schema.codingTasks.runId, runId));
    if (!row) return;
    const [operation] = await tx
      .select()
      .from(schema.operations)
      .where(eq(schema.operations.id, runId));
    await updateCodingTask(this.state, tx, row.metadata, {
      state: operation?.status === "cancelled" ? "cancelled" : "failed",
      finishedAt: this.state.now().toISOString(),
      reason: operation?.errorCode ?? null,
    });
  }
  async cancel(actor: Actor, id: string, key: string) {
    assertOwner(actor);
    const task = await write(this.store, async (tx) => {
      const receipt = await requestFor(tx, actor, key, "coding.cancel", { id });
      const { task } = await codingTaskFor(tx, id);
      if (receipt.existing || CODING_TERMINAL.includes(task.state)) return task;
      const next = await updateCodingTask(this.state, tx, task, {
        state: task.runId ? "cancel_requested" : "cancelled",
        cleanupState: "revoked",
        finishedAt: task.runId ? null : this.state.now().toISOString(),
      });
      await recordRequest(tx, this.state.request, key, receipt.digest, id, "coding.cancel");
      await appendAudit(
        tx,
        actor,
        task.projectId,
        "coding.cancel_requested",
        `Revoked coding task ${id}`,
      );
      return next;
    });
    if (task.runId && !CODING_TERMINAL.includes(task.state)) {
      await this.state.foundation.cancel(actor, task.runId, `coding-cancel:${id}`);
      await stopCoding(this.state, id);
    }
    return (await codingTaskFor(this.store.db, id)).task;
  }
  stopDelegated(id: string) {
    return stopCoding(this.state, id);
  }
  async reconcile(actor: Actor, id: string, key: string) {
    assertOwner(actor);
    const { task } = await codingTaskFor(this.store.db, id);
    if (!task.runId)
      throw new DomainError("INVALID_TRANSITION", "Coding task has no uncertain execution", 409);
    await this.state.foundation.reconcile(actor, task.runId, key);
    return (await codingTaskFor(this.store.db, id)).task;
  }
}
