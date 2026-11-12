import { randomUUID } from "node:crypto";
import {
  CancelJobRun,
  type JobRunView,
  TriggerJob,
  type TriggerJobInput,
} from "@godseye/contracts";
import { type DatabaseAccess, schema } from "@godseye/store";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { DomainError, parseInput } from "./errors.js";
import { recordRequest, requestFor } from "./foundation-data.js";
import {
  activeCell,
  assertJobsConfigured,
  definitionFor,
  JOB_TERMINAL_STATES,
  type JobState,
  jobRunFor,
  runView,
} from "./jobs-state.js";
import { appendAudit, write } from "./journal.js";
import { type Actor, assertOwner, assertProjectAccess } from "./policy.js";

export interface NewRun {
  definition: typeof schema.jobDefinitions.$inferSelect;
  trigger: "cron" | "event" | "manual";
  dedupeKey: string;
  scheduledFor: Date;
  payloadRef?: string | null;
}
/** The unique (definition, dedupeKey) boundary makes duplicate ticks, events and triggers collapse to one run. */
export async function createRun(state: JobState, tx: DatabaseAccess, input: NewRun) {
  const now = state.now();
  const inserted = await tx
    .insert(schema.jobRuns)
    .values({
      id: randomUUID(),
      definitionId: input.definition.id,
      projectId: input.definition.projectId,
      environmentId: input.definition.environmentId,
      runId: null,
      state: "queued",
      trigger: input.trigger,
      dedupeKey: input.dedupeKey,
      payloadRef: input.payloadRef ?? null,
      attempt: 1,
      scheduledFor: input.scheduledFor,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing()
    .returning();
  const created = inserted[0];
  if (created) return { row: created, created: true };
  const [existing] = await tx
    .select()
    .from(schema.jobRuns)
    .where(
      and(
        eq(schema.jobRuns.definitionId, input.definition.id),
        eq(schema.jobRuns.dedupeKey, input.dedupeKey),
      ),
    );
  if (
    !existing ||
    existing.trigger !== input.trigger ||
    (existing.payloadRef ?? null) !== (input.payloadRef ?? null)
  )
    throw new DomainError(
      "IDEMPOTENCY_CONFLICT",
      "This dedupe key already identifies a different run",
      409,
    );
  return { row: existing, created: false };
}
function assertHandler(state: JobState, handler: string) {
  assertJobsConfigured(state);
  if (!state.handlers?.has(handler))
    throw new DomainError(
      "CAPABILITY_UNAVAILABLE",
      "Job handler is not registered in the engine",
      503,
    );
}
export async function triggerJob(
  state: JobState,
  actor: Actor,
  id: string,
  input: TriggerJobInput,
  key: string,
): Promise<JobRunView> {
  assertOwner(actor);
  const data = parseInput(TriggerJob, input);
  return write(state.store, async (tx) => {
    const receipt = await requestFor(tx, actor, key, "job.trigger", { id, ...data });
    if (receipt.existing) return runView(await jobRunFor(tx, actor, receipt.existing.resourceId));
    const definition = await definitionFor(tx, actor, id);
    if (definition.revision !== data.expectedRevision)
      throw new DomainError("REVISION_CONFLICT", "Job definition changed", 409);
    if (definition.paused)
      throw new DomainError("DEFINITION_PAUSED", "Paused jobs cannot be triggered", 409);
    assertHandler(state, definition.handler);
    await activeCell(state, tx, actor, definition.projectId, definition.environmentId);
    const { row, created } = await createRun(state, tx, {
      definition,
      trigger: "manual",
      dedupeKey: data.dedupeKey,
      scheduledFor: state.now(),
      payloadRef: data.payloadRef,
    });
    await recordRequest(tx, state.request, key, receipt.digest, row.id, "job.trigger");
    if (created)
      await appendAudit(
        tx,
        actor,
        row.projectId,
        "job.triggered",
        `Queued manual run of ${definition.name}; durable intent precedes any dispatch`,
      );
    return runView(row);
  });
}
const EventInput = z
  .object({
    projectId: z.string().uuid(),
    environmentId: z.string().uuid(),
    eventType: z.string().regex(/^[a-z][a-z0-9.-]{0,63}$/),
    eventId: z.string().min(8).max(120),
    payloadRef: z.string().uuid().optional(),
  })
  .strict();
export type JobEventInput = z.infer<typeof EventInput>;
/** Internal control-side ingestion; events only match definitions registered in the stated cell. */
export async function ingestJobEvent(state: JobState, actor: Actor, input: JobEventInput) {
  const data = parseInput(EventInput, input);
  assertProjectAccess(actor, data.projectId);
  assertJobsConfigured(state);
  return write(state.store, async (tx) => {
    await activeCell(state, tx, actor, data.projectId, data.environmentId);
    const definitions = await tx
      .select()
      .from(schema.jobDefinitions)
      .where(
        and(
          eq(schema.jobDefinitions.projectId, data.projectId),
          eq(schema.jobDefinitions.environmentId, data.environmentId),
        ),
      );
    const runs: JobRunView[] = [];
    for (const definition of definitions) {
      if (
        definition.paused ||
        definition.trigger.kind !== "event" ||
        definition.trigger.eventType !== data.eventType ||
        !state.handlers?.has(definition.handler)
      )
        continue;
      const { row } = await createRun(state, tx, {
        definition,
        trigger: "event",
        dedupeKey: `event:${data.eventId}`,
        scheduledFor: state.now(),
        payloadRef: data.payloadRef,
      });
      runs.push(runView(row));
    }
    return runs;
  });
}
/** Queued work cancels immediately; started work is fenced first and only then reported cancelled. */
export async function cancelJobRun(
  state: JobState,
  actor: Actor,
  id: string,
  input: { reason: string },
  key: string,
): Promise<JobRunView> {
  assertOwner(actor);
  const data = parseInput(CancelJobRun, input);
  const before = await write(state.store, async (tx) => {
    const receipt = await requestFor(tx, actor, key, "job.cancel", { id, ...data });
    const row = await jobRunFor(tx, actor, id);
    if (receipt.existing) return { row, replay: true };
    if ((JOB_TERMINAL_STATES as readonly string[]).includes(row.state))
      throw new DomainError("INVALID_TRANSITION", "Run is already terminal", 409);
    const now = state.now();
    const queued = row.state === "queued" && !row.runId;
    await tx
      .update(schema.jobRuns)
      .set({
        state: queued ? "cancelled" : "cancel_requested",
        finishedAt: queued ? now : null,
        reason: data.reason,
        updatedAt: now,
      })
      .where(eq(schema.jobRuns.id, id));
    await recordRequest(tx, state.request, key, receipt.digest, id, "job.cancel");
    await appendAudit(
      tx,
      actor,
      row.projectId,
      "job.cancel_requested",
      `Cancel requested for ${id}`,
    );
    return { row, replay: false };
  });
  if (!before.replay && before.row.runId) {
    state.aborts.get(before.row.runId)?.abort();
    await state.foundation.cancel(actor, before.row.runId, `job-cancel:${before.row.runId}`);
  }
  return runView(await jobRunFor(state.store.db, actor, id));
}
