import { randomUUID } from "node:crypto";
import { statfs } from "node:fs/promises";
import {
  type InfrastructureHeadroomView,
  type IngestTelemetryInput,
  ObservabilityHealth,
  type ObservabilityQueryInput,
  type RegisterTelemetrySourceInput,
  type UsageSummaryView,
} from "@godseye/contracts";
import { type Store, schema } from "@godseye/store";
import { and, desc, eq, isNull } from "drizzle-orm";
import { DomainError } from "./errors.js";
import type { Finding } from "./incidents-state.js";
import { fingerprint } from "./journal.js";
import {
  ingestTelemetry,
  pruneTelemetry,
  registerSource,
  scopedSources,
  sourceView,
  telemetryPage,
} from "./observability-data.js";
import { operationalOverview } from "./observability-overview.js";
import { observabilityTimeline } from "./observability-timeline.js";
import { type Actor, assertOwner } from "./policy.js";
export interface ExternalUptimeObserver {
  readonly identity: string;
  observe(): Promise<IngestTelemetryInput>;
}
export interface ObservabilityOptions {
  now?: () => Date;
  localDiskPath?: string;
  usageSummary?: () => Promise<UsageSummaryView>;
  headroom?: (actor: Actor) => Promise<InfrastructureHeadroomView>;
  externalObserver?: ExternalUptimeObserver;
}
/** Local process observations only. An external observer is an explicitly injected independent protocol. */
export class ObservabilityEngine {
  readonly now: () => Date;
  constructor(
    private readonly store: Store,
    private readonly options: ObservabilityOptions = {},
  ) {
    this.now = options.now ?? (() => new Date());
  }
  registerSource(actor: Actor, input: RegisterTelemetrySourceInput, key: string) {
    return registerSource(this.store, this.now, actor, input, key);
  }
  ingest(actor: Actor, sourceId: string, input: IngestTelemetryInput, key: string) {
    return ingestTelemetry(this.store, this.now, actor, sourceId, input, key);
  }
  logs(actor: Actor, query: ObservabilityQueryInput = {}) {
    return telemetryPage(this.store, this.now, actor, query, false);
  }
  metrics(actor: Actor, query: ObservabilityQueryInput = {}) {
    return telemetryPage(this.store, this.now, actor, query, true);
  }
  timeline(actor: Actor, query: ObservabilityQueryInput = {}) {
    return observabilityTimeline(this.store, actor, query);
  }
  prune(actor: Actor) {
    return pruneTelemetry(this.store, this.now, actor);
  }
  pruneSystem() {
    return pruneTelemetry(this.store, this.now, this.systemActor, true);
  }
  async health(actor: Actor, query: ObservabilityQueryInput = {}) {
    assertOwner(actor);
    return this.readHealth(actor, query);
  }
  private async readHealth(actor: Actor, query: ObservabilityQueryInput = {}) {
    const { sources } = await scopedSources(this.store, actor, query, true);
    const health = [];
    for (const source of sources.slice(0, 1000)) {
      const r =
        source.healthCursor !== null &&
        source.healthObservedAt &&
        source.healthReceivedAt &&
        source.healthState
          ? {
              observedAt: source.healthObservedAt,
              receivedAt: source.healthReceivedAt,
              data: { state: source.healthState },
            }
          : null;
      const skewed = !!r && r.observedAt.getTime() > this.now().getTime();
      const stale =
        !!r &&
        (this.now().getTime() - r.observedAt.getTime() > source.staleAfterSeconds * 1000 ||
          this.now().getTime() - r.receivedAt.getTime() > source.staleAfterSeconds * 1000);
      health.push({
        source: sourceView(source),
        freshness: !r
          ? "missing"
          : skewed
            ? "unknown"
            : stale
              ? "stale"
              : r.data.state === "unavailable"
                ? "unavailable"
                : r.data.state === "unknown"
                  ? "unknown"
                  : "fresh",
        observedState: r?.data.state ?? null,
        observedAt: r?.observedAt.toISOString() ?? null,
        receivedAt: r?.receivedAt.toISOString() ?? null,
        desiredState: "healthy",
      });
    }
    return ObservabilityHealth.parse({
      sources: health,
      truncated: sources.length > 1000,
      remoteHostMetrics: "unavailable",
      externalObserver: this.options.externalObserver ? "configured" : "unconfigured",
    });
  }
  async overview(actor: Actor) {
    return operationalOverview(this.store, actor, this.now, await this.health(actor), this.options);
  }
  async incidentFindings(actor: Actor) {
    assertOwner(actor);
    return this.systemFindings();
  }
  async systemFindings() {
    const h = await this.readHealth(this.systemActor);
    const findings: Finding[] = [];
    const coveredKeys: string[] = [];
    for (const s of h.sources) {
      const scope = s.source.scope;
      coveredKeys.push(`health:${s.source.id}`);
      const [latest] = await this.store.db
        .select()
        .from(schema.telemetryRecords)
        .where(eq(schema.telemetryRecords.sourceId, s.source.id))
        .orderBy(desc(schema.telemetryRecords.cursor))
        .limit(1);
      const conditions = {
        "provider.unavailable": "provider",
        "accounting.unknown": "accounting",
        "budget.exhausted": "budget",
        "archive.stale": "archive-lag",
      } as const;
      if (s.freshness === "fresh")
        for (const kind of Object.values(conditions))
          coveredKeys.push(`telemetry:${kind}:${s.source.id}`);
      if (latest && latest.data.event in conditions) {
        const kind = conditions[latest.data.event as keyof typeof conditions];
        findings.push({
          key: `telemetry:${kind}:${s.source.id}`,
          kind,
          severity: "warning",
          projectId: scope.projectId,
          environmentId: scope.environmentId,
          allocationId: null,
          subject: s.source.id,
          reason: s.freshness === "fresh" ? latest.data.code : "SOURCE_EVIDENCE_STALE",
          summary:
            s.freshness === "fresh"
              ? "Registered source reports an operational condition"
              : "Operational condition cannot be verified from stale source evidence",
        });
      }
      if (s.freshness === "fresh" && s.observedState === "healthy") continue;
      findings.push({
        key: `health:${s.source.id}`,
        kind: s.source.kind === "external-observer" ? "external-uptime" : "health",
        severity: s.freshness === "unavailable" ? "critical" : "warning",
        projectId: scope.projectId,
        environmentId: scope.environmentId,
        allocationId: null,
        subject: s.source.id,
        reason: `TELEMETRY_${s.freshness.toUpperCase()}`,
        summary:
          s.freshness === "fresh"
            ? "Source reports degraded health"
            : "Source health cannot be verified",
      });
    }
    return { findings, coveredKinds: [] as const, coveredKeys };
  }
  async collect(actor: Actor) {
    assertOwner(actor);
    await this.collectSystem();
    return this.health(actor);
  }
  private readonly systemActor: Actor = {
    id: "godseye:telemetry:controller",
    kind: "service",
    projectIds: [],
  };
  async collectSystem() {
    const actor = this.systemActor;
    const local = await this.ensureLocalSource(actor, "controller-process", "controller");
    const cpu = process.cpuUsage(),
      memory = process.memoryUsage();
    const metrics: IngestTelemetryInput["metrics"] = [
      { name: "process.cpu.user_us", value: cpu.user },
      { name: "process.cpu.system_us", value: cpu.system },
      { name: "process.memory.rss_bytes", value: memory.rss },
      { name: "process.memory.heap_bytes", value: memory.heapUsed },
    ];
    // A configured private filesystem path supplies actual free/total observations, never a guest ceiling.
    let diskAvailable = true;
    try {
      const fs = await statfs(this.options.localDiskPath ?? process.cwd());
      metrics.push(
        { name: "filesystem.free_bytes", value: fs.bavail * fs.bsize },
        { name: "filesystem.total_bytes", value: fs.blocks * fs.bsize },
      );
    } catch {
      diskAvailable = false;
    }
    await ingestTelemetry(
      this.store,
      this.now,
      actor,
      local.id,
      {
        observedAt: this.now().toISOString(),
        state: diskAvailable ? "healthy" : "unknown",
        event: "heartbeat",
        level: diskAvailable ? "info" : "warning",
        code: diskAvailable ? "LOCAL_PROCESS_OBSERVED" : "FILESYSTEM_OBSERVATION_UNAVAILABLE",
        correlation: null,
        metrics,
      },
      `telemetry:${randomUUID()}`,
      true,
    );
    const observer = this.options.externalObserver;
    if (observer) {
      if (!/^[a-zA-Z0-9._:-]{1,80}$/.test(observer.identity))
        throw new DomainError(
          "INVALID_CONFIGURATION",
          "External observer identity is invalid",
          500,
        );
      const source = await this.ensureLocalSource(
        actor,
        `external:${observer.identity}`,
        "external-observer",
      );
      let data: IngestTelemetryInput;
      try {
        data = await observer.observe();
      } catch {
        data = {
          observedAt: this.now().toISOString(),
          state: "unavailable",
          event: "heartbeat",
          level: "error",
          code: "EXTERNAL_OBSERVER_UNAVAILABLE",
          correlation: null,
          metrics: [],
        };
      }
      await ingestTelemetry(
        this.store,
        this.now,
        actor,
        source.id,
        data,
        `telemetry:${randomUUID()}`,
        true,
      );
    }
    return;
  }
  private async ensureLocalSource(
    actor: Actor,
    name: string,
    kind: "controller" | "external-observer",
  ) {
    const [existing] = await this.store.db
      .select()
      .from(schema.telemetrySources)
      .where(
        and(
          eq(schema.telemetrySources.name, name),
          eq(schema.telemetrySources.authenticatedActorId, actor.id),
          isNull(schema.telemetrySources.projectId),
        ),
      )
      .limit(1);
    return existing
      ? sourceView(existing)
      : registerSource(
          this.store,
          this.now,
          actor,
          {
            name,
            kind,
            authenticatedActorId: actor.id,
            scope: { projectId: null, environmentId: null, resourceId: null },
            staleAfterSeconds: 120,
          },
          `telemetry-source:${fingerprint({ name, actorId: actor.id })}`,
          true,
        );
  }
}
export function runObservabilityScheduler(
  engine: ObservabilityEngine,
  options: {
    intervalMs?: number;
    onError?: (error: unknown) => void;
    evaluate?: () => Promise<unknown>;
    deliver?: () => Promise<unknown>;
  } = {},
) {
  const interval = options.intervalMs ?? 30000;
  if (!Number.isSafeInteger(interval) || interval < 1000 || interval > 3600000)
    throw new Error("Invalid observability interval");
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let deliveryTimer: ReturnType<typeof setTimeout> | undefined;
  let delivering: Promise<void> | undefined;
  let running: Promise<void> | undefined;
  const tick = async () => {
    for (const task of [
      () => engine.collectSystem(),
      options.evaluate,
      () => engine.pruneSystem(),
    ]) {
      if (stopped) break;
      if (task)
        try {
          await task();
        } catch (error) {
          options.onError?.(error);
        }
    }
  };
  const schedule = () => {
    if (stopped) return;
    timer = setTimeout(() => {
      running = tick().finally(schedule);
    }, interval);
    timer.unref?.();
  };
  const scheduleDelivery = () => {
    if (stopped || !options.deliver) return;
    deliveryTimer = setTimeout(() => {
      delivering = Promise.resolve()
        .then(() => options.deliver?.())
        .then(
          () => undefined,
          (error) => options.onError?.(error),
        )
        .finally(scheduleDelivery);
    }, interval);
    deliveryTimer.unref?.();
  };
  schedule();
  scheduleDelivery();
  return async () => {
    stopped = true;
    if (timer) clearTimeout(timer);
    if (deliveryTimer) clearTimeout(deliveryTimer);
    await running;
    await delivering;
  };
}
