import { readdir, readFile, statfs } from "node:fs/promises";
import { availableParallelism } from "node:os";
import type { HostHealthDigestView, ServerObservationView } from "@godseye/contracts";
import { parseBackupStatus } from "./backup-schedule.js";
import { type Actor, assertOwner } from "./policy.js";

type UnknownReason = Extract<ServerObservationView["cpu"], { state: "unknown" }>["reason"];
type Unknown = { state: "unknown"; reason: UnknownReason };
type Filesystem = ServerObservationView["filesystems"][number];

/** Host health files are rewritten every 15 minutes; three missed runs make the evidence stale. */
export const HOST_HEALTH_MAX_AGE_MS = 45 * 60_000;
const SEAL_TIMEOUT_MS = 2_000;
const MAX_FILE_BYTES = 262_144;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Injectable system access; the default reads the local machine and nothing remote except OpenBao. */
export interface ServerObserverPorts {
  readText(path: string): Promise<string | null>;
  listDirectory(path: string): Promise<string[] | null>;
  filesystem(path: string): Promise<{ totalBytes: number; availableBytes: number } | null>;
  /** True when OpenBao reports itself sealed; null when it cannot be asked. */
  sealed(address: string): Promise<boolean | null>;
  cores(): number;
  now(): Date;
}

export interface ServerObserverOptions {
  /** Filesystem path of the pro VM system disk; absent means it is not observed. */
  rootPath?: string | null;
  /** Mount path of the cell data disk; absent means it is not observed. */
  cellDataPath?: string | null;
  /** Readable copy of the host's host-health.json; the host writes it, nothing here reaches the host. */
  hostHealthFile?: string | null;
  /** Directory of per-cell pgBackRest status files written by the backup runner. */
  pgBackupDirectory?: string | null;
  /** OpenBao base address; only the unauthenticated seal-status endpoint is requested. */
  baoAddress?: string | null;
  ports?: Partial<ServerObserverPorts>;
}

const defaultPorts: ServerObserverPorts = {
  async readText(path) {
    try {
      const text = await readFile(path, "utf8");
      return text.length > MAX_FILE_BYTES ? null : text;
    } catch {
      return null;
    }
  },
  async listDirectory(path) {
    try {
      return await readdir(path);
    } catch {
      return null;
    }
  },
  async filesystem(path) {
    try {
      const stats = await statfs(path);
      return { totalBytes: stats.blocks * stats.bsize, availableBytes: stats.bavail * stats.bsize };
    } catch {
      return null;
    }
  },
  async sealed(address) {
    try {
      const response = await fetch(new URL("/v1/sys/seal-status", address), {
        signal: AbortSignal.timeout(SEAL_TIMEOUT_MS),
      });
      if (!response.ok) return null;
      const body = (await response.json()) as { sealed?: unknown };
      return typeof body.sealed === "boolean" ? body.sealed : null;
    } catch {
      return null;
    }
  },
  cores: () => availableParallelism(),
  now: () => new Date(),
};

const unknown = (reason: UnknownReason): Unknown => ({ state: "unknown", reason });
const round = (value: number, digits = 1) => Number(value.toFixed(digits));
const finite = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
const text = (value: unknown, max: number): string | null =>
  typeof value === "string" && value.length > 0 ? value.slice(0, max) : null;
const kib = (source: string, key: string) => {
  const match = new RegExp(`^${key}:\\s+(\\d+)\\s+kB`, "m").exec(source);
  return match?.[1] ? Number(match[1]) : null;
};

/**
 * Collects what the control API can see from the machine it runs on. Anything it cannot read is
 * reported as unknown with a reason; it never opens a remote shell and never estimates a value.
 */
export class ServerObserver {
  private readonly ports: ServerObserverPorts;
  constructor(private readonly options: ServerObserverOptions = {}) {
    this.ports = { ...defaultPorts, ...options.ports };
  }

  async observe(actor: Actor): Promise<ServerObservationView> {
    assertOwner(actor);
    const at = this.ports.now().toISOString();
    const [cpu, memory, uptime, openbao, pgBackup, host, root, cell] = await Promise.all([
      this.cpu(at),
      this.memory(at),
      this.uptime(at),
      this.openbao(at),
      this.pgBackup(at),
      this.host(at),
      this.filesystem(at, "pro-root", "Disque système de la VM pro", this.options.rootPath),
      this.filesystem(at, "cell-data", "Disque de données des cellules", this.options.cellDataPath),
    ]);
    return {
      observedAt: at,
      cpu,
      memory,
      uptime,
      filesystems: [root, cell],
      openbao,
      pgBackup,
      host,
    };
  }

  private async cpu(at: string): Promise<ServerObservationView["cpu"]> {
    const raw = await this.ports.readText("/proc/loadavg");
    if (raw === null) return unknown("UNREADABLE");
    const [one, five, fifteen] = raw.trim().split(/\s+/).slice(0, 3).map(Number);
    if (![one, five, fifteen].every((v) => v !== undefined && Number.isFinite(v) && v >= 0))
      return unknown("INVALID");
    return {
      state: "observed",
      observedAt: at,
      cores: Math.max(1, this.ports.cores()),
      loadAverage1m: one as number,
      loadAverage5m: five as number,
      loadAverage15m: fifteen as number,
    };
  }

  private async memory(at: string): Promise<ServerObservationView["memory"]> {
    const raw = await this.ports.readText("/proc/meminfo");
    if (raw === null) return unknown("UNREADABLE");
    const total = kib(raw, "MemTotal");
    const available = kib(raw, "MemAvailable");
    if (total === null || available === null || available > total) return unknown("INVALID");
    return {
      state: "observed",
      observedAt: at,
      totalMiB: round(total / 1024),
      availableMiB: round(available / 1024),
    };
  }

  private async uptime(at: string): Promise<ServerObservationView["uptime"]> {
    const raw = await this.ports.readText("/proc/uptime");
    if (raw === null) return unknown("UNREADABLE");
    const seconds = finite(Number(raw.trim().split(/\s+/)[0]));
    return seconds === null
      ? unknown("INVALID")
      : { state: "observed", observedAt: at, seconds: Math.floor(seconds) };
  }

  private async filesystem(
    at: string,
    id: Filesystem["id"],
    label: string,
    path: string | null | undefined,
  ): Promise<Filesystem> {
    if (!path) return { id, label, ...unknown("NOT_CONFIGURED") };
    const usage = await this.ports.filesystem(path);
    if (!usage || usage.totalBytes <= 0 || usage.availableBytes > usage.totalBytes)
      return { id, label, ...unknown(usage ? "INVALID" : "UNREADABLE") };
    const gib = 1_073_741_824;
    return {
      state: "observed",
      observedAt: at,
      id,
      label,
      totalGiB: round(usage.totalBytes / gib),
      availableGiB: round(usage.availableBytes / gib),
      usedPercent: round((100 * (usage.totalBytes - usage.availableBytes)) / usage.totalBytes),
    };
  }

  private async openbao(at: string): Promise<ServerObservationView["openbao"]> {
    if (!this.options.baoAddress) return unknown("NOT_CONFIGURED");
    const sealed = await this.ports.sealed(this.options.baoAddress);
    return sealed === null ? unknown("UNREACHABLE") : { state: "observed", observedAt: at, sealed };
  }

  private async pgBackup(at: string): Promise<ServerObservationView["pgBackup"]> {
    const directory = this.options.pgBackupDirectory;
    if (!directory) return unknown("NOT_CONFIGURED");
    const names = await this.ports.listDirectory(directory);
    if (names === null) return unknown("UNREADABLE");
    const now = this.ports.now().getTime();
    const age = (iso: string | null) => {
      const parsed = iso ? Date.parse(iso) : Number.NaN;
      return Number.isFinite(parsed) ? round(Math.max(0, now - parsed) / 3_600_000) : null;
    };
    const cellView = (
      allocationId: string,
      status: NonNullable<ReturnType<typeof parseBackupStatus>>,
    ) => ({
      allocationId,
      fullAgeHours: age(status.fullAt),
      differentialAgeHours: age(status.differentialAt),
      archiveCheckAgeHours: age(status.archiveCheckAt),
      archiveCheckOk: status.archiveCheckOk,
      lastFailureAt:
        status.lastFailureAt && Number.isFinite(Date.parse(status.lastFailureAt))
          ? new Date(status.lastFailureAt).toISOString()
          : null,
    });
    const cells: Array<ReturnType<typeof cellView>> = [];
    for (const name of names.sort().slice(0, 64)) {
      const allocationId = name.endsWith(".json") ? name.slice(0, -5) : "";
      if (!UUID.test(allocationId)) continue;
      const status = parseBackupStatus(await this.ports.readText(`${directory}/${name}`));
      if (status) cells.push(cellView(allocationId, status));
    }
    return { state: "observed", observedAt: at, cells };
  }

  private async host(at: string): Promise<ServerObservationView["host"]> {
    const file = this.options.hostHealthFile;
    if (!file) return unknown("NOT_CONFIGURED");
    const raw = await this.ports.readText(file);
    if (raw === null) return unknown("UNREADABLE");
    const digest = parseHostHealth(raw);
    if (!digest) return unknown("INVALID");
    const reported = Date.parse(digest.reportedAt);
    if (this.ports.now().getTime() - reported > HOST_HEALTH_MAX_AGE_MS) return unknown("STALE");
    return {
      state: "observed",
      observedAt: at,
      reportedAt: digest.reportedAt,
      health: digest.health,
    };
  }
}

/** Defensive reader for the host-health file: it is data from another machine, never trusted structure. */
export function parseHostHealth(
  raw: string,
): { reportedAt: string; health: HostHealthDigestView } | null {
  let value: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
    value = parsed as Record<string, unknown>;
  } catch {
    return null;
  }
  const stamp = typeof value.ts === "string" ? Date.parse(value.ts) : Number.NaN;
  const status = value.status;
  if (
    !Number.isFinite(stamp) ||
    (status !== "ok" && status !== "degraded" && status !== "critical")
  )
    return null;
  const record = (v: unknown): Record<string, unknown> =>
    typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  const pool = record(value.pool);
  const capacity = finite(pool.capacity_pct);
  const dumps = Object.values(record(record(value.backups).vzdump))
    .map((entry) => finite(record(entry).age_hours))
    .filter((v): v is number => v !== null);
  const guests = Object.entries(record(value.guests))
    .slice(0, 16)
    .map(([vmid, entry]) => ({
      vmid: vmid.slice(0, 12),
      state: text(record(entry).state, 24) ?? "unknown",
    }));
  const alerts: HostHealthDigestView["alerts"] = [];
  for (const entry of (Array.isArray(value.alerts) ? value.alerts : []).slice(0, 20)) {
    const item = record(entry);
    const message = text(item.message, 240);
    if (message && (item.severity === "critical" || item.severity === "warning"))
      alerts.push({ severity: item.severity, message });
  }
  return {
    reportedAt: new Date(stamp).toISOString(),
    health: {
      hostName: text(value.host, 120),
      status,
      poolHealth: text(pool.health, 40),
      poolCapacityPercent: capacity !== null && capacity <= 100 ? capacity : null,
      scrubAgeDays: finite(record(value.scrub).age_days),
      // The oldest of the newest per-VM archives: the weakest recoverability claim, not the best.
      weakestVmBackupAgeHours: dumps.length ? Math.max(...dumps) : null,
      guests,
      alerts,
    },
  };
}
