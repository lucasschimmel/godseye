import { z } from "zod";
import { InfrastructureHeadroom } from "./infrastructure.js";
import { UsageSummary } from "./usage.js";

const Id = z.string().uuid();
const Moment = z.string().datetime();
export const TELEMETRY_METRICS = [
  "process.cpu.user_us",
  "process.cpu.system_us",
  "process.memory.rss_bytes",
  "process.memory.heap_bytes",
  "filesystem.free_bytes",
  "filesystem.total_bytes",
  "request.duration_ms",
  "request.count",
  "tool.duration_ms",
] as const;
export const TelemetryScope = z
  .object({ projectId: Id.nullable(), environmentId: Id.nullable(), resourceId: Id.nullable() })
  .strict()
  .refine(
    (x) => (!x.environmentId || !!x.projectId) && (!x.resourceId || !!x.environmentId),
    "Invalid scope ancestry",
  );
export const RegisterTelemetrySource = z
  .object({
    name: z.string().regex(/^[a-zA-Z0-9._:-]{1,80}$/),
    authenticatedActorId: z.string().min(1).max(128),
    scope: TelemetryScope,
    kind: z.enum(["service", "controller", "external-observer"]),
    staleAfterSeconds: z.number().int().min(5).max(86400).default(120),
  })
  .strict();
export type RegisterTelemetrySourceInput = z.infer<typeof RegisterTelemetrySource>;
export const TelemetrySource = RegisterTelemetrySource.extend({
  id: Id,
  createdAt: Moment,
}).strict();
export type TelemetrySourceView = z.infer<typeof TelemetrySource>;
export const TelemetryCorrelation = z
  .object({ kind: z.enum(["execution", "job", "delivery", "agent", "coding"]), id: Id })
  .strict();
export const IngestTelemetry = z
  .object({
    observedAt: Moment,
    state: z.enum(["healthy", "degraded", "unavailable", "unknown"]),
    event: z.enum([
      "heartbeat",
      "request.completed",
      "tool.completed",
      "provider.unavailable",
      "accounting.unknown",
      "budget.exhausted",
      "archive.stale",
    ]),
    level: z.enum(["info", "warning", "error"]),
    code: z.string().regex(/^[A-Z][A-Z0-9_]{0,79}$/),
    correlation: TelemetryCorrelation.nullable().default(null),
    metrics: z
      .array(
        z
          .object({
            name: z.enum(TELEMETRY_METRICS),
            value: z.number().finite().nonnegative().max(Number.MAX_SAFE_INTEGER),
          })
          .strict(),
      )
      .max(16)
      .default([]),
  })
  .strict();
export type IngestTelemetryInput = z.infer<typeof IngestTelemetry>;
export const ObservabilityQuery = z
  .object({
    projectId: Id.optional(),
    environmentId: Id.optional(),
    sourceId: Id.optional(),
    cursor: z.coerce.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).optional(),
    limit: z.coerce.number().int().min(1).max(200).default(100),
  })
  .strict();
export type ObservabilityQueryInput = z.input<typeof ObservabilityQuery>;
export const TelemetryRecord = z
  .object({
    cursor: z.number().int().positive(),
    id: Id,
    sourceId: Id,
    scope: TelemetryScope,
    observedAt: Moment,
    receivedAt: Moment,
    state: IngestTelemetry.shape.state,
    event: IngestTelemetry.shape.event,
    level: IngestTelemetry.shape.level,
    code: IngestTelemetry.shape.code,
    correlation: TelemetryCorrelation.nullable(),
    metrics: IngestTelemetry.shape.metrics,
  })
  .strict();
export type TelemetryRecordView = z.infer<typeof TelemetryRecord>;
export const TelemetryPage = z
  .object({
    records: z.array(TelemetryRecord).max(200),
    nextCursor: z.number().int().nonnegative(),
    gap: z.boolean(),
    retentionDays: z.number().int().positive(),
    sourceContinuity: z.literal("unknown"),
  })
  .strict();
export const TelemetryHealth = z
  .object({
    source: TelemetrySource,
    freshness: z.enum(["fresh", "stale", "missing", "unavailable", "unknown"]),
    observedState: IngestTelemetry.shape.state.nullable(),
    observedAt: Moment.nullable(),
    receivedAt: Moment.nullable(),
    desiredState: z.literal("healthy"),
  })
  .strict();
export const ObservabilityHealth = z
  .object({
    sources: z.array(TelemetryHealth).max(1000),
    truncated: z.boolean(),
    remoteHostMetrics: z.literal("unavailable"),
    externalObserver: z.enum(["unconfigured", "configured"]),
  })
  .strict();
export const TimelineEntry = z
  .object({
    id: Id,
    kind: z.string().max(40),
    projectId: Id.nullable(),
    environmentId: Id.nullable(),
    state: z.string().max(80),
    occurredAt: Moment,
    source: z.literal("control-journal"),
    correlation: TelemetryCorrelation.nullable(),
  })
  .strict();
export const ObservabilityTimeline = z
  .object({
    entries: z.array(TimelineEntry).max(200),
    truncated: z.boolean(),
    causality: z.literal("explicit-identities-only"),
  })
  .strict();
export const OperationalOverview = z
  .object({
    projectCount: z.number().int().nonnegative(),
    environmentCount: z.number().int().nonnegative(),
    activeRuns: z.number().int().nonnegative(),
    pendingDecisions: z.number().int().nonnegative(),
    activeIncidents: z.number().int().nonnegative(),
    decisionCounts: z
      .object({
        foundation: z.number().int().nonnegative(),
        orchestration: z.number().int().nonnegative(),
        chat: z.number().int().nonnegative(),
      })
      .strict(),
    jobs: z
      .object({
        queued: z.number().int().nonnegative(),
        active: z.number().int().nonnegative(),
        unknown: z.number().int().nonnegative(),
      })
      .strict(),
    resourcePressure: InfrastructureHeadroom.nullable(),
    pressure: z
      .object({
        staleSources: z.number().int().nonnegative(),
        unavailableSources: z.number().int().nonnegative(),
      })
      .strict(),
    health: ObservabilityHealth,
    usage: UsageSummary.nullable(),
    collectedAt: Moment,
  })
  .strict();
export type TelemetryPageView = z.infer<typeof TelemetryPage>;
export type ObservabilityHealthView = z.infer<typeof ObservabilityHealth>;
export type ObservabilityTimelineView = z.infer<typeof ObservabilityTimeline>;
export type OperationalOverviewView = z.infer<typeof OperationalOverview>;
