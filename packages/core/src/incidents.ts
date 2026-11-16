import { randomUUID } from "node:crypto";
import {
  AcknowledgeIncident,
  type AcknowledgeIncidentInput,
  type BackupOverviewView,
  MuteIncident,
  type MuteIncidentInput,
  type RotationOverviewView,
} from "@godseye/contracts";
import { type DatabaseAccess, type Store, schema } from "@godseye/store";
import { desc, eq, ne } from "drizzle-orm";
import { DomainError, parseInput } from "./errors.js";
import { foundationState, recordRequest, requestFor } from "./foundation-data.js";
import { deliverIncidents } from "./incidents-delivery.js";
import {
  backupFindings,
  type Finding,
  type IncidentNotifier,
  type IncidentRow,
  incidentView,
  MAX_MUTE_MS,
  rotationFindings,
} from "./incidents-state.js";
import { appendAudit, write } from "./journal.js";
import { type Actor, assertOwner } from "./policy.js";

export type { IncidentNotifier } from "./incidents-state.js";
export interface IncidentSources {
  backups(actor: Actor): Promise<BackupOverviewView>;
  rotations(actor: Actor): Promise<RotationOverviewView>;
  observability?(actor: Actor): Promise<{
    findings: Finding[];
    coveredKinds: readonly string[];
    coveredKeys?: readonly string[];
  }>;
  system?(): Promise<{
    findings: Finding[];
    coveredKinds: readonly string[];
    coveredKeys?: readonly string[];
  }>;
}
/**
 * Scoped, key-deduplicated incidents. Raising is a durable record; `delivery.state` becomes
 * `notified` only after an injected notifier acknowledged, and stays `unconfigured` otherwise.
 */
export class IncidentEngine {
  constructor(
    private readonly store: Store,
    private readonly options: {
      now: () => Date;
      sources: IncidentSources;
      notifier?: IncidentNotifier;
    },
  ) {}
  /** A notifier without `configured()` is always configured; one with no target right now is not. */
  private async notifierConfigured(): Promise<boolean> {
    const { notifier } = this.options;
    if (!notifier) return false;
    return notifier.configured ? notifier.configured().catch(() => false) : true;
  }
  async overview(actor: Actor) {
    assertOwner(actor);
    const rows = await this.store.db
      .select()
      .from(schema.incidents)
      .orderBy(desc(schema.incidents.lastRaisedAt))
      .limit(1000);
    return {
      notifier: (await this.notifierConfigured())
        ? ("configured" as const)
        : ("unconfigured" as const),
      incidents: rows.map((row) => incidentView(row, this.options.now())),
    };
  }
  /** Recompute findings from current evidence; unscheduled by design (no qualified scheduler yet). */
  async evaluate(actor: Actor, key: string) {
    assertOwner(actor);
    const findings: Finding[] = [];
    const coveredKinds: string[] = [];
    const coveredKeys: string[] = [];
    const collect = async (
      work: () => Promise<{
        findings: Finding[];
        coveredKinds: readonly string[];
        coveredKeys?: readonly string[];
      }>,
    ) => {
      try {
        const result = await work();
        findings.push(...result.findings);
        coveredKinds.push(...result.coveredKinds);
        coveredKeys.push(...(result.coveredKeys ?? []));
      } catch {
        coveredKinds.push("detector-unavailable");
      }
    };
    await collect(async () => {
      const view = await this.options.sources.backups(actor);
      return {
        findings: backupFindings(view),
        coveredKinds: [],
        coveredKeys:
          view.provider === "qualified"
            ? view.environments.flatMap((item) => {
                const base = `${item.environmentId}:${item.allocationId}`;
                return [
                  ...(item.lastBaseBackup && item.archive.state === "healthy"
                    ? [`archive-lag:${base}`]
                    : []),
                  ...(item.lastBaseBackup && item.headroom.state === "ok"
                    ? [`headroom:${base}`]
                    : []),
                ];
              })
            : [],
      };
    });
    await collect(async () => {
      const view = await this.options.sources.rotations(actor);
      return {
        findings: rotationFindings(view),
        coveredKinds: [],
        coveredKeys:
          view.execution === "qualified"
            ? view.roles
                .filter((item) => item.state === "succeeded" || item.state === "never-rotated")
                .map(
                  (item) =>
                    `rotation-failure:${item.environmentId}:${item.allocationId}:${item.role}`,
                )
            : [],
      };
    });
    const observability = this.options.sources.observability;
    if (observability) await collect(() => observability(actor));
    const configured = await this.notifierConfigured();
    const replay = await write(this.store, async (tx) => {
      const request = await requestFor(tx, actor, key, "incident.evaluate", {});
      if (request.existing) return true;
      await this.reconcileFindings(tx, actor, findings, coveredKinds, coveredKeys, configured);
      await recordRequest(tx, this.fresh, key, request.digest, randomUUID(), "incident.evaluate");
      return false;
    });
    if (!replay) await this.deliver();
    return this.overview(actor);
  }
  /** Server lifecycle entry point; it consumes only explicitly injected system detectors. */
  async evaluateSystem() {
    if (!this.options.sources.system) return;
    const result = await this.options.sources.system();
    const actor: Actor = { id: "godseye:incidents:controller", kind: "service", projectIds: [] };
    const configured = await this.notifierConfigured();
    await write(this.store, (tx) =>
      this.reconcileFindings(
        tx,
        actor,
        result.findings,
        [...result.coveredKinds],
        [...(result.coveredKeys ?? [])],
        configured,
      ),
    );
  }
  async acknowledge(actor: Actor, id: string, input: AcknowledgeIncidentInput, key: string) {
    const data = parseInput(AcknowledgeIncident, input);
    return this.mutate(actor, id, key, "acknowledge", data, (row, now) => ({
      state: "acknowledged",
      acknowledgedAt: row.acknowledgedAt ?? now,
    }));
  }
  async mute(actor: Actor, id: string, input: MuteIncidentInput, key: string) {
    const data = parseInput(MuteIncident, input);
    const until = Date.parse(data.until);
    const now = this.options.now().getTime();
    if (until <= now || until - now > MAX_MUTE_MS)
      throw new DomainError("INVALID_INPUT", "Mute expiry must be future and within 30 days", 422);
    return this.mutate(actor, id, key, "mute", data, () => ({ mutedUntil: new Date(until) }));
  }
  async resolve(actor: Actor, id: string, input: AcknowledgeIncidentInput, key: string) {
    const data = parseInput(AcknowledgeIncident, input);
    return this.mutate(actor, id, key, "resolve", data, (_row, now) => ({
      state: "resolved",
      resolution: "manual",
      resolvedAt: now,
      mutedUntil: null,
    }));
  }
  private get fresh() {
    return foundationState(this.store, { now: this.options.now });
  }
  private async mutate(
    actor: Actor,
    id: string,
    key: string,
    action: string,
    data: { expectedRevision: number },
    patch: (row: IncidentRow, now: Date) => Partial<IncidentRow>,
  ) {
    assertOwner(actor);
    return write(this.store, async (tx) => {
      const request = await requestFor(tx, actor, key, `incident.${action}`, { id, data });
      const row = await this.row(tx, id);
      if (request.existing) return incidentView(row, this.options.now());
      if (row.state === "resolved")
        throw new DomainError("INCIDENT_RESOLVED", "Resolved incidents are immutable", 409);
      if (row.revision !== data.expectedRevision)
        throw new DomainError("REVISION_CONFLICT", "Incident changed", 409);
      const now = this.options.now();
      await tx
        .update(schema.incidents)
        .set({ ...patch(row, now), revision: row.revision + 1 })
        .where(eq(schema.incidents.id, id));
      await recordRequest(tx, this.fresh, key, request.digest, id, `incident.${action}`);
      await appendAudit(tx, actor, row.projectId, `incident.${action}`, `Incident ${id}`);
      return incidentView(await this.row(tx, id), now);
    });
  }
  private async row(tx: DatabaseAccess, id: string) {
    const [row] = await tx.select().from(schema.incidents).where(eq(schema.incidents.id, id));
    if (!row) throw new DomainError("NOT_FOUND", "Incident not found", 404);
    return row;
  }
  private async reconcileFindings(
    tx: DatabaseAccess,
    actor: Actor,
    findings: Finding[],
    _coveredKinds: string[],
    coveredKeys: string[] = [],
    notifierConfigured = false,
  ) {
    const now = this.options.now();
    const active = await tx
      .select()
      .from(schema.incidents)
      .where(ne(schema.incidents.state, "resolved"))
      .limit(10000);
    const byKey = new Map(active.map((row) => [row.key, row]));
    for (const finding of findings) {
      const current = byKey.get(finding.key);
      if (current) await this.reraise(tx, current, finding, now);
      else await this.raise(tx, actor, finding, now, notifierConfigured);
    }
    const keys = new Set(findings.map((finding) => finding.key));
    for (const row of active.filter(
      (item) => !keys.has(item.key) && coveredKeys.includes(item.key),
    )) {
      await tx
        .update(schema.incidents)
        .set({
          state: "resolved",
          resolution: "cleared",
          resolvedAt: now,
          revision: row.revision + 1,
        })
        .where(eq(schema.incidents.id, row.id));
      await appendAudit(tx, actor, row.projectId, "incident.cleared", `Incident ${row.id}`);
    }
  }
  private async raise(
    tx: DatabaseAccess,
    actor: Actor,
    finding: Finding,
    now: Date,
    notifierConfigured: boolean,
  ) {
    const id = randomUUID();
    await tx.insert(schema.incidents).values({
      id,
      key: finding.key,
      kind: finding.kind,
      severity: finding.severity,
      projectId: finding.projectId,
      environmentId: finding.environmentId,
      allocationId: finding.allocationId,
      subject: finding.subject,
      state: "open",
      reason: finding.reason,
      summary: finding.summary,
      occurrences: 1,
      revision: 1,
      mutedUntil: null,
      resolution: null,
      deliveryState: notifierConfigured ? "pending" : "unconfigured",
      deliveryAttempts: 0,
      deliveryAttemptedAt: null,
      firstRaisedAt: now,
      lastRaisedAt: now,
      acknowledgedAt: null,
      resolvedAt: null,
    });
    if (notifierConfigured)
      await tx.insert(schema.incidentOutbox).values({
        id: randomUUID(),
        incidentId: id,
        payloadKey: `incident:${id}`,
        state: "pending",
        attempts: 0,
        claimId: null,
        claimedAt: null,
        updatedAt: now,
        receipt: null,
      });
    await appendAudit(tx, actor, finding.projectId, "incident.raised", `Incident ${id}`);
  }
  private async reraise(tx: DatabaseAccess, row: IncidentRow, finding: Finding, now: Date) {
    const changed =
      row.severity !== finding.severity ||
      row.reason !== finding.reason ||
      row.summary !== finding.summary;
    await tx
      .update(schema.incidents)
      .set({
        severity: finding.severity,
        reason: finding.reason,
        summary: finding.summary,
        occurrences: row.occurrences + 1,
        lastRaisedAt: now,
        revision: changed ? row.revision + 1 : row.revision,
      })
      .where(eq(schema.incidents.id, row.id));
  }
  /** Durable outbox delivery is safe to invoke repeatedly or concurrently. */
  async deliver() {
    await deliverIncidents(this.store, this.options.now, this.options.notifier);
  }
}
