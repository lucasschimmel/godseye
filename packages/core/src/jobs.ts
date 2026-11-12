import { setTimeout as wait } from "node:timers/promises";
import type { ApplicationJobEnvelopeInput } from "@godseye/contracts";
import {
  type CreateExecutionPlanInput,
  type ExecutionContext,
  type JobRunView,
  JobsOverview,
  type ReconcileJobRunInput,
  type ReconcileOutboxInput,
  type RegisterJobDefinitionInput,
  type TriggerJobInput,
} from "@godseye/contracts";
import { type DatabaseAccess, type Store, schema } from "@godseye/store";
import { desc } from "drizzle-orm";
import { foundationState } from "./foundation-data.js";
import type { FoundationEngine } from "./foundations.js";
import {
  type ApplicationEventAuthority,
  applicationCellLifecycle,
  applicationEventAccepted,
  applicationEventRuns,
  applicationEventSettled,
  ingestApplicationEvent,
  triggerInngestCron,
} from "./jobs-application.js";
import { jobsDelegatedAuthority } from "./jobs-authority.js";
import { changeJobPause, registerJobDefinition } from "./jobs-definitions.js";
import { executeJob, fenceJob } from "./jobs-execution.js";
import { enqueueOutbox, type OutboxWrite, reconcileOutbox } from "./jobs-outbox.js";
import { reconcileJobRun } from "./jobs-reconcile.js";
import { cancelJobRun, ingestJobEvent, type JobEventInput, triggerJob } from "./jobs-runs.js";
import { jobsTick } from "./jobs-scheduler.js";
import {
  definitionView,
  heldEnvironmentIds,
  JOBS_ADAPTER_ID,
  type JobHandler,
  type JobState,
  jobsConfigured,
  type OutboxSender,
  outboxView,
  runView,
} from "./jobs-state.js";
import { write } from "./journal.js";
import { type Actor, assertOwner } from "./policy.js";

export type { ApplicationEventAuthority } from "./jobs-application.js";
export { nextCronFire, parseCron } from "./jobs-cron.js";
export type { OutboxWrite } from "./jobs-outbox.js";
export type { JobEventInput } from "./jobs-runs.js";
export type * from "./jobs-state.js";
export { definitionView, JOBS_ADAPTER_ID, JOBS_DESTINATION } from "./jobs-state.js";

export interface JobOptions {
  /** Owner API metadata/admission only; the independent supervisor consumes and reconciles work. */
  detached?: boolean;
  /** Explicit supervisor partition. Missing preserves the legacy single-consumer behavior. */
  managedEnvironmentIds?: ReadonlySet<string>;
  now: () => Date;
  /** Explicit local fixture handlers; absent means the engine is unconfigured. */
  handlers?: ReadonlyMap<string, JobHandler>;
  /** Explicit local fixture outbox destinations. */
  senders?: ReadonlyMap<string, OutboxSender>;
  timeoutMs?: (seconds: number) => number;
  dispatchTimeoutMs?: number;
  maxOutboxAttempts?: number;
  /** These cells have exactly one calendar: their registered Inngest cron functions. */
  inngestEnvironmentIds?: ReadonlySet<string>;
  /** Loads payload from the source cell's private store; never from the shared control database. */
  applicationEventLoader?: (
    authority: ApplicationEventAuthority,
    eventId: string,
  ) => Promise<ApplicationJobEnvelopeInput | undefined>;
}
const UNCONFIGURED =
  "Durable job engine is unconfigured: definitions are retained but nothing schedules, runs or dispatches";
const FIXTURE =
  "Explicit local fixture handlers are injected; this is not a deployed Inngest, Redis or worker runtime";
const MAX_TIMER_DELAY_MS = 2_147_483_647;
const DEFAULT_DISPATCH_TIMEOUT_MS = 60_000;
/** Per-cell durable jobs and transactional outbox composed on the existing Foundation queue. */
export class JobEngine {
  private state!: JobState;
  constructor(
    private readonly store: Store,
    private readonly options: JobOptions,
  ) {
    const timeout = options.dispatchTimeoutMs ?? DEFAULT_DISPATCH_TIMEOUT_MS;
    if (!Number.isSafeInteger(timeout) || timeout <= 0 || timeout > MAX_TIMER_DELAY_MS)
      throw new Error("Invalid outbox dispatch deadline");
  }
  bind(foundation: FoundationEngine) {
    this.state = {
      store: this.store,
      managedEnvironmentIds: this.options.managedEnvironmentIds,
      detached: this.options.detached,
      now: this.options.now,
      foundation,
      request: foundationState(this.store, { now: this.options.now }),
      handlers: this.options.handlers,
      senders: this.options.senders,
      timeoutMs: this.options.timeoutMs ?? ((seconds) => seconds * 1000),
      dispatchTimeoutMs: this.options.dispatchTimeoutMs ?? DEFAULT_DISPATCH_TIMEOUT_MS,
      maxOutboxAttempts: this.options.maxOutboxAttempts ?? 5,
      aborts: new Map(),
      outboxCalls: new Set(),
      inngestEnvironmentIds: new Set(this.options.inngestEnvironmentIds),
      applicationEventLoader: this.options.applicationEventLoader,
      applicationPayloadLoads: new Map(),
    };
  }
  get adapter() {
    const self = this;
    return {
      id: JOBS_ADAPTER_ID,
      get qualified() {
        return !!self.options.handlers || !!self.options.detached;
      },
      execute: (context: ExecutionContext) => executeJob(self.state, context),
      reconcile: (context: ExecutionContext) => executeJob(self.state, context, true),
      onFenced: (context: ExecutionContext) => fenceJob(self.state, context),
    };
  }
  delegatedAuthority(
    tx: DatabaseAccess,
    plan: CreateExecutionPlanInput,
    phase: "create" | "enqueue" | "approval",
    actor?: Actor,
  ) {
    return jobsDelegatedAuthority(this.state, tx, plan, phase, actor);
  }
  registerDefinition(actor: Actor, input: RegisterJobDefinitionInput, key: string) {
    return registerJobDefinition(this.state, actor, input, key);
  }
  pause(actor: Actor, id: string, expectedRevision: number, key: string) {
    return changeJobPause(this.state, actor, id, expectedRevision, true, key);
  }
  resume(actor: Actor, id: string, expectedRevision: number, key: string) {
    return changeJobPause(this.state, actor, id, expectedRevision, false, key);
  }
  trigger(actor: Actor, id: string, input: TriggerJobInput, key: string) {
    return triggerJob(this.state, actor, id, input, key);
  }
  cancel(actor: Actor, id: string, input: { reason: string }, key: string) {
    return cancelJobRun(this.state, actor, id, input, key);
  }
  /** Control-side event ingestion; the application backend is not coupled to this path yet. */
  ingestEvent(actor: Actor, input: JobEventInput) {
    return ingestJobEvent(this.state, actor, input);
  }
  ingestApplicationEvent(authority: ApplicationEventAuthority, input: ApplicationJobEnvelopeInput) {
    return ingestApplicationEvent(this.state, authority, input);
  }
  applicationEventRuns(authority: ApplicationEventAuthority, input: ApplicationJobEnvelopeInput) {
    return applicationEventRuns(this.state, authority, input);
  }
  applicationEventAccepted(
    authority: ApplicationEventAuthority,
    input: ApplicationJobEnvelopeInput,
  ) {
    return applicationEventAccepted(this.state, authority, input);
  }
  applicationEventSettled(
    authority: ApplicationEventAuthority,
    input: ApplicationJobEnvelopeInput,
  ) {
    return applicationEventSettled(this.state, authority, input);
  }
  triggerInngestCron(
    authority: ApplicationEventAuthority,
    definitionId: string,
    hash: string,
    eventId: string,
  ) {
    return triggerInngestCron(this.state, authority, definitionId, hash, eventId);
  }
  cellLifecycle(authority: ApplicationEventAuthority) {
    return applicationCellLifecycle(this.state, authority);
  }
  /** Writes an intent inside the caller's transaction so it commits with the business change. */
  enqueueOutbox(tx: DatabaseAccess, input: OutboxWrite) {
    return enqueueOutbox(this.state, tx, input);
  }
  transact<T>(work: (tx: DatabaseAccess) => Promise<T>) {
    return write(this.store, work);
  }
  reconcileOutbox(actor: Actor, id: string, input: ReconcileOutboxInput, key: string) {
    return reconcileOutbox(this.state, actor, id, input, key);
  }
  /** Owner-driven reconciliation of an unknown run through the Foundation journal and the handler probe. */
  reconcileRun(
    actor: Actor,
    id: string,
    input: ReconcileJobRunInput,
    key: string,
  ): Promise<JobRunView> {
    return reconcileJobRun(this.state, actor, id, input, key);
  }
  tick(signal?: AbortSignal) {
    return jobsTick(this.state, signal);
  }
  async overview(actor: Actor) {
    assertOwner(actor);
    const [definitions, runs, outbox, held] = await Promise.all([
      this.store.db
        .select()
        .from(schema.jobDefinitions)
        .orderBy(schema.jobDefinitions.createdAt)
        .limit(500),
      this.store.db
        .select()
        .from(schema.jobRuns)
        .orderBy(desc(schema.jobRuns.createdAt))
        .limit(200),
      this.store.db
        .select()
        .from(schema.jobOutbox)
        .orderBy(desc(schema.jobOutbox.createdAt))
        .limit(200),
      heldEnvironmentIds(this.store.db, this.options.now()),
    ]);
    const configured = jobsConfigured(this.state);
    return JobsOverview.parse({
      engine: {
        state: configured
          ? this.state.inngestEnvironmentIds.size
            ? "local_inngest"
            : "local_fixture"
          : "unconfigured",
        reason: configured
          ? this.state.inngestEnvironmentIds.size
            ? "Local Inngest cells are configured; Foundation remains the execution authority. This is not a qualified hosted runtime or a live health attestation."
            : FIXTURE
          : UNCONFIGURED,
        heldEnvironmentIds: held,
      },
      definitions: definitions.map(definitionView),
      runs: runs.map(runView),
      outbox: outbox.map(outboxView),
    });
  }
}
export async function runJobScheduler(
  engine: JobEngine,
  options: { signal: AbortSignal; intervalMs?: number },
) {
  while (!options.signal.aborted) {
    await engine.tick(options.signal);
    try {
      await wait(options.intervalMs ?? 1000, undefined, { signal: options.signal });
    } catch (error) {
      if (!(error instanceof Error) || error.name !== "AbortError") throw error;
    }
  }
}
