import { schema } from "@godseye/store";
import { and, eq, inArray, isNull, lt, ne, or } from "drizzle-orm";
import { JOB_TERMINAL_STATES, type JobState, jobEnvironmentFilter } from "./jobs-state.js";
import { write } from "./journal.js";

const DAY_MS = 86_400_000;
const BATCH = 200;
const OUTBOX_SETTLED = ["delivered", "failed"] as const;

export interface RetentionResult {
  runs: number;
  outbox: number;
}
type Definition = typeof schema.jobDefinitions.$inferSelect;

/** Outbox rows carry no definition; the longest retention declared in their cell is the safe bound. */
function cellRetention(definitions: Definition[]) {
  const days = new Map<string, number>();
  for (const definition of definitions)
    days.set(
      definition.environmentId,
      Math.max(days.get(definition.environmentId) ?? 0, definition.limits.retentionDays),
    );
  return days;
}
async function pruneOutbox(state: JobState, definitions: Definition[]) {
  const now = state.now().getTime();
  let removed = 0;
  for (const [environmentId, days] of cellRetention(definitions)) {
    const cutoff = new Date(now - days * DAY_MS);
    removed += await write(state.store, async (tx) => {
      // Only settled rows are eligible; unknown, reconciling, held, pending and dispatching are never touched.
      const rows = await tx
        .select({ id: schema.jobOutbox.id })
        .from(schema.jobOutbox)
        .where(
          and(
            eq(schema.jobOutbox.environmentId, environmentId),
            inArray(schema.jobOutbox.state, [...OUTBOX_SETTLED]),
            lt(schema.jobOutbox.settledAt, cutoff),
          ),
        )
        .limit(BATCH);
      if (rows.length === 0) return 0;
      await tx.delete(schema.jobOutbox).where(
        inArray(
          schema.jobOutbox.id,
          rows.map((row) => row.id),
        ),
      );
      return rows.length;
    });
  }
  return removed;
}
async function pruneRuns(state: JobState, definition: Definition) {
  const cutoff = new Date(state.now().getTime() - definition.limits.retentionDays * DAY_MS);
  return write(state.store, async (tx) => {
    const rows = await tx
      .select({ id: schema.jobRuns.id })
      .from(schema.jobRuns)
      .where(
        and(
          eq(schema.jobRuns.definitionId, definition.id),
          inArray(schema.jobRuns.state, [...JOB_TERMINAL_STATES]),
          or(
            isNull(schema.jobRuns.reason),
            ne(schema.jobRuns.reason, "CANCELLED_FENCED_EFFECT_UNKNOWN"),
          ),
          lt(schema.jobRuns.finishedAt, cutoff),
        ),
      )
      .limit(BATCH);
    if (rows.length === 0) return 0;
    const ids = rows.map((row) => row.id);
    // A run still referenced by any outbox row (unresolved or not yet pruned) is kept.
    const referenced = await tx
      .select({ id: schema.jobOutbox.jobRunId })
      .from(schema.jobOutbox)
      .where(inArray(schema.jobOutbox.jobRunId, ids));
    const keep = new Set(referenced.map((row) => row.id));
    const removable = ids.filter((id) => !keep.has(id));
    if (removable.length === 0) return 0;
    await tx.delete(schema.jobRuns).where(inArray(schema.jobRuns.id, removable));
    return removable.length;
  });
}
/** Enforces limits.retentionDays on settled history only; uncertain, held or live work is never deleted. */
export async function pruneJobs(state: JobState): Promise<RetentionResult> {
  const definitions = await state.store.db
    .select()
    .from(schema.jobDefinitions)
    .where(jobEnvironmentFilter(state, schema.jobDefinitions.environmentId));
  const outbox = await pruneOutbox(state, definitions);
  let runs = 0;
  for (const definition of definitions) runs += await pruneRuns(state, definition);
  return { runs, outbox };
}
