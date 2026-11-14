import {
  type UsageOverviewView,
  UsageQuery,
  type UsageQueryInput,
  type UsageQueryView,
  type UsageSummaryView,
} from "@godseye/contracts";
import { type DatabaseAccess, type Store, schema } from "@godseye/store";
import { and, asc, eq, type SQL, sql } from "drizzle-orm";
import { z } from "zod";
import { DomainError } from "./errors.js";
import { fingerprint } from "./journal.js";
import { budgetView } from "./usage-budgets.js";
import { usageRetentionWatermark } from "./usage-retention.js";

const Cursor = z
  .object({
    at: z.string().datetime(),
    id: z.string().uuid(),
    snapshot: z.string().datetime(),
    scope: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();
type Scope = {
  query: UsageQueryView;
  snapshot: string;
  digest: string;
  after: z.infer<typeof Cursor> | null;
  attempts: SQL;
  runs: SQL;
};
const invalidScope = () => new DomainError("FORBIDDEN", "Usage filter ancestry differs", 403);
const bounded = (value: string | number | bigint | null | undefined): number | null => {
  if (value == null) return null;
  const amount = BigInt(value);
  return amount < 0n || amount > BigInt(Number.MAX_SAFE_INTEGER) ? null : Number(amount);
};

async function validateScope(db: DatabaseAccess, q: UsageQueryView) {
  if (
    q.projectId &&
    !(
      await db
        .select({ id: schema.projects.id })
        .from(schema.projects)
        .where(eq(schema.projects.id, q.projectId))
        .limit(1)
    )[0]
  )
    throw invalidScope();
  if (q.environmentId) {
    const [env] = await db
      .select()
      .from(schema.environments)
      .where(eq(schema.environments.id, q.environmentId))
      .limit(1);
    if (!env || (q.projectId && env.projectId !== q.projectId)) throw invalidScope();
  }
  if (q.profileId) {
    const [profile] = await db
      .select()
      .from(schema.agentProfiles)
      .where(eq(schema.agentProfiles.id, q.profileId))
      .limit(1);
    if (
      !profile ||
      (q.projectId && profile.projectId !== q.projectId) ||
      (q.environmentId && profile.environmentId !== q.environmentId)
    )
      throw invalidScope();
  }
  if (q.runId) {
    const [run] = await db
      .select()
      .from(schema.executionRuns)
      .where(eq(schema.executionRuns.id, q.runId))
      .limit(1);
    if (
      !run ||
      (q.projectId && run.projectId !== q.projectId) ||
      (q.environmentId && run.environmentId !== q.environmentId)
    )
      throw invalidScope();
  }
}

function runConditions(q: UsageQueryView, snapshot: string): SQL {
  const r = schema.executionRuns,
    conditions: SQL[] = [sql`${r.createdAt} <= ${snapshot}::timestamptz`];
  if (q.projectId) conditions.push(eq(r.projectId, q.projectId));
  if (q.environmentId) conditions.push(eq(r.environmentId, q.environmentId));
  if (q.runId) conditions.push(eq(r.id, q.runId));
  if (q.since) conditions.push(sql`${r.createdAt} >= ${q.since}::timestamptz`);
  if (q.until) conditions.push(sql`${r.createdAt} < ${q.until}::timestamptz`);
  if (q.profileId)
    conditions.push(
      sql`exists(select 1 from ${schema.agentTasks} where ${schema.agentTasks.runId}=${r.id} and ${schema.agentTasks.profileId}=${q.profileId})`,
    );
  if (q.runner)
    conditions.push(
      sql`exists(select 1 from ${schema.codingTasks} join ${schema.codingPreparations} on ${schema.codingTasks.preparationId}=${schema.codingPreparations.id} where ${schema.codingTasks.runId}=${r.id} and ${schema.codingPreparations.metadata}->>'runner'=${q.runner})`,
    );
  return and(...conditions) ?? sql`true`;
}

async function prepare(db: DatabaseAccess, raw: UsageQueryInput, now: Date): Promise<Scope> {
  const query = UsageQuery.parse(raw),
    { cursor: _cursor, limit: _limit, ...filters } = query,
    digest = fingerprint(filters);
  let after: z.infer<typeof Cursor> | null = null;
  if (query.cursor) {
    try {
      after = Cursor.parse(JSON.parse(Buffer.from(query.cursor, "base64url").toString("utf8")));
    } catch {
      throw new DomainError("INVALID_INPUT", "Invalid usage cursor", 400);
    }
    if (after.scope !== digest || Date.parse(after.snapshot) > now.getTime())
      throw new DomainError("INVALID_INPUT", "Usage cursor scope differs", 400);
  }
  await validateScope(db, query);
  const snapshot = after?.snapshot ?? now.toISOString(),
    a = schema.usageAttempts,
    conditions: SQL[] = [sql`${a.createdAt} <= ${snapshot}::timestamptz`];
  if (query.projectId) conditions.push(eq(a.projectId, query.projectId));
  if (query.environmentId)
    conditions.push(sql`${a.metadata}->>'environmentId'=${query.environmentId}`);
  if (query.profileId) conditions.push(sql`${a.metadata}->>'profileId'=${query.profileId}`);
  if (query.runner) conditions.push(sql`${a.metadata}->>'runner'=${query.runner}`);
  if (query.runId) conditions.push(eq(a.runId, query.runId));
  if (query.since) conditions.push(sql`${a.createdAt} >= ${query.since}::timestamptz`);
  if (query.until) conditions.push(sql`${a.createdAt} < ${query.until}::timestamptz`);
  const runs = runConditions(query, snapshot);
  if (query.runId && (query.profileId || query.runner)) {
    // The run must match attribution independently of its evidence/time window.
    const ancestry = runConditions(
      { ...query, since: undefined, until: undefined },
      new Date(now.getTime() + 1).toISOString(),
    );
    if (
      !(
        await db
          .select({ id: schema.executionRuns.id })
          .from(schema.executionRuns)
          .where(ancestry)
          .limit(1)
      )[0]
    )
      throw invalidScope();
  }
  return { query, snapshot, digest, after, attempts: and(...conditions) ?? sql`true`, runs };
}

async function summarize(
  db: DatabaseAccess,
  scope: Scope,
  historyTruncated: boolean,
): Promise<UsageSummaryView> {
  const a = schema.usageAttempts,
    r = schema.executionRuns;
  const [attempt] = await db
    .select({
      count: sql<string>`count(*)::text`,
      pending: sql<string>`count(*) filter(where ${a.metadata}->>'completeness'='pending')::text`,
      unknown: sql<string>`count(*) filter(where ${a.metadata}->>'completeness' in ('partial','unknown'))::text`,
      estimated: sql<
        string | null
      >`case when count(*)=0 or count(*) filter(where ${a.metadata}->>'estimatedMicros' is null)>0 then null else sum((${a.metadata}->>'estimatedMicros')::numeric)::text end`,
      reported: sql<
        string | null
      >`case when count(*)=0 or count(*) filter(where ${a.metadata}->'outcome'->>'providerReportedMicros' is null)>0 then null else sum((${a.metadata}->'outcome'->>'providerReportedMicros')::numeric)::text end`,
    })
    .from(a)
    .where(scope.attempts);
  const [run] = await db
    .select({
      charged: sql<string>`coalesce(sum(${r.chargedMicros}::numeric),0)::text`,
      reserved: sql<string>`coalesce(sum(case when ${r.terminalAt} is null or exists(select 1 from ${schema.usageReservations} where ${schema.usageReservations.runId}=${r.id} and ${schema.usageReservations.state}='unknown') then ${r.reservedMicros}::numeric else 0 end),0)::text`,
      legacy: sql<string>`count(*) filter(where exists(select 1 from ${schema.executionPlans} where ${schema.executionPlans.id}=${r.planId} and ${schema.executionPlans.command}->>'kind' in ('agent.run','coding.run')) and not exists(select 1 from ${a} where ${a.runId}=${r.id}))::text`,
    })
    .from(r)
    .where(scope.runs);
  const legacy = bounded(run?.legacy) ?? 0,
    count = bounded(attempt?.count) ?? 0,
    pending = bounded(attempt?.pending) ?? 0,
    unknown = bounded(attempt?.unknown) ?? 0;
  const invoiceMicros = await invoiceTotal(db, scope);
  const conservativeChargedMicros = bounded(run?.charged),
    reservedMicros = bounded(run?.reserved);
  return {
    attemptCount: count,
    pendingCount: pending,
    unknownCount: unknown,
    estimatedMicros: historyTruncated || legacy ? null : bounded(attempt?.estimated),
    providerReportedMicros: historyTruncated || legacy ? null : bounded(attempt?.reported),
    invoiceMicros,
    conservativeChargedMicros,
    reservedMicros,
    legacyRunCount: legacy,
    completeness:
      legacy || !count || conservativeChargedMicros === null || reservedMicros === null
        ? "unknown"
        : pending || unknown || historyTruncated
          ? "partial"
          : "complete",
    adminBilling: "unconfigured",
  };
}

async function invoiceTotal(
  db: DatabaseAccess,
  { query: q, snapshot }: Scope,
): Promise<number | null> {
  if (q.environmentId || q.profileId || q.runner || q.runId) return null;
  const i = schema.usageInvoices,
    conditions: SQL[] = [sql`${i.metadata}->>'importedAt' <= ${snapshot}`];
  if (q.projectId) conditions.push(eq(i.projectId, q.projectId));
  // Only entire invoices enclosed by the window can be attributed. A partial overlap is unknown.
  if (q.since)
    conditions.push(
      sql`(${i.metadata}->'invoice'->>'periodEnd')::timestamptz > ${q.since}::timestamptz`,
    );
  if (q.until)
    conditions.push(
      sql`(${i.metadata}->'invoice'->>'periodStart')::timestamptz < ${q.until}::timestamptz`,
    );
  const start = q.since ?? "0001-01-01T00:00:00.000Z",
    end = q.until ?? snapshot;
  const [row] = await db
    .select({
      total: sql<
        string | null
      >`case when count(*)=0 or bool_or((${i.metadata}->'invoice'->>'periodStart')::timestamptz < ${start}::timestamptz or (${i.metadata}->'invoice'->>'periodEnd')::timestamptz > ${end}::timestamptz) then null else sum((select coalesce(sum((line->>'amountMicros')::numeric),0) from jsonb_array_elements(${i.metadata}->'invoice'->'lines') line))::text end`,
    })
    .from(i)
    .where(and(...conditions));
  return bounded(row?.total);
}

export async function queryUsage(
  store: Store,
  raw: UsageQueryInput = {},
  now: Date = new Date(),
): Promise<UsageOverviewView> {
  const db = store.db,
    scope = await prepare(db, raw, now),
    { query: q, after } = scope,
    a = schema.usageAttempts;
  const watermark = await usageRetentionWatermark(db),
    historyTruncated =
      watermark !== null && (!q.since || Date.parse(q.since) < Date.parse(watermark));
  const pageWhere = after
    ? and(
        scope.attempts,
        sql`(${a.createdAt},${a.id}) > (${after.at}::timestamptz,${after.id}::uuid)`,
      )
    : scope.attempts;
  const records = await db
    .select()
    .from(a)
    .where(pageWhere)
    .orderBy(asc(a.createdAt), asc(a.id))
    .limit(q.limit + 1);
  const selected = records.slice(0, q.limit),
    last = selected.at(-1);
  const nextCursor =
    records.length > q.limit && last
      ? Buffer.from(
          JSON.stringify({
            at: last.createdAt.toISOString(),
            id: last.id,
            snapshot: scope.snapshot,
            scope: scope.digest,
          }),
        ).toString("base64url")
      : null;
  const projectScope =
    q.projectId ??
    (q.environmentId
      ? (
          await db
            .select()
            .from(schema.environments)
            .where(eq(schema.environments.id, q.environmentId))
            .limit(1)
        )[0]?.projectId
      : q.profileId
        ? (
            await db
              .select()
              .from(schema.agentProfiles)
              .where(eq(schema.agentProfiles.id, q.profileId))
              .limit(1)
          )[0]?.projectId
        : q.runId
          ? (
              await db
                .select()
                .from(schema.executionRuns)
                .where(eq(schema.executionRuns.id, q.runId))
                .limit(1)
            )[0]?.projectId
          : undefined);
  const budgets = await db
    .select()
    .from(schema.usageBudgets)
    .where(projectScope ? eq(schema.usageBudgets.projectId, projectScope) : undefined)
    .orderBy(asc(schema.usageBudgets.id))
    .limit(501);
  const prices = await db
    .select()
    .from(schema.usagePrices)
    .orderBy(asc(schema.usagePrices.id))
    .limit(501);
  const invoices = await db
    .select()
    .from(schema.usageInvoices)
    .where(projectScope ? eq(schema.usageInvoices.projectId, projectScope) : undefined)
    .orderBy(asc(schema.usageInvoices.id))
    .limit(101);
  const summary = await summarize(db, scope, historyTruncated);
  return {
    summary,
    attempts: selected.map((v) => v.metadata),
    budgets: await Promise.all(budgets.slice(0, 500).map((v) => budgetView(db, v, now))),
    prices: prices.slice(0, 500).map((v) => v.metadata),
    invoices: invoices.slice(0, 100).map((v) => v.metadata),
    page: {
      nextCursor,
      total: summary.attemptCount,
      snapshotAt: scope.snapshot,
      retainedSince: watermark,
      historyTruncated,
    },
    truncated:
      nextCursor !== null ||
      historyTruncated ||
      budgets.length > 500 ||
      prices.length > 500 ||
      invoices.length > 100,
  };
}

export async function summarizeUsage(
  store: Store,
  raw: UsageQueryInput = {},
  now: Date = new Date(),
): Promise<UsageSummaryView> {
  const scope = await prepare(store.db, raw, now),
    watermark = await usageRetentionWatermark(store.db);
  return summarize(
    store.db,
    scope,
    watermark !== null &&
      (!scope.query.since || Date.parse(scope.query.since) < Date.parse(watermark)),
  );
}
