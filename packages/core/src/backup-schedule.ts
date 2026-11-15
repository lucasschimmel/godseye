import { type CellHost, type CellHostExecutor, parseEnv } from "./cell-host.js";
import type { Finding } from "./incidents-state.js";

/**
 * Per-cell physical backup cadence, executed by host systemd timers (see infra/dedicated-server/units):
 * weekly full, daily differential on the remaining days, and an hourly archive check. The host runner
 * records a small status file per cell; this module only reads it and turns overdue or failed runs
 * into E08 `archive-lag` findings. Absence of a record is raised as unknown, never as healthy.
 */
export const BACKUP_CADENCE = {
  fullIntervalHours: 7 * 24,
  differentialIntervalHours: 24,
  archiveCheckIntervalHours: 1,
  /** A run may be late by this factor of its interval before it is raised (timer jitter, long backups). */
  tolerance: 1.5,
} as const;
export const BACKUP_STATUS_DIRECTORY = "/var/lib/godseye/pg-backup";

export interface BackupStatusRecord {
  fullAt: string | null;
  differentialAt: string | null;
  archiveCheckAt: string | null;
  archiveCheckOk: boolean;
  lastFailureAt: string | null;
}
const hoursSince = (iso: string | null, now: Date) =>
  iso && Number.isFinite(Date.parse(iso)) ? (now.getTime() - Date.parse(iso)) / 3_600_000 : null;

export function parseBackupStatus(text: string | null): BackupStatusRecord | null {
  if (!text) return null;
  try {
    const value = JSON.parse(text) as Partial<BackupStatusRecord>;
    const date = (v: unknown) => (typeof v === "string" ? v : null);
    return {
      fullAt: date(value.fullAt),
      differentialAt: date(value.differentialAt),
      archiveCheckAt: date(value.archiveCheckAt),
      archiveCheckOk: value.archiveCheckOk === true,
      lastFailureAt: date(value.lastFailureAt),
    };
  } catch {
    return null;
  }
}
/** Pure detector: the reason names the first overdue or failed obligation. */
export function evaluateBackupStatus(
  status: BackupStatusRecord | null,
  now: Date,
): { reason: string; summary: string; critical: boolean } | null {
  if (!status)
    return {
      reason: "BACKUP_STATUS_UNKNOWN",
      summary: "No backup schedule record exists; recoverability is unknown",
      critical: false,
    };
  const late = (at: string | null, interval: number) => {
    const age = hoursSince(at, now);
    return age === null || age > interval * BACKUP_CADENCE.tolerance;
  };
  if (
    !status.archiveCheckOk ||
    late(status.archiveCheckAt, BACKUP_CADENCE.archiveCheckIntervalHours)
  )
    return {
      reason: "ARCHIVE_CHECK_FAILED_OR_OVERDUE",
      summary: "Continuous WAL archive check failed or is overdue",
      critical: true,
    };
  if (late(status.fullAt, BACKUP_CADENCE.fullIntervalHours))
    return {
      reason: "FULL_BACKUP_OVERDUE",
      summary: "Weekly full backup is overdue",
      critical: true,
    };
  if (late(status.differentialAt ?? status.fullAt, BACKUP_CADENCE.differentialIntervalHours))
    return {
      reason: "DIFFERENTIAL_BACKUP_OVERDUE",
      summary: "Daily differential backup is overdue",
      critical: false,
    };
  return null;
}
/** System detector for `IncidentEngine`: one finding per overdue cell, resolved keys for healthy cells. */
export function backupScheduleDetector(options: {
  host: CellHost;
  executor: CellHostExecutor;
  now?: () => Date;
  statusDirectory?: string;
}) {
  const now = options.now ?? (() => new Date());
  const directory = options.statusDirectory ?? BACKUP_STATUS_DIRECTORY;
  return async () => {
    const findings: Finding[] = [];
    const coveredKeys: string[] = [];
    for (const allocationId of await options.executor.listDirectory(options.host.configRoot)) {
      const env = parseEnv(
        await options.executor.readFile(`${options.host.configRoot}/${allocationId}/cell.env`),
      );
      // Held restore destinations are never scheduled; only provisioned source cells are.
      if (!env.PROJECT || !env.ENVIRONMENT || env.HELD) continue;
      const status = parseBackupStatus(
        await options.executor.readFile(`${directory}/${allocationId}.json`),
      );
      const result = evaluateBackupStatus(status, now());
      const key = `archive-lag:${env.ENVIRONMENT}:${allocationId}`;
      if (!result) {
        coveredKeys.push(key);
        continue;
      }
      findings.push({
        key,
        kind: "archive-lag",
        severity: result.critical ? "critical" : "warning",
        projectId: env.PROJECT,
        environmentId: env.ENVIRONMENT,
        allocationId,
        subject: null,
        reason: result.reason,
        summary: result.summary,
      });
    }
    return { findings, coveredKinds: [] as const, coveredKeys };
  };
}
