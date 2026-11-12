import { schema } from "@godseye/store";
import { and, eq, inArray, isNotNull } from "drizzle-orm";
import { runFor } from "./foundation-data.js";
import { HANDLER_UNAVAILABLE_EVIDENCE } from "./jobs-execution.js";
import type { JobState } from "./jobs-state.js";
import { write } from "./journal.js";

type JobRow = typeof schema.jobRuns.$inferSelect;
type Change = Partial<typeof schema.jobRuns.$inferInsert>;
const NEVER_EXECUTED = new Set([HANDLER_UNAVAILABLE_EVIDENCE]);
const LIVE: JobRow["state"][] = ["queued", "running", "cancel_requested", "unknown", "reconciling"];

/** Failed attempts are retried only when replay is safe by policy or the effect provably never started. */
function retryable(
  job: JobRow,
  definition: typeof schema.jobDefinitions.$inferSelect,
  executed: boolean,
  unknown: boolean,
) {
  if (job.attempt >= definition.limits.maxAttempts) return false;
  if (definition.effectPolicy === "protected") return !executed && !unknown;
  return true;
}
function decide(
  job: JobRow,
  definition: typeof schema.jobDefinitions.$inferSelect,
  operation: { status: string; errorCode: string | null },
  executed: boolean,
  fenced: boolean,
  now: Date,
): Change | null {
  const status = operation.status;
  if (job.state === "cancel_requested") {
    if (status === "cancelled" || (fenced && status !== "running"))
      return {
        state: "cancelled",
        finishedAt: now,
        reason: status === "cancelled" ? job.reason : "CANCELLED_FENCED_EFFECT_UNKNOWN",
      };
    return null;
  }
  switch (status) {
    case "running":
      return job.state === "running" ? null : { state: "running", startedAt: job.startedAt ?? now };
    case "succeeded":
      return { state: "succeeded", finishedAt: now, reason: null };
    case "cancelled":
      return { state: "cancelled", finishedAt: now };
    case "reconciling":
      return job.state === "reconciling" ? null : { state: "reconciling" };
    case "failed":
    case "unknown": {
      const unknown = status === "unknown";
      if (retryable(job, definition, executed, unknown))
        return {
          state: "queued",
          runId: null,
          attempt: job.attempt + 1,
          reason: `RETRY_AFTER_${operation.errorCode ?? (unknown ? "UNKNOWN" : "FAILED")}`,
          startedAt: null,
        };
      if (unknown)
        return job.state === "unknown" ? null : { state: "unknown", reason: operation.errorCode };
      return {
        state: "failed",
        finishedAt: now,
        reason: operation.errorCode ?? "EXECUTION_FAILED",
      };
    }
    default:
      return job.state === "queued" ? null : { state: "queued" };
  }
}
async function syncOne(state: JobState, jobId: string) {
  return write(state.store, async (tx) => {
    const [job] = await tx.select().from(schema.jobRuns).where(eq(schema.jobRuns.id, jobId));
    if (!job?.runId || !LIVE.includes(job.state)) return false;
    const { run, operation } = await runFor(tx, job.runId);
    const [definition] = await tx
      .select()
      .from(schema.jobDefinitions)
      .where(eq(schema.jobDefinitions.id, job.definitionId));
    const [effect] = await tx
      .select()
      .from(schema.effects)
      .where(eq(schema.effects.runId, job.runId));
    if (!definition) return false;
    const executed = !!effect && !NEVER_EXECUTED.has(effect.evidenceRef ?? "");
    const fenced = !run.leaseExpiresAt && !state.aborts.has(job.runId);
    const change = decide(job, definition, operation, executed, fenced, state.now());
    if (!change) return false;
    await tx
      .update(schema.jobRuns)
      .set({ ...change, updatedAt: state.now() })
      .where(and(eq(schema.jobRuns.id, job.id), eq(schema.jobRuns.state, job.state)));
    return true;
  });
}
/** Job state is derived from the single Foundation journal; this engine never builds a second queue. */
export async function syncJobRuns(state: JobState) {
  const rows = await state.store.db
    .select({ id: schema.jobRuns.id })
    .from(schema.jobRuns)
    .where(and(isNotNull(schema.jobRuns.runId), inArray(schema.jobRuns.state, LIVE)));
  let changed = 0;
  for (const row of rows) if (await syncOne(state, row.id)) changed++;
  return changed;
}
