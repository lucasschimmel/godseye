import type { ServerObservationView } from "@godseye/contracts";

/** Load average over 5 minutes relative to the core count, in percent; null when unknown. */
export function cpuLoadPercent(data: ServerObservationView | undefined): number | null {
  const cpu = data?.cpu;
  if (cpu?.state !== "observed" || cpu.cores <= 0) return null;
  return Math.round((cpu.loadAverage5m / cpu.cores) * 100);
}

/** Memory in use (total minus available), in percent; null when unknown. */
export function memoryUsedPercent(data: ServerObservationView | undefined): number | null {
  const memory = data?.memory;
  if (memory?.state !== "observed" || memory.totalMiB <= 0) return null;
  return Math.round(((memory.totalMiB - memory.availableMiB) / memory.totalMiB) * 100);
}

export function uptimeLabel(data: ServerObservationView | undefined): string | null {
  const uptime = data?.uptime;
  if (uptime?.state !== "observed") return null;
  const hours = Math.floor(uptime.seconds / 3600);
  const days = Math.floor(hours / 24);
  return days > 0 ? `${days} j ${hours % 24} h` : `${hours} h`;
}

/** Oldest pgBackRest differential across cells, in hours; null when not observed. */
export function oldestBackupAgeHours(data: ServerObservationView | undefined): number | null {
  const backup = data?.pgBackup;
  if (backup?.state !== "observed" || !backup.cells.length) return null;
  const ages = backup.cells.map((cell) =>
    Math.max(cell.differentialAgeHours ?? Number.POSITIVE_INFINITY, 0),
  );
  return Math.max(...ages);
}

/** Relative French time, coarse on purpose ("il y a 4 min"). */
export function relativeTime(iso: string, now = Date.now()): string {
  const seconds = Math.round((now - new Date(iso).getTime()) / 1000);
  if (Math.abs(seconds) < 45) return "à l’instant";
  const future = seconds < 0;
  const abs = Math.abs(seconds);
  const unit =
    abs < 3600
      ? `${Math.round(abs / 60)} min`
      : abs < 86_400
        ? `${Math.round(abs / 3600)} h`
        : `${Math.round(abs / 86_400)} j`;
  return future ? `dans ${unit}` : `il y a ${unit}`;
}
