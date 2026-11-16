import {
  ObservabilityQuery,
  type ObservabilityQueryInput,
  ObservabilityTimeline,
} from "@godseye/contracts";
import { type Store, schema } from "@godseye/store";
import { and, desc, eq, sql } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { parseInput } from "./errors.js";
import { type Actor, assertOwner } from "./policy.js";
/** Only persisted identities establish correlation; proximity in time never establishes causality. */
export async function observabilityTimeline(
  store: Store,
  actor: Actor,
  input: ObservabilityQueryInput = {},
) {
  assertOwner(actor);
  const q = parseInput(ObservabilityQuery, input);
  const scope = (p: AnyPgColumn, e: AnyPgColumn) =>
    and(
      q.projectId ? eq(p, q.projectId) : undefined,
      q.environmentId ? eq(e, q.environmentId) : undefined,
    );
  const limit = q.limit + 1;
  const [execution, jobs, delivery, agents, coding, incidents] = await Promise.all([
    store.db
      .select({
        id: schema.executionRuns.id,
        projectId: schema.executionRuns.projectId,
        environmentId: schema.executionRuns.environmentId,
        createdAt: schema.executionRuns.createdAt,
        terminalAt: schema.executionRuns.terminalAt,
      })
      .from(schema.executionRuns)
      .where(scope(schema.executionRuns.projectId, schema.executionRuns.environmentId))
      .orderBy(desc(schema.executionRuns.createdAt))
      .limit(limit),
    store.db
      .select({
        id: schema.jobRuns.id,
        projectId: schema.jobRuns.projectId,
        environmentId: schema.jobRuns.environmentId,
        state: schema.jobRuns.state,
        createdAt: schema.jobRuns.createdAt,
        runId: schema.jobRuns.runId,
      })
      .from(schema.jobRuns)
      .where(scope(schema.jobRuns.projectId, schema.jobRuns.environmentId))
      .orderBy(desc(schema.jobRuns.createdAt))
      .limit(limit),
    store.db
      .select({
        id: schema.deliveryRuns.id,
        projectId: schema.deliveryRuns.projectId,
        environmentId: schema.deliveryRuns.environmentId,
        state: schema.deliveryRuns.state,
        createdAt: schema.deliveryRuns.updatedAt,
        runId: schema.deliveryRuns.runId,
      })
      .from(schema.deliveryRuns)
      .where(scope(schema.deliveryRuns.projectId, schema.deliveryRuns.environmentId))
      .orderBy(desc(schema.deliveryRuns.updatedAt))
      .limit(limit),
    store.db
      .select({
        id: schema.agentTasks.id,
        projectId: schema.agentTasks.projectId,
        environmentId: schema.agentTasks.environmentId,
        state: schema.agentTasks.state,
        createdAt: schema.agentTasks.createdAt,
        runId: schema.agentTasks.runId,
      })
      .from(schema.agentTasks)
      .where(scope(schema.agentTasks.projectId, schema.agentTasks.environmentId))
      .orderBy(desc(schema.agentTasks.createdAt))
      .limit(limit),
    store.db
      .select({
        id: schema.codingTasks.id,
        projectId: schema.codingTasks.projectId,
        metadata: schema.codingTasks.metadata,
        createdAt: schema.codingTasks.createdAt,
        runId: schema.codingTasks.runId,
      })
      .from(schema.codingTasks)
      .where(
        and(
          q.projectId ? eq(schema.codingTasks.projectId, q.projectId) : undefined,
          q.environmentId
            ? sql`EXISTS (SELECT 1 FROM execution_runs r WHERE r.id=${schema.codingTasks.runId} AND r.environment_id=${q.environmentId})`
            : undefined,
        ),
      )
      .orderBy(desc(schema.codingTasks.createdAt), desc(schema.codingTasks.id))
      .limit(limit),
    store.db
      .select({
        id: schema.incidents.id,
        projectId: schema.incidents.projectId,
        environmentId: schema.incidents.environmentId,
        state: schema.incidents.state,
        createdAt: schema.incidents.lastRaisedAt,
      })
      .from(schema.incidents)
      .where(scope(schema.incidents.projectId, schema.incidents.environmentId))
      .orderBy(desc(schema.incidents.lastRaisedAt))
      .limit(limit),
  ]);
  const common = (
    r: { id: string; projectId: string | null; environmentId: string | null; createdAt: Date },
    kind: string,
    state: string,
    runId: string | null = null,
  ) => ({
    id: r.id,
    kind,
    projectId: r.projectId,
    environmentId: r.environmentId,
    state,
    occurredAt: r.createdAt.toISOString(),
    source: "control-journal" as const,
    correlation: runId ? { kind: "execution" as const, id: runId } : null,
  });
  const codingEntries = [];
  for (const c of coding) {
    if (!c.runId) continue;
    const [run] = await store.db
      .select({ environmentId: schema.executionRuns.environmentId })
      .from(schema.executionRuns)
      .where(eq(schema.executionRuns.id, c.runId))
      .limit(1);
    if (!run || (q.environmentId && run.environmentId !== q.environmentId)) continue;
    codingEntries.push(
      common({ ...c, environmentId: run.environmentId }, "coding", c.metadata.state, c.runId),
    );
  }
  const entries = [
    ...execution.map((r) => common(r, "execution", r.terminalAt ? "terminal" : "active")),
    ...jobs.map((r) => common(r, "job", r.state, r.runId)),
    ...delivery.map((r) => common(r, "delivery", r.state, r.runId)),
    ...agents.map((r) => common(r, "agent", r.state, r.runId)),
    ...incidents.map((r) => common(r, "incident", r.state)),
    ...codingEntries,
  ].sort((a, b) => b.occurredAt.localeCompare(a.occurredAt) || a.id.localeCompare(b.id));
  return ObservabilityTimeline.parse({
    entries: entries.slice(0, q.limit),
    truncated: entries.length > q.limit,
    causality: "explicit-identities-only",
  });
}
