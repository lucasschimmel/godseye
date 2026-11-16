import {
  type BackupOverviewView,
  Incident,
  type IncidentView,
  type RotationOverviewView,
} from "@godseye/contracts";
import type { schema } from "@godseye/store";

export type IncidentRow = typeof schema.incidents.$inferSelect;
export interface Finding {
  key: string;
  kind: IncidentView["kind"];
  severity: IncidentView["severity"];
  projectId: string | null;
  environmentId: string | null;
  allocationId: string | null;
  subject: string | null;
  reason: string;
  summary: string;
}
/** Delivery is external and optional; absence of a notifier is a visible state, not a delivery. */
export interface IncidentNotifier {
  /**
   * Whether a delivery target exists right now. Omitted means "always configured". When it
   * answers false, new incidents stay `unconfigured` and the outbox is not drained.
   */
  configured?(): Promise<boolean>;
  notify(
    incident: IncidentView,
    context?: { idempotencyKey: string },
    // biome-ignore lint/suspicious/noConfusingVoidType: Legacy notifier callbacks return Promise<void>; typed delivery receipts extend that existing interface.
  ): Promise<void | { state: "notified" | "failed" | "unknown"; receipt?: string }>;
}
export const MAX_DELIVERY_ATTEMPTS = 3;
export const MAX_MUTE_MS = 30 * 86_400_000;

export const incidentView = (row: IncidentRow, now: Date): IncidentView =>
  Incident.parse({
    id: row.id,
    key: row.key,
    kind: row.kind,
    severity: row.severity,
    projectId: row.projectId,
    environmentId: row.environmentId,
    allocationId: row.allocationId,
    subject: row.subject,
    state: row.state,
    muted: row.state !== "resolved" && !!row.mutedUntil && row.mutedUntil.getTime() > now.getTime(),
    mutedUntil: row.mutedUntil?.toISOString() ?? null,
    resolution: row.resolution,
    reason: row.reason,
    summary: row.summary,
    occurrences: row.occurrences,
    revision: row.revision,
    delivery: {
      state: row.deliveryState,
      attempts: row.deliveryAttempts,
      lastAttemptAt: row.deliveryAttemptedAt?.toISOString() ?? null,
    },
    firstRaisedAt: row.firstRaisedAt.toISOString(),
    lastRaisedAt: row.lastRaisedAt.toISOString(),
    acknowledgedAt: row.acknowledgedAt?.toISOString() ?? null,
    resolvedAt: row.resolvedAt?.toISOString() ?? null,
  });

/** Pure detector: unknown evidence is raised as unknown, healthy is only ever the absence of findings. */
export function backupFindings(backups: BackupOverviewView): Finding[] {
  const findings: Finding[] = [];
  for (const item of backups.environments) {
    if (!item.lastBaseBackup) continue;
    const scope = {
      projectId: item.projectId,
      environmentId: item.environmentId,
      allocationId: item.allocationId,
      subject: null,
    };
    const base = `${item.environmentId}:${item.allocationId}`;
    if (item.archive.state !== "healthy") {
      const unknown = item.archive.state === "unknown";
      const lag = item.archive.lagSeconds ?? 0;
      findings.push({
        ...scope,
        key: `archive-lag:${base}`,
        kind: "archive-lag",
        severity: !unknown && lag > item.archive.maxAgeSeconds * 2 ? "critical" : "warning",
        reason: unknown ? "ARCHIVE_STATUS_UNKNOWN" : (item.reasons[0] ?? "ARCHIVE_STALE"),
        summary: unknown
          ? "Archive status cannot be verified; recoverability is unknown"
          : `Archive is ${lag}s behind the ${item.archive.maxAgeSeconds}s limit`,
      });
    }
    if (item.headroom.state === "low")
      findings.push({
        ...scope,
        key: `headroom:${base}`,
        kind: "headroom",
        severity: "critical",
        reason: "HEADROOM_LOW",
        summary: `Archive free space ${item.headroom.archiveFreeGiB ?? 0} GiB is below ${item.headroom.requiredGiB} GiB`,
      });
  }
  return findings;
}
export function rotationFindings(rotations: RotationOverviewView): Finding[] {
  return rotations.roles
    .filter((item) => item.state === "failed" || item.state === "unknown")
    .map((item) => ({
      key: `rotation-failure:${item.environmentId}:${item.allocationId}:${item.role}`,
      kind: "rotation-failure" as const,
      severity: item.state === "unknown" ? ("critical" as const) : ("warning" as const),
      projectId: item.projectId,
      environmentId: item.environmentId,
      allocationId: item.allocationId,
      subject: item.role,
      reason: item.state === "unknown" ? "ROTATION_OUTCOME_UNKNOWN" : "ROTATION_FAILED",
      summary:
        item.state === "unknown"
          ? `Rotation of role ${item.role} has an uncertain outcome`
          : `Last rotation of role ${item.role} failed`,
    }));
}
