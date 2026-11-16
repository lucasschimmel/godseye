import { randomUUID } from "node:crypto";
import {
  IngestTelemetry,
  type IngestTelemetryInput,
  ObservabilityQuery,
  type ObservabilityQueryInput,
  RegisterTelemetrySource,
  type RegisterTelemetrySourceInput,
  TelemetryRecord,
  TelemetrySource,
} from "@godseye/contracts";
import { type DatabaseAccess, type Store, schema } from "@godseye/store";
import { and, asc, eq, gt, inArray, lt, sql } from "drizzle-orm";
import { DomainError, parseInput } from "./errors.js";
import { foundationState, recordRequest, requestFor } from "./foundation-data.js";
import { fingerprint, write } from "./journal.js";
import { type Actor, assertOwner, assertProjectAccess } from "./policy.js";
export const LOG_RETENTION_DAYS = 7;
export const METRIC_RETENTION_DAYS = 30;
export const sourceView = (row: typeof schema.telemetrySources.$inferSelect) =>
  TelemetrySource.parse({
    id: row.id,
    name: row.name,
    authenticatedActorId: row.authenticatedActorId,
    scope: {
      projectId: row.projectId,
      environmentId: row.environmentId,
      resourceId: row.resourceId,
    },
    kind: row.kind,
    staleAfterSeconds: row.staleAfterSeconds,
    createdAt: row.createdAt.toISOString(),
  });
export const recordView = (
  row: typeof schema.telemetryRecords.$inferSelect,
  source: typeof schema.telemetrySources.$inferSelect,
) =>
  TelemetryRecord.parse({
    cursor: row.cursor,
    id: row.id,
    sourceId: row.sourceId,
    scope: sourceView(source).scope,
    ...row.data,
    observedAt: row.observedAt.toISOString(),
    receivedAt: row.receivedAt.toISOString(),
  });
export async function validateScope(
  tx: DatabaseAccess,
  scope: RegisterTelemetrySourceInput["scope"],
) {
  if (scope.projectId) {
    const [p] = await tx
      .select({ id: schema.projects.id })
      .from(schema.projects)
      .where(eq(schema.projects.id, scope.projectId));
    if (!p) throw new DomainError("NOT_FOUND", "Telemetry project not found", 404);
  }
  if (scope.environmentId) {
    const [e] = await tx
      .select()
      .from(schema.environments)
      .where(eq(schema.environments.id, scope.environmentId));
    if (!e || e.projectId !== scope.projectId)
      throw new DomainError("FORBIDDEN", "Telemetry environment scope mismatch", 403);
  }
  if (scope.resourceId) {
    const [r] = await tx
      .select()
      .from(schema.resources)
      .where(eq(schema.resources.id, scope.resourceId));
    if (!r || r.projectId !== scope.projectId || r.environmentId !== scope.environmentId)
      throw new DomainError("FORBIDDEN", "Telemetry resource scope mismatch", 403);
  }
}
export async function registerSource(
  store: Store,
  now: () => Date,
  actor: Actor,
  input: RegisterTelemetrySourceInput,
  key: string,
  trusted = false,
) {
  if (!trusted) assertOwner(actor);
  const data = parseInput(RegisterTelemetrySource, input);
  if (!trusted && (data.authenticatedActorId.startsWith("godseye:") || data.kind !== "service"))
    throw new DomainError("FORBIDDEN", "System sources require a trusted private binding", 403);
  return write(store, async (tx) => {
    const request = await requestFor(tx, actor, key, "telemetry.source", data);
    if (request.existing) {
      const [r] = await tx
        .select()
        .from(schema.telemetrySources)
        .where(eq(schema.telemetrySources.id, request.existing.resourceId));
      if (r) return sourceView(r);
      throw new DomainError("NOT_FOUND", "Telemetry source not found", 404);
    }
    await validateScope(tx, data.scope);
    const row = {
      id: randomUUID(),
      name: data.name,
      authenticatedActorId: data.authenticatedActorId,
      ...data.scope,
      kind: data.kind,
      staleAfterSeconds: data.staleAfterSeconds,
      createdAt: now(),
      logFloor: 0,
      metricFloor: 0,
      healthCursor: null,
      healthState: null,
      healthObservedAt: null,
      healthReceivedAt: null,
    };
    await tx.insert(schema.telemetrySources).values(row);
    await recordRequest(
      tx,
      foundationState(store, { now }),
      key,
      request.digest,
      row.id,
      "telemetry.source",
    );
    return sourceView(row);
  });
}
export async function validateCorrelation(
  tx: DatabaseAccess,
  source: typeof schema.telemetrySources.$inferSelect,
  data: IngestTelemetryInput,
) {
  const c = data.correlation;
  if (!c) return;
  const table =
    c.kind === "execution"
      ? schema.executionRuns
      : c.kind === "job"
        ? schema.jobRuns
        : c.kind === "delivery"
          ? schema.deliveryRuns
          : c.kind === "agent"
            ? schema.agentTasks
            : schema.codingTasks;
  const [row] = await tx.select().from(table).where(eq(table.id, c.id));
  if (!row || row.projectId !== source.projectId)
    throw new DomainError("FORBIDDEN", "Telemetry correlation scope mismatch", 403);
  const environmentId = "environmentId" in row ? row.environmentId : null;
  if (environmentId && environmentId !== source.environmentId)
    throw new DomainError("FORBIDDEN", "Telemetry correlation environment mismatch", 403);
  // Coding tasks derive environment from their existing Foundation execution identity.
  if (c.kind === "coding" && "runId" in row) {
    if (!row.runId)
      throw new DomainError("FORBIDDEN", "Coding correlation has no execution scope", 403);
    const [run] = await tx
      .select()
      .from(schema.executionRuns)
      .where(eq(schema.executionRuns.id, String(row.runId)));
    if (!run || run.environmentId !== source.environmentId)
      throw new DomainError("FORBIDDEN", "Telemetry coding environment mismatch", 403);
  }
}
export async function ingestTelemetry(
  store: Store,
  now: () => Date,
  actor: Actor,
  sourceId: string,
  input: IngestTelemetryInput,
  key: string,
  trusted = false,
) {
  const data = parseInput(IngestTelemetry, input);
  return write(store, async (tx) => {
    const [source] = await tx
      .select()
      .from(schema.telemetrySources)
      .where(eq(schema.telemetrySources.id, sourceId));
    if (!source) throw new DomainError("NOT_FOUND", "Telemetry source not found", 404);
    if (source.authenticatedActorId !== actor.id)
      throw new DomainError("FORBIDDEN", "Telemetry source is bound to another identity", 403);
    if (source.projectId) assertProjectAccess(actor, source.projectId);
    else if (!trusted) assertOwner(actor);
    const observed = Date.parse(data.observedAt),
      current = now();
    if (
      observed > current.getTime() + 30000 ||
      observed < current.getTime() - METRIC_RETENTION_DAYS * 86400000
    )
      throw new DomainError(
        "INVALID_INPUT",
        "Telemetry observation is outside the accepted clock window",
        422,
      );
    await validateCorrelation(tx, source, data);
    const request = await requestFor(tx, actor, key, "telemetry.ingest", { sourceId, data });
    if (request.existing) {
      const [r] = await tx
        .select()
        .from(schema.telemetryRecords)
        .where(eq(schema.telemetryRecords.id, request.existing.resourceId));
      if (r) return recordView(r, source);
      throw new DomainError("TELEMETRY_EXPIRED", "Telemetry replay is outside retention", 410);
    }
    const [row] = await tx
      .insert(schema.telemetryRecords)
      .values({
        id: randomUUID(),
        sourceId,
        requestKey: key,
        digest: fingerprint(data),
        observedAt: new Date(observed),
        receivedAt: current,
        data,
      })
      .returning();
    if (!row) throw new DomainError("TELEMETRY_WRITE_FAILED", "Telemetry write failed", 500);
    await tx
      .update(schema.telemetrySources)
      .set({
        healthCursor: row.cursor,
        healthState: data.state,
        healthObservedAt: row.observedAt,
        healthReceivedAt: row.receivedAt,
      })
      .where(eq(schema.telemetrySources.id, sourceId));
    if (data.metrics.length)
      await tx.insert(schema.telemetryMetricRecords).values({
        ...row,
        data: { ...data, event: "heartbeat", code: "METRIC_OBSERVATION", level: "info" },
      });
    await recordRequest(
      tx,
      foundationState(store, { now }),
      key,
      request.digest,
      row.id,
      "telemetry.ingest",
    );
    return recordView(row, source);
  });
}
export async function scopedSources(
  store: Store,
  actor: Actor,
  input: ObservabilityQueryInput = {},
  trusted = false,
) {
  if (!trusted) assertOwner(actor);
  const q = parseInput(ObservabilityQuery, input);
  const where = and(
    q.projectId ? eq(schema.telemetrySources.projectId, q.projectId) : undefined,
    q.environmentId ? eq(schema.telemetrySources.environmentId, q.environmentId) : undefined,
    q.sourceId ? eq(schema.telemetrySources.id, q.sourceId) : undefined,
  );
  return {
    q,
    sources: await store.db
      .select()
      .from(schema.telemetrySources)
      .where(where)
      .orderBy(asc(schema.telemetrySources.id))
      .limit(1001),
  };
}
export async function telemetryPage(
  store: Store,
  now: () => Date,
  actor: Actor,
  input: ObservabilityQueryInput,
  metrics: boolean,
) {
  const table = metrics ? schema.telemetryMetricRecords : schema.telemetryRecords;
  const { q, sources } = await scopedSources(store, actor, input);
  const days = metrics ? METRIC_RETENTION_DAYS : LOG_RETENTION_DAYS;
  const cutoff = new Date(now().getTime() - days * 86400000);
  const ids = sources.map((x) => x.id);
  if (!ids.length)
    return {
      records: [],
      nextCursor: q.cursor ?? 0,
      gap: false,
      retentionDays: days,
      sourceContinuity: "unknown" as const,
    };
  const common = and(inArray(table.sourceId, ids), gt(table.receivedAt, cutoff));
  const [expired] = await store.db
    .select({ cursor: sql<number>`coalesce(max(cursor),0)` })
    .from(table)
    .where(and(inArray(table.sourceId, ids), lt(table.receivedAt, cutoff)));
  const floor = Math.max(
    expired?.cursor ?? 0,
    ...sources.map((s) => (metrics ? s.metricFloor : s.logFloor)),
  );
  const rows = await store.db
    .select()
    .from(table)
    .where(and(common, gt(table.cursor, q.cursor ?? 0)))
    .orderBy(asc(table.cursor))
    .limit(q.limit);
  const records = rows
    .map((r) => {
      const source = sources.find((s) => s.id === r.sourceId);
      if (!source)
        throw new DomainError(
          "TELEMETRY_SCOPE_MISMATCH",
          "Telemetry source scope is unavailable",
          500,
        );
      return recordView(r, source);
    })
    .map((r) => (metrics ? r : { ...r, metrics: [] }));
  return {
    records,
    nextCursor: rows.at(-1)?.cursor ?? q.cursor ?? 0,
    gap: q.cursor !== undefined && q.cursor < floor,
    retentionDays: days,
    sourceContinuity: "unknown" as const,
  };
}
export async function pruneTelemetry(store: Store, now: () => Date, actor: Actor, trusted = false) {
  if (!trusted) assertOwner(actor);
  // Only a minimal source health head survives sample retention; no expired event payload is exempt.
  return write(store, async (tx) => {
    const logCutoff = new Date(now().getTime() - LOG_RETENTION_DAYS * 86400000);
    const metricCutoff = new Date(now().getTime() - METRIC_RETENTION_DAYS * 86400000);
    await tx.execute(
      sql`UPDATE telemetry_sources s SET log_floor=greatest(log_floor,coalesce((SELECT max(cursor) FROM telemetry_records r WHERE r.source_id=s.id AND r.received_at < ${logCutoff}),0)), metric_floor=greatest(metric_floor,coalesce((SELECT max(cursor) FROM telemetry_metric_records r WHERE r.source_id=s.id AND r.received_at < ${metricCutoff}),0))`,
    );
    const result = await tx
      .delete(schema.telemetryRecords)
      .where(
        sql`${schema.telemetryRecords.cursor} IN (SELECT cursor FROM telemetry_records WHERE received_at < ${logCutoff} ORDER BY cursor LIMIT 1000)`,
      )
      .returning();
    const metricResult = await tx
      .delete(schema.telemetryMetricRecords)
      .where(
        sql`${schema.telemetryMetricRecords.cursor} IN (SELECT cursor FROM telemetry_metric_records WHERE received_at < ${metricCutoff} ORDER BY cursor LIMIT 1000)`,
      )
      .returning();
    return { deleted: result.length, metricsDeleted: metricResult.length };
  });
}
