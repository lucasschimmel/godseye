import {
  AGENT_DEFAULTS,
  AGENT_TOOL_DESTINATION,
  AGENT_TOOL_NAMES,
  AgentOverview,
  type ExecutionAdapter,
} from "@godseye/contracts";
import { type DatabaseAccess, type Store, schema } from "@godseye/store";
import { desc, eq, sql } from "drizzle-orm";
import { chatCreate, chatDetail, chatList, chatSend } from "./agents-chat.js";
import { chatArtifact, chatOutputs, chatResolve } from "./agents-chat-outputs.js";
import { readChatEvents } from "./agents-chat-state.js";
import {
  executeAgent,
  reconcileAgent,
  stopAgentExecution,
  stopAgentTask,
} from "./agents-execution.js";
import { configureAgentProfile, createAgentProfile, pauseAgentProfile } from "./agents-profiles.js";
import { launchAgentTask } from "./agents-runs.js";
import {
  AGENT_TERMINAL,
  AGENTS_ADAPTER_ID,
  type AgentOptions,
  type AgentState,
  currentProfile,
  event,
  profileFor,
  profileView,
  taskDetail,
  taskFor,
  taskView,
} from "./agents-state.js";
import { taskToolArtifacts } from "./agents-tools-artifacts.js";
import { stopTaskTools, taskToolsDetail } from "./agents-tools-lifecycle.js";
import { DomainError } from "./errors.js";
import {
  currentEpoch,
  foundationState,
  recordRequest,
  requestFor,
  runFor,
} from "./foundation-data.js";
import type { FoundationEngine } from "./foundations.js";
import { appendAudit, fingerprint, write } from "./journal.js";
import { assertOrchestrationTask } from "./orchestration-authority.js";
import type { DelegatedTask } from "./orchestration-delegation.js";
import { type Actor, assertOwner } from "./policy.js";

export type * from "./agents-provider.js";
export type { AgentOptions } from "./agents-state.js";
export { AGENTS_ADAPTER_ID } from "./agents-state.js";

/** Owner Agent Center metadata/admission; execution is consumed only by the shared Foundation worker. */
export class AgentEngine {
  private state!: AgentState;
  readonly adapter: ExecutionAdapter;
  constructor(
    private readonly store: Store,
    private readonly options: AgentOptions = {},
  ) {
    const poll = options.pollMs ?? AGENT_DEFAULTS.pollMs;
    if (!Number.isSafeInteger(poll) || poll < 1 || poll > 30000)
      throw new Error("Invalid Hermes polling policy");
    this.adapter = {
      id: AGENTS_ADAPTER_ID,
      qualified: options.provider?.qualified ?? false,
      execute: (context) => executeAgent(this.state, context),
      reconcile: (context) => reconcileAgent(this.state, context),
      onFenced: (context) => stopAgentExecution(this.state, context),
    };
  }
  bind(foundation: FoundationEngine) {
    this.state = {
      store: this.store,
      foundation,
      request: foundationState(this.store, { now: this.options.now }),
      now: this.options.now ?? (() => new Date()),
      provider: this.options.provider,
      toolExecutor: this.options.toolExecutor,
      pollMs: this.options.pollMs ?? AGENT_DEFAULTS.pollMs,
      timeoutMs: this.options.timeoutMs ?? ((seconds) => seconds * 1000),
      calls: new Map(),
      stops: new Map(),
      aborts: new Map(),
    };
  }
  chatList(actor: Actor) {
    return chatList(this.state, actor);
  }
  chatCreate(actor: Actor, input: unknown, key: string) {
    return chatCreate(this.state, actor, input, key);
  }
  chatDetail(actor: Actor, id: string) {
    return chatDetail(this.state, actor, id);
  }
  chatSend(actor: Actor, id: string, input: unknown, key: string) {
    return chatSend(this.state, actor, id, input, key);
  }
  chatEvents(actor: Actor, id: string, after: number) {
    return readChatEvents(this.state, actor, id, after);
  }
  chatArtifact(actor: Actor, id: string) {
    return chatArtifact(this.state, actor, id);
  }
  chatResolve(actor: Actor, id: string, input: unknown, key: string) {
    return chatResolve(this.state, actor, id, input, key);
  }
  createProfile(actor: Actor, input: unknown, key: string) {
    return createAgentProfile(this.state, actor, input, key);
  }
  configureProfile(actor: Actor, id: string, input: unknown, key: string) {
    return configureAgentProfile(this.state, actor, id, input, key);
  }
  pause(actor: Actor, id: string, input: unknown, key: string) {
    return pauseAgentProfile(this.state, actor, id, input, key, true);
  }
  resume(actor: Actor, id: string, input: unknown, key: string) {
    return pauseAgentProfile(this.state, actor, id, input, key, false);
  }
  launch(actor: Actor, input: unknown, key: string) {
    return launchAgentTask(this.state, actor, input, key);
  }
  launchDelegated(actor: Actor, input: unknown, key: string, delegated: DelegatedTask) {
    return launchAgentTask(this.state, actor, input, key, undefined, undefined, delegated);
  }
  detail(actor: Actor, id: string) {
    return taskDetail(this.state, actor, id);
  }
  toolsDetail(actor: Actor, id: string) {
    return taskToolsDetail(this.state, actor, id);
  }
  async overview(actor: Actor) {
    assertOwner(actor);
    const profiles = await this.store.db
      .select()
      .from(schema.agentProfiles)
      .orderBy(desc(schema.agentProfiles.createdAt))
      .limit(AGENT_DEFAULTS.maxProfiles);
    const live = await this.store.db
      .select({ id: schema.agentTasks.id, profileId: schema.agentTasks.profileId })
      .from(schema.agentTasks)
      .where(sql`${schema.agentTasks.state} NOT IN ('succeeded','failed','cancelled')`);
    const busy = new Map(live.map((t) => [t.profileId, t.id]));
    const tasks = await this.store.db
      .select()
      .from(schema.agentTasks)
      .orderBy(desc(schema.agentTasks.createdAt))
      .limit(100);
    const available = this.options.provider?.qualified ?? false;
    return AgentOverview.parse({
      status: available ? "available" : "unconfigured",
      message: available
        ? "Private local Hermes provider configured; task tools require an explicit owner grant and isolated runtime preflight"
        : "Hermes provider is unconfigured; scoped profiles can be prepared but tasks cannot launch",
      profiles: profiles.map((p) => profileView(this.state, p, busy.get(p.id) ?? null)),
      tasks: tasks.map(taskView),
      roles: ["operations", "security", "research-marketing"],
      models: [AGENT_DEFAULTS.model],
      defaults: {
        maxOutputTokens: AGENT_DEFAULTS.maxOutputTokens,
        timeoutSeconds: AGENT_DEFAULTS.timeoutSeconds,
        maxCostMicros: AGENT_DEFAULTS.maxCostMicros,
        maxTurns: 1,
        maxRequests: 1,
      },
      tools: this.options.toolExecutor?.qualified ? [...AGENT_TOOL_NAMES] : [],
    });
  }
  async reserve(
    tx: DatabaseAccess,
    plan: typeof schema.executionPlans.$inferSelect,
    runId: string,
  ) {
    if (plan.adapterId !== AGENTS_ADAPTER_ID) return;
    if (plan.command.kind !== "agent.run")
      throw new DomainError("FORBIDDEN", "Invalid Hermes plan", 403);
    const task = await taskFor(tx, plan.command.inputRef);
    const profile = await profileFor(tx, task.profileId);
    await currentProfile(this.state, tx, profile);
    if (
      task.cancelRequested ||
      task.runId ||
      task.profileRevision !== profile.revision ||
      task.profileSnapshot.hash !== profile.hash ||
      task.projectId !== plan.projectId ||
      task.environmentId !== plan.environmentId ||
      plan.command.profileId !== profile.id ||
      plan.command.skillVersionId !== profile.skillRef ||
      plan.command.grantRef !== profile.grantRef ||
      plan.maxCostMicros !== profile.limits.maxCostMicros ||
      plan.targetId !== profile.environmentId ||
      fingerprint(plan.tools) !==
        fingerprint(["agent.model", ...(task.toolGrant?.policy.tools ?? [])]) ||
      fingerprint(plan.destinations) !==
        fingerprint(["api.openai.com", ...(task.toolGrant ? [AGENT_TOOL_DESTINATION] : [])])
    )
      throw new DomainError("FENCED", "Hermes admission does not match its immutable task", 409);
    await tx
      .update(schema.agentTasks)
      .set({ runId, updatedAt: this.state.now() })
      .where(eq(schema.agentTasks.id, task.id));
  }
  async settlement(tx: DatabaseAccess, runId: string, status: string) {
    const [task] = await tx
      .select()
      .from(schema.agentTasks)
      .where(eq(schema.agentTasks.runId, runId));
    if (!task) return;
    const terminal = status !== "unknown";
    let revoked = task.cancelRequested;
    try {
      await assertOrchestrationTask(tx, task.id, this.state.now);
    } catch (error) {
      if (!(error instanceof DomainError)) throw error;
      revoked = true;
    }
    if (status === "succeeded" && !revoked) {
      try {
        const profile = await profileFor(tx, task.profileId);
        await currentProfile(this.state, tx, profile);
        const { run } = await runFor(tx, runId);
        revoked =
          profile.hash !== task.profileSnapshot.hash ||
          run.epoch !== (await currentEpoch(tx, task.environmentId));
      } catch (error) {
        if (!(error instanceof DomainError)) throw error;
        revoked = true;
      }
    }
    const next = terminal
      ? revoked || task.state === "cancelled"
        ? "cancelled"
        : status
      : task.cancelRequested
        ? "cancel_requested"
        : "unknown";
    await tx
      .update(schema.agentTasks)
      .set({
        state: next,
        finishedAt: terminal ? this.state.now() : null,
        ...(revoked ? { cancelRequested: true, output: null } : {}),
        updatedAt: this.state.now(),
      })
      .where(eq(schema.agentTasks.id, task.id));
    await event(this.state, tx, task.id, next);
    if (next === "succeeded") {
      const settledTask = await taskFor(tx, task.id);
      await chatOutputs(this.state, tx, settledTask);
      await taskToolArtifacts(this.state, tx, settledTask);
    }
    if (terminal)
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
      operation?.errorCode === "ACTIVATION_FENCED" ||
      operation?.errorCode === "CANCELLED_WITH_UNCERTAIN_EFFECT"
    ) {
      // Shared Foundation entry points preserve logical stop before any read-only recovery.
      await tx
        .update(schema.agentTasks)
        .set({ cancelRequested: true, reason: operation.errorCode, output: null })
        .where(eq(schema.agentTasks.runId, runId));
    }
    return this.settlement(tx, runId, "unknown");
  }
  async releaseQueued(tx: DatabaseAccess, runId: string) {
    const [task] = await tx
      .select()
      .from(schema.agentTasks)
      .where(eq(schema.agentTasks.runId, runId));
    if (!task) return;
    const [operation] = await tx
      .select()
      .from(schema.operations)
      .where(eq(schema.operations.id, runId));
    const next = operation?.status === "cancelled" ? "cancelled" : "failed";
    await tx
      .update(schema.agentTasks)
      .set({
        state: next,
        reason: operation?.errorCode ?? null,
        finishedAt: this.state.now(),
        updatedAt: this.state.now(),
      })
      .where(eq(schema.agentTasks.id, task.id));
    await event(this.state, tx, task.id, next);
    await tx
      .update(schema.foundationRequests)
      .set({ terminalAt: this.state.now() })
      .where(eq(schema.foundationRequests.resourceId, task.id));
  }
  async cancel(actor: Actor, id: string, key: string) {
    assertOwner(actor);
    const task = await write(this.store, async (tx) => {
      const receipt = await requestFor(tx, actor, key, "agent.cancel", { id });
      const row = await taskFor(tx, id);
      if (receipt.existing || AGENT_TERMINAL.includes(row.state)) return row;
      const status = row.runId ? "cancel_requested" : "cancelled";
      await tx
        .update(schema.agentTasks)
        .set({
          cancelRequested: true,
          state: status,
          updatedAt: this.state.now(),
          finishedAt: row.runId ? null : this.state.now(),
        })
        .where(eq(schema.agentTasks.id, id));
      await event(this.state, tx, id, status);
      if (!row.runId)
        await tx
          .update(schema.foundationRequests)
          .set({ terminalAt: this.state.now() })
          .where(eq(schema.foundationRequests.resourceId, id));
      await recordRequest(tx, this.state.request, key, receipt.digest, id, "agent.cancel");
      await appendAudit(
        tx,
        actor,
        row.projectId,
        "agent.task.cancel_requested",
        `Requested protective stop for task ${id}`,
      );
      return taskFor(tx, id);
    });
    if (task.runId && !AGENT_TERMINAL.includes(task.state)) {
      await this.state.foundation.cancel(actor, task.runId, `agent-cancel:${id}`);
      this.state.aborts.get(id)?.abort();
      if (task.submissionIntended && this.options.provider) {
        await stopAgentTask(this.state, await taskFor(this.store.db, id));
      }
      await stopTaskTools(this.state, await taskFor(this.store.db, id));
    }
    return taskView(await taskFor(this.store.db, id));
  }
  async stopDelegated(id: string) {
    this.state.aborts.get(id)?.abort();
    const task = await taskFor(this.store.db, id);
    if (task.submissionIntended && this.options.provider) await stopAgentTask(this.state, task);
    await stopTaskTools(this.state, task);
  }
  async reconcile(actor: Actor, id: string, key: string) {
    assertOwner(actor);
    const task = await taskFor(this.store.db, id);
    if (!task.runId)
      throw new DomainError("INVALID_TRANSITION", "Task has no uncertain execution", 409);
    await this.state.foundation.reconcile(actor, task.runId, key);
    return taskView(await taskFor(this.store.db, id));
  }
}
