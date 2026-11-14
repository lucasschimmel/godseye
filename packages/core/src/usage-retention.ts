import { type DatabaseAccess, type Store, schema } from "@godseye/store";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { DomainError } from "./errors.js";
import { write } from "./journal.js";

export const USAGE_RETENTION_DAYS = 90;
const WATERMARK_KEY = "usage.retention.watermark";

export async function usageRetentionWatermark(db: DatabaseAccess): Promise<string | null> {
  const [row] = await db
    .select()
    .from(schema.usageReceipts)
    .where(eq(schema.usageReceipts.key, WATERMARK_KEY))
    .limit(1);
  const result = row?.result;
  return result &&
    typeof result === "object" &&
    "cutoff" in result &&
    typeof result.cutoff === "string"
    ? result.cutoff
    : null;
}

/** Bounded, conservative evidence collection. Financial/accounting journals are never deleted.
 * Multi-attempt histories remain intact to preserve continuation/retry ancestry.
 */
export async function pruneUsage(
  store: Store,
  now: Date = new Date(),
  options: { days?: number; batch?: number } = {},
) {
  const days = options.days ?? USAGE_RETENTION_DAYS,
    batch = options.batch ?? 100;
  if (
    !Number.isInteger(days) ||
    days < USAGE_RETENTION_DAYS ||
    days > 3650 ||
    !Number.isInteger(batch) ||
    batch < 1 ||
    batch > 500
  )
    throw new DomainError("INVALID_INPUT", "Usage retention bounds differ", 400);
  const cutoff = new Date(now.getTime() - days * 86400000).toISOString();
  return write(store, async (tx) => {
    const a = schema.usageAttempts,
      r = schema.executionRuns;
    const eligible = and(
      sql`${a.createdAt} < ${cutoff}::timestamptz`,
      sql`${a.metadata}->>'completeness'='complete'`,
      sql`${a.metadata}->'outcome'->>'state' in ('succeeded','failed')`,
      sql`${a.metadata}->>'estimatedMicros' is not null`,
      sql`${a.metadata}->'outcome'->>'providerReportedMicros' is not null`,
      sql`exists(select 1 from ${r} where ${r.id}=${a.runId} and ${r.terminalAt} < ${cutoff}::timestamptz and ${r.cleanupState} in ('not_required','complete'))`,
      sql`not exists(select 1 from ${schema.effects} where ${schema.effects.runId}=${a.runId} and ${schema.effects.status} in ('unknown','intent'))`,
      sql`not exists(select 1 from ${schema.usageReservations} where ${schema.usageReservations.runId}=${a.runId} and ${schema.usageReservations.state} in ('reserved','unknown'))`,
      sql`(select count(*) from usage_attempts sibling where sibling.run_id=${a.runId})=1`,
      sql`not exists(select 1 from ${schema.usageInvoices},jsonb_array_elements(${schema.usageInvoices.metadata}->'invoice'->'lines') line where line->>'attemptId'=${a.id}::text)`,
    );
    const rows = await tx
      .select({ id: a.id })
      .from(a)
      .where(eligible)
      .orderBy(asc(a.createdAt), asc(a.id))
      .limit(batch);
    if (rows.length) {
      await tx.delete(a).where(
        inArray(
          a.id,
          rows.map((v) => v.id),
        ),
      );
      const previous = await usageRetentionWatermark(tx),
        retainedCutoff = previous && previous > cutoff ? previous : cutoff;
      await tx
        .insert(schema.usageReceipts)
        .values({ key: WATERMARK_KEY, digest: "retention-v1", result: { cutoff: retainedCutoff } })
        .onConflictDoUpdate({
          target: schema.usageReceipts.key,
          set: { result: { cutoff: retainedCutoff } },
        });
    }
    return {
      deleted: rows.length,
      cutoff,
      retainedSince: await usageRetentionWatermark(tx),
      batch,
      morePossible: rows.length === batch,
    };
  });
}
