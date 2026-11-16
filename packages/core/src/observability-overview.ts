import {
  type InfrastructureHeadroomView,
  type ObservabilityHealthView,
  OperationalOverview,
  type UsageSummaryView,
} from "@godseye/contracts";
import { type Store, schema } from "@godseye/store";
import { count, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import { type Actor, assertOwner } from "./policy.js";
export async function operationalOverview(
  store: Store,
  actor: Actor,
  now: () => Date,
  health: ObservabilityHealthView,
  options: {
    usageSummary?: () => Promise<UsageSummaryView>;
    headroom?: (actor: Actor) => Promise<InfrastructureHeadroomView>;
  },
) {
  assertOwner(actor);
  const [p] = await store.db.select({ n: count() }).from(schema.projects);
  const [e] = await store.db.select({ n: count() }).from(schema.environments);
  const [r] = await store.db
    .select({ n: count() })
    .from(schema.executionRuns)
    .where(isNull(schema.executionRuns.terminalAt));
  const [a] = await store.db
    .select({ n: count() })
    .from(schema.operations)
    .where(eq(schema.operations.status, "awaiting_approval"));
  const [plans] = await store.db
    .select({ n: count() })
    .from(schema.orchestrationPlans)
    .where(
      sql`metadata->>'state' IN ('pending','waiting_clarification') AND (metadata->'plan'->>'expiresAt')::timestamptz > ${now()}`,
    );
  const [chat] = await store.db
    .select({ n: count() })
    .from(schema.agentChatProposals)
    .where(sql`data->>'status'='pending' AND (data->>'expiresAt')::timestamptz > ${now()}`);
  const [i] = await store.db
    .select({ n: count() })
    .from(schema.incidents)
    .where(ne(schema.incidents.state, "resolved"));
  const [queued] = await store.db
    .select({ n: count() })
    .from(schema.jobRuns)
    .where(eq(schema.jobRuns.state, "queued"));
  const [active] = await store.db
    .select({ n: count() })
    .from(schema.jobRuns)
    .where(inArray(schema.jobRuns.state, ["running", "cancel_requested", "reconciling"]));
  const [unknown] = await store.db
    .select({ n: count() })
    .from(schema.jobRuns)
    .where(eq(schema.jobRuns.state, "unknown"));
  let usage: UsageSummaryView | null = null,
    resourcePressure: InfrastructureHeadroomView | null = null;
  if (options.usageSummary)
    try {
      usage = await options.usageSummary();
    } catch {
      usage = null;
    }
  if (options.headroom)
    try {
      resourcePressure = await options.headroom(actor);
    } catch {
      resourcePressure = null;
    }
  return OperationalOverview.parse({
    projectCount: p?.n ?? 0,
    environmentCount: e?.n ?? 0,
    activeRuns: r?.n ?? 0,
    pendingDecisions: (a?.n ?? 0) + (plans?.n ?? 0) + (chat?.n ?? 0),
    decisionCounts: { foundation: a?.n ?? 0, orchestration: plans?.n ?? 0, chat: chat?.n ?? 0 },
    jobs: { queued: queued?.n ?? 0, active: active?.n ?? 0, unknown: unknown?.n ?? 0 },
    activeIncidents: i?.n ?? 0,
    pressure: {
      staleSources: health.sources.filter(
        (x) => x.freshness === "stale" || x.freshness === "missing",
      ).length,
      unavailableSources: health.sources.filter(
        (x) => x.freshness === "unavailable" || x.freshness === "unknown",
      ).length,
    },
    resourcePressure,
    health,
    usage,
    collectedAt: now().toISOString(),
  });
}
