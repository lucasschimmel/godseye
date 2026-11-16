import {
  ApplicationJobEnvelope,
  type ApplicationJobEnvelopeInput,
  type JobRunView,
} from "@godseye/contracts";
import { type DatabaseAccess, schema } from "@godseye/store";
import { and, eq, inArray, like, or } from "drizzle-orm";
import { DomainError, parseInput } from "./errors.js";
import { currentEpoch } from "./foundation-data.js";
import { createRun } from "./jobs-runs.js";
import {
  activeCell,
  assertJobsConfigured,
  type JobState,
  jobsActor,
  runView,
} from "./jobs-state.js";
import { appendAudit, fingerprint, write } from "./journal.js";

export interface ApplicationEventAuthority {
  projectId: string;
  environmentId: string;
  producerId: string;
}
function validCronEventIdentity(value: string) {
  if (/^[A-Za-z0-9_-]{8,120}$/.test(value)) return true;
  // Inngest 1.52.0 executor/service.go uses UTC.Format(time.RFC3339) for cron event IDs.
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(value)) return false;
  const timestamp = Date.parse(value);
  return (
    Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value.replace("Z", ".000Z")
  );
}
export function applicationCellLifecycle(state: JobState, authority: ApplicationEventAuthority) {
  const scope = structuredClone(authority);
  return write(state.store, async (tx) => {
    await activeCell(state, tx, jobsActor(scope.projectId), scope.projectId, scope.environmentId);
    return { available: true, epoch: await currentEpoch(tx, scope.environmentId) };
  });
}
export function triggerInngestCron(
  state: JobState,
  rawAuthority: ApplicationEventAuthority,
  definitionId: string,
  hash: string,
  eventId: string,
) {
  const authority = structuredClone(rawAuthority);
  if (!validCronEventIdentity(eventId))
    throw new DomainError("INVALID_INPUT", "Invalid Inngest cron event identity", 422);
  return write(state.store, async (tx) => {
    await activeCell(
      state,
      tx,
      jobsActor(authority.projectId),
      authority.projectId,
      authority.environmentId,
    );
    const [definition] = await tx
      .select()
      .from(schema.jobDefinitions)
      .where(eq(schema.jobDefinitions.id, definitionId));
    if (
      !definition ||
      definition.projectId !== authority.projectId ||
      definition.environmentId !== authority.environmentId ||
      definition.trigger.kind !== "cron" ||
      definition.hash !== hash ||
      definition.paused ||
      !state.inngestEnvironmentIds.has(authority.environmentId) ||
      !state.handlers?.has(definition.handler)
    )
      throw new DomainError("FENCED", "Inngest cron registration is no longer current", 409);
    const { row } = await createRun(state, tx, {
      definition,
      trigger: "cron",
      dedupeKey: `inngest:${eventId}`,
      scheduledFor: state.now(),
    });
    return runView(row);
  });
}

async function assertAuthority(
  state: JobState,
  tx: DatabaseAccess,
  authority: ApplicationEventAuthority,
  input: ApplicationJobEnvelopeInput,
) {
  if (
    input.projectId !== authority.projectId ||
    input.environmentId !== authority.environmentId ||
    input.producerId !== authority.producerId
  )
    throw new DomainError("FORBIDDEN", "Application producer is bound to another cell", 403);
  await activeCell(state, tx, jobsActor(input.projectId), input.projectId, input.environmentId);
  if ((await currentEpoch(tx, input.environmentId)) !== input.epoch)
    throw new DomainError("FENCED", "Application event producer epoch is stale", 409);
}
/** Called only behind the dedicated cell's Inngest SDK signature verification, never owner HTTP body authority. */
export function ingestApplicationEvent(
  state: JobState,
  rawAuthority: ApplicationEventAuthority,
  raw: ApplicationJobEnvelopeInput,
): Promise<JobRunView[]> {
  const input = structuredClone(parseInput(ApplicationJobEnvelope, raw));
  if (Buffer.byteLength(JSON.stringify(input)) > 262144)
    throw new DomainError("EVENT_TOO_LARGE", "Application job event exceeds its byte limit", 413);
  const authority = structuredClone(rawAuthority);
  assertJobsConfigured(state);
  return write(state.store, async (tx) => {
    await assertAuthority(state, tx, authority, input);
    const hash = fingerprint(input);
    const [previous] = await tx
      .select()
      .from(schema.applicationJobEvents)
      .where(eq(schema.applicationJobEvents.id, input.id));
    if (previous) {
      if (previous.hash !== hash)
        throw new DomainError(
          "IDEMPOTENCY_CONFLICT",
          "Application event id identifies another payload",
          409,
        );
      if (!previous.runIds.length) return [];
      const rows = await tx
        .select()
        .from(schema.jobRuns)
        .where(inArray(schema.jobRuns.id, previous.runIds));
      return rows.map(runView);
    }
    const definitions = await tx
      .select()
      .from(schema.jobDefinitions)
      .where(
        and(
          eq(schema.jobDefinitions.projectId, input.projectId),
          eq(schema.jobDefinitions.environmentId, input.environmentId),
        ),
      );
    const runs: JobRunView[] = [];
    for (const definition of definitions) {
      if (
        definition.paused ||
        definition.trigger.kind !== "event" ||
        definition.trigger.eventType !== input.eventType ||
        !state.handlers?.has(definition.handler)
      )
        continue;
      const { row } = await createRun(state, tx, {
        definition,
        trigger: "event",
        dedupeKey: `application:${input.id}`,
        payloadRef: input.id,
        scheduledFor: state.now(),
      });
      runs.push(runView(row));
    }
    await tx.insert(schema.applicationJobEvents).values({
      id: input.id,
      ...authority,
      epoch: input.epoch,
      hash,
      runIds: runs.map((run) => run.id),
      createdAt: state.now(),
    });
    await appendAudit(
      tx,
      jobsActor(input.projectId),
      input.projectId,
      "job.application_event",
      `Accepted event ${input.id} for ${runs.length} scoped jobs`,
    );
    return runs;
  });
}

/** Metadata-only acknowledgement. Engine acceptance alone does not acknowledge the source intent. */
export function applicationEventAccepted(
  state: JobState,
  rawAuthority: ApplicationEventAuthority,
  raw: ApplicationJobEnvelopeInput,
) {
  const input = structuredClone(parseInput(ApplicationJobEnvelope, raw));
  const authority = structuredClone(rawAuthority);
  return write(state.store, async (tx) => {
    if (
      input.projectId !== authority.projectId ||
      input.environmentId !== authority.environmentId ||
      input.producerId !== authority.producerId
    )
      throw new DomainError("FORBIDDEN", "Application producer is bound to another cell", 403);
    const [receipt] = await tx
      .select()
      .from(schema.applicationJobEvents)
      .where(eq(schema.applicationJobEvents.id, input.id));
    if (!receipt) return false;
    if (receipt.hash !== fingerprint(input))
      throw new DomainError(
        "IDEMPOTENCY_CONFLICT",
        "Application event id identifies another payload",
        409,
      );
    return true;
  });
}
export async function applicationEventSettled(
  state: JobState,
  authority: ApplicationEventAuthority,
  input: ApplicationJobEnvelopeInput,
) {
  if (!(await applicationEventAccepted(state, authority, input))) return false;
  const [receipt] = await state.store.db
    .select()
    .from(schema.applicationJobEvents)
    .where(eq(schema.applicationJobEvents.id, input.id));
  if (!receipt?.runIds.length) return true;
  const runs = await state.store.db
    .select()
    .from(schema.jobRuns)
    .where(inArray(schema.jobRuns.id, receipt.runIds));
  if (runs.length !== receipt.runIds.length) return false;
  if (
    runs.some(
      (run) =>
        !["succeeded", "failed", "cancelled"].includes(run.state) ||
        run.reason === "CANCELLED_FENCED_EFFECT_UNKNOWN",
    )
  )
    return false;
  // Enqueue receipts retain every attempt, including old unknown idempotent attempts.
  const attempts = await state.store.db
    .select({ id: schema.foundationRequests.resourceId })
    .from(schema.foundationRequests)
    .where(
      or(...receipt.runIds.map((id) => like(schema.foundationRequests.key, `job-enqueue:${id}:%`))),
    );
  const runIds = [
    ...new Set([
      ...runs.flatMap((run) => (run.runId ? [run.runId] : [])),
      ...attempts.map((attempt) => attempt.id),
    ]),
  ];
  if (runIds.length) {
    const uncertain = await state.store.db
      .select({ id: schema.effects.id })
      .from(schema.effects)
      .where(
        and(
          inArray(schema.effects.runId, runIds),
          inArray(schema.effects.status, ["intent", "unknown"]),
        ),
      );
    if (uncertain.length) return false;
  }
  const outbox = await state.store.db
    .select({ id: schema.jobOutbox.id })
    .from(schema.jobOutbox)
    .where(
      and(
        inArray(schema.jobOutbox.jobRunId, receipt.runIds),
        inArray(schema.jobOutbox.state, [
          "pending",
          "dispatching",
          "unknown",
          "reconciling",
          "held",
        ]),
      ),
    );
  return outbox.length === 0;
}

export function applicationEventRuns(
  state: JobState,
  authority: ApplicationEventAuthority,
  event: ApplicationJobEnvelopeInput,
) {
  const input = structuredClone(parseInput(ApplicationJobEnvelope, event));
  const scope = structuredClone(authority);
  return write(state.store, async (tx) => {
    await assertAuthority(state, tx, scope, input);
    const [receipt] = await tx
      .select()
      .from(schema.applicationJobEvents)
      .where(eq(schema.applicationJobEvents.id, input.id));
    if (!receipt || receipt.hash !== fingerprint(input))
      throw new DomainError("NOT_FOUND", "Application job event not found", 404);
    if (!receipt.runIds.length) return [];
    const rows = await tx
      .select()
      .from(schema.jobRuns)
      .where(inArray(schema.jobRuns.id, receipt.runIds));
    // Missing retained history is reported explicitly rather than fabricated success.
    if (rows.length !== receipt.runIds.length)
      throw new DomainError("JOB_HISTORY_PRUNED", "Job result history is no longer retained", 410);
    return rows.map(runView);
  });
}
