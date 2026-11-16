import { schema } from "@godseye/store";
import { and, asc, count, eq } from "drizzle-orm";
import { DomainError } from "./errors.js";
import { nextCronFire } from "./jobs-cron.js";
import { dispatchOutbox, type OutboxTickResult } from "./jobs-outbox.js";
import { consumeJobReconciliations } from "./jobs-reconcile-queue.js";
import { pruneJobs, type RetentionResult } from "./jobs-retention.js";
import { createRun } from "./jobs-runs.js";
import {
  activeRunsFilter,
  dueDefinitions,
  heldEnvironmentIds,
  JOBS_ADAPTER_ID,
  JOBS_DESTINATION,
  JOBS_TOOL,
  type JobState,
  jobEnvironmentFilter,
  jobsActor,
  jobsConfigured,
} from "./jobs-state.js";
import { syncJobRuns } from "./jobs-sync.js";
import { write } from "./journal.js";

export interface JobsTickResult {
  scheduled: number;
  dispatched: number;
  settled: number;
  outbox: OutboxTickResult;
  pruned: RetentionResult;
}
const NO_PRUNE: RetentionResult = { runs: 0, outbox: 0 };
const NO_OUTBOX: OutboxTickResult = { held: 0, recovered: 0, inspected: 0, dispatched: 0 };
const WAITING_CODES = ["RECOVERY_HOLD", "DELIVERY_HOLD", "PROJECT_SUSPENDED", "BUDGET_EXCEEDED"];

/** Each fire is claimed with a compare-and-set on nextFireAt, so duplicate ticks create at most one run. */
async function scheduleCron(state: JobState, held: Set<string>) {
  const due = await state.store.db
    .select()
    .from(schema.jobDefinitions)
    .where(
      and(
        dueDefinitions(state.now()),
        jobEnvironmentFilter(state, schema.jobDefinitions.environmentId),
      ),
    );
  let created = 0;
  for (const definition of due) {
    if (
      definition.trigger.kind !== "cron" ||
      state.inngestEnvironmentIds.has(definition.environmentId) ||
      !definition.nextFireAt ||
      held.has(definition.environmentId) ||
      !state.handlers?.has(definition.handler)
    )
      continue;
    const fire = definition.nextFireAt;
    const cron = definition.trigger.cron;
    created += await write(state.store, async (tx) => {
      const claimed = await tx
        .update(schema.jobDefinitions)
        .set({ nextFireAt: nextCronFire(cron, state.now()), updatedAt: state.now() })
        .where(
          and(
            eq(schema.jobDefinitions.id, definition.id),
            eq(schema.jobDefinitions.nextFireAt, fire),
            eq(schema.jobDefinitions.paused, false),
          ),
        )
        .returning();
      if (claimed.length === 0) return 0;
      const run = await createRun(state, tx, {
        definition,
        trigger: "cron",
        dedupeKey: `cron:${fire.toISOString()}`,
        scheduledFor: fire,
      });
      return run.created ? 1 : 0;
    });
  }
  return created;
}
async function dispatchOne(state: JobState, run: typeof schema.jobRuns.$inferSelect) {
  const actor = jobsActor(run.projectId);
  const [project] = await state.store.db
    .select()
    .from(schema.projects)
    .where(eq(schema.projects.id, run.projectId));
  if (!project) return false;
  const plan = await state.foundation.createPlan(
    actor,
    {
      projectId: run.projectId,
      environmentId: run.environmentId,
      targetId: run.environmentId,
      expectedRevision: project.revision,
      adapterId: JOBS_ADAPTER_ID,
      command: { kind: "job.operation", intent: "trigger", definitionRef: run.definitionId },
      maxCostMicros: 0,
      tools: [JOBS_TOOL],
      destinations: [JOBS_DESTINATION],
    },
    `job-plan:${run.id}:${run.attempt}`,
  );
  const queued = await state.foundation.enqueue(
    actor,
    plan.id,
    `job-enqueue:${run.id}:${run.attempt}`,
  );
  await write(state.store, async (tx) => {
    await tx
      .update(schema.jobRuns)
      .set({ runId: queued.id, reason: null, updatedAt: state.now() })
      .where(and(eq(schema.jobRuns.id, run.id), eq(schema.jobRuns.attempt, run.attempt)));
  });
  return true;
}
async function failDispatch(state: JobState, id: string, error: DomainError) {
  const waiting = WAITING_CODES.includes(error.code);
  await write(state.store, async (tx) => {
    await tx
      .update(schema.jobRuns)
      .set({
        state: waiting ? "queued" : "failed",
        finishedAt: waiting ? null : state.now(),
        reason: error.code,
        updatedAt: state.now(),
      })
      .where(and(eq(schema.jobRuns.id, id), eq(schema.jobRuns.state, "queued")));
  });
}
/** Bounded concurrency is checked per definition before any durable plan is created. */
async function dispatchRuns(state: JobState, held: Set<string>) {
  const queued = await state.store.db
    .select()
    .from(schema.jobRuns)
    .where(
      and(
        eq(schema.jobRuns.state, "queued"),
        jobEnvironmentFilter(state, schema.jobRuns.environmentId),
      ),
    )
    .orderBy(asc(schema.jobRuns.createdAt));
  let dispatched = 0;
  for (const run of queued) {
    if (run.runId || held.has(run.environmentId)) continue;
    const [definition] = await state.store.db
      .select()
      .from(schema.jobDefinitions)
      .where(eq(schema.jobDefinitions.id, run.definitionId));
    if (!definition || definition.paused || !state.handlers?.has(definition.handler)) continue;
    const [active] = await state.store.db
      .select({ total: count() })
      .from(schema.jobRuns)
      .where(activeRunsFilter(definition.id, definition.effectPolicy === "protected"));
    if ((active?.total ?? 0) >= definition.limits.maxConcurrent) continue;
    try {
      if (await dispatchOne(state, run)) dispatched++;
    } catch (error) {
      if (!(error instanceof DomainError)) throw error;
      await failDispatch(state, run.id, error);
    }
  }
  return dispatched;
}
/** One scheduler iteration. An unconfigured engine performs no work and reports none. */
export async function jobsTick(state: JobState, signal?: AbortSignal): Promise<JobsTickResult> {
  if (!jobsConfigured(state) || state.detached)
    return { scheduled: 0, dispatched: 0, settled: 0, outbox: NO_OUTBOX, pruned: NO_PRUNE };
  const held = new Set(await heldEnvironmentIds(state.store.db, state.now()));
  await consumeJobReconciliations(state);
  const scheduled = state.handlers ? await scheduleCron(state, held) : 0;
  const dispatched = state.handlers ? await dispatchRuns(state, held) : 0;
  const settled = await syncJobRuns(state);
  const outbox = await dispatchOutbox(state, signal);
  const pruned = await pruneJobs(state);
  return { scheduled, dispatched, settled, outbox, pruned };
}
