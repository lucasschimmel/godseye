import { describe, expect, it } from "vitest";
import {
  backupScheduleDetector,
  evaluateBackupStatus,
  parseBackupStatus,
} from "../packages/core/src/backup-schedule.js";
import { type CellHostExecutor, parseCellHost } from "../packages/core/src/cell-host.js";

const NOW = new Date("2026-11-15T12:00:00Z");
const ago = (hours: number) => new Date(NOW.getTime() - hours * 3_600_000).toISOString();
const healthy = {
  fullAt: ago(48),
  differentialAt: ago(10),
  archiveCheckAt: ago(0.2),
  archiveCheckOk: true,
  lastFailureAt: null,
};

describe("evaluateBackupStatus", () => {
  it("accepts a cell within its cadence", () => {
    expect(evaluateBackupStatus(healthy, NOW)).toBeNull();
  });
  it("raises unknown when no record exists", () => {
    expect(evaluateBackupStatus(null, NOW)?.reason).toBe("BACKUP_STATUS_UNKNOWN");
  });
  it("raises a failed archive check as critical", () => {
    const result = evaluateBackupStatus({ ...healthy, archiveCheckOk: false }, NOW);
    expect(result).toMatchObject({ reason: "ARCHIVE_CHECK_FAILED_OR_OVERDUE", critical: true });
  });
  it("raises an overdue weekly full", () => {
    expect(evaluateBackupStatus({ ...healthy, fullAt: ago(24 * 12) }, NOW)?.reason).toBe(
      "FULL_BACKUP_OVERDUE",
    );
  });
  it("raises an overdue daily differential as a warning", () => {
    expect(evaluateBackupStatus({ ...healthy, differentialAt: ago(60) }, NOW)).toMatchObject({
      reason: "DIFFERENTIAL_BACKUP_OVERDUE",
      critical: false,
    });
  });
  it("treats unparseable status as unknown", () => {
    expect(parseBackupStatus("{not json")).toBeNull();
  });
});

describe("backupScheduleDetector", () => {
  const files = new Map<string, string>();
  const executor: CellHostExecutor = {
    run: async () => "",
    writeFile: async () => {},
    readFile: async (path) => files.get(path) ?? null,
    listDirectory: async () => [
      "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    ],
    removeFile: async () => {},
  };
  const host = parseCellHost({
    zfsParent: "tank/godseye/pg",
    mountRoot: "/srv/godseye/pg",
    bindAddress: "127.0.0.1",
    servername: "pg.cells.internal",
    portRange: [15432, 15440],
  });
  it("emits findings for overdue cells and covers healthy ones", async () => {
    const [a, b] = ["aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"];
    for (const id of [a, b])
      files.set(`/etc/godseye/pg/${id}/cell.env`, `PROJECT=p-${id}\nENVIRONMENT=e-${id}\n`);
    files.set(`/var/lib/godseye/pg-backup/${a}.json`, JSON.stringify(healthy));
    files.set(
      `/var/lib/godseye/pg-backup/${b}.json`,
      JSON.stringify({ ...healthy, fullAt: ago(400) }),
    );

    const result = await backupScheduleDetector({ host, executor, now: () => NOW })();

    expect(result.coveredKeys).toEqual([`archive-lag:e-${a}:${a}`]);
    expect(result.findings.map((f) => [f.key, f.reason])).toEqual([
      [`archive-lag:e-${b}:${b}`, "FULL_BACKUP_OVERDUE"],
    ]);
  });
});
