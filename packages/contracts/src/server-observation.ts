import { z } from "zod";

const Moment = z.string().datetime();
const Quantity = z.number().finite().nonnegative();

/** Why a server value is not reported. Absence of evidence is never rendered as a healthy value. */
export const SERVER_UNKNOWN_REASONS = [
  "NOT_CONFIGURED",
  "UNREADABLE",
  "UNREACHABLE",
  "STALE",
  "INVALID",
] as const;
export const SERVER_FILESYSTEM_IDS = ["pro-root", "cell-data"] as const;
export const HOST_HEALTH_STATUSES = ["ok", "degraded", "critical"] as const;

const Unknown = z.object({
  state: z.literal("unknown"),
  reason: z.enum(SERVER_UNKNOWN_REASONS),
});
const observed = <Shape extends z.ZodRawShape>(shape: Shape) =>
  z.object({ state: z.literal("observed"), observedAt: Moment, ...shape });
const section = <Shape extends z.ZodRawShape>(shape: Shape) =>
  z.discriminatedUnion("state", [observed(shape), Unknown]);

const FilesystemFields = {
  totalGiB: Quantity,
  availableGiB: Quantity,
  usedPercent: z.number().min(0).max(100),
};
const FilesystemIdentity = {
  id: z.enum(SERVER_FILESYSTEM_IDS),
  label: z.string().min(1).max(120),
};

/** Age of each pgBackRest obligation for one cell, from the cell's own status file. */
export const PgBackupCell = z.object({
  allocationId: z.string().uuid(),
  fullAgeHours: Quantity.nullable(),
  differentialAgeHours: Quantity.nullable(),
  archiveCheckAgeHours: Quantity.nullable(),
  archiveCheckOk: z.boolean(),
  lastFailureAt: Moment.nullable(),
});

/** Digest of the Proxmox host's own 15-minute health file; only present when that file is readable here. */
export const HostHealthDigest = z.object({
  hostName: z.string().max(120).nullable(),
  status: z.enum(HOST_HEALTH_STATUSES),
  poolHealth: z.string().max(40).nullable(),
  poolCapacityPercent: z.number().min(0).max(100).nullable(),
  scrubAgeDays: Quantity.nullable(),
  /** Age of the oldest per-VM newest archive: the weakest recoverability claim across guests. */
  weakestVmBackupAgeHours: Quantity.nullable(),
  guests: z.array(z.object({ vmid: z.string().max(12), state: z.string().max(24) })).max(16),
  alerts: z
    .array(z.object({ severity: z.enum(["critical", "warning"]), message: z.string().max(240) }))
    .max(20),
});

/**
 * Read-only server-side observations the control API can truthfully collect from where it runs
 * (the pro VM): kernel counters, filesystem statistics, the OpenBao seal endpoint and status files.
 * The Proxmox host is reported only through its health file when that file has been made readable.
 */
export const ServerObservation = z.object({
  observedAt: Moment,
  cpu: section({
    cores: z.number().int().positive(),
    loadAverage1m: Quantity,
    loadAverage5m: Quantity,
    loadAverage15m: Quantity,
  }),
  memory: section({ totalMiB: Quantity, availableMiB: Quantity }),
  uptime: section({ seconds: Quantity }),
  filesystems: z
    .array(
      z.discriminatedUnion("state", [
        observed({ ...FilesystemIdentity, ...FilesystemFields }),
        Unknown.extend(FilesystemIdentity),
      ]),
    )
    .max(8),
  openbao: section({ sealed: z.boolean() }),
  pgBackup: section({ cells: z.array(PgBackupCell).max(64) }),
  host: section({ reportedAt: Moment, health: HostHealthDigest }),
});
export type HostHealthDigestView = z.infer<typeof HostHealthDigest>;
export type ServerObservationView = z.infer<typeof ServerObservation>;
