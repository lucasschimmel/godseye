import {
  CONTROL_API_HEADER,
  CONTROL_API_VERSION,
  ServerObservation,
  type ServerObservationView,
} from "@godseye/contracts";
import { InfrastructureEngine, ServerObserver, type ServerObserverPorts } from "@godseye/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../apps/control-api/src/app.js";
import { loadConfiguration } from "../apps/control-api/src/config.js";
import { type OwnerAuthFixture, ownerAuthFixture } from "./owner-auth-fixture.js";

const NOW = new Date("2026-11-16T12:00:00.000Z");
const CELL = "0b6f2c1e-3a4d-4e5f-8a9b-1c2d3e4f5a6b";
const owner = { id: "owner", kind: "owner", projectIds: [] } as const;
const GIB = 1_073_741_824;

const hostHealth = (ts: string) =>
  JSON.stringify({
    ts,
    schema: 2,
    host: "godseye-wg",
    status: "degraded",
    pool: { health: "ONLINE", capacity_pct: 41 },
    scrub: { age_days: 12.5 },
    backups: { vzdump: { "100": { age_hours: 5.2 }, "200": { age_hours: 7.9 } } },
    guests: { "100": { state: "running" }, "300": { state: "stopped" } },
    alerts: [
      { severity: "warning", message: "host has a pending reboot" },
      { severity: "bogus", message: "dropped" },
    ],
  });

function ports(files: Record<string, string>, overrides: Partial<ServerObserverPorts> = {}) {
  return {
    now: () => NOW,
    cores: () => 4,
    readText: async (path: string) => files[path] ?? null,
    listDirectory: async (path: string) =>
      path === "/pg"
        ? Object.keys(files)
            .filter((p) => p.startsWith("/pg/"))
            .map((p) => p.slice(4))
        : null,
    filesystem: async (path: string) =>
      path === "/" ? { totalBytes: 100 * GIB, availableBytes: 25 * GIB } : null,
    sealed: async () => false,
    ...overrides,
  } satisfies Partial<ServerObserverPorts>;
}

describe("server observation", () => {
  it("reports every unconfigured or unreadable source as unknown, never healthy", async () => {
    const view = await new ServerObserver({ ports: ports({}) }).observe(owner);
    expect(ServerObservation.parse(view)).toEqual(view);
    expect(view.cpu).toEqual({ state: "unknown", reason: "UNREADABLE" });
    expect(view.memory.state).toBe("unknown");
    expect(view.uptime.state).toBe("unknown");
    expect(view.openbao).toEqual({ state: "unknown", reason: "NOT_CONFIGURED" });
    expect(view.pgBackup).toEqual({ state: "unknown", reason: "NOT_CONFIGURED" });
    expect(view.host).toEqual({ state: "unknown", reason: "NOT_CONFIGURED" });
    expect(view.filesystems.map((f) => f.state)).toEqual(["unknown", "unknown"]);
  });

  it("derives kernel and filesystem values from real file contents", async () => {
    const view = await new ServerObserver({
      rootPath: "/",
      cellDataPath: "/missing",
      baoAddress: "https://bao.internal:8200",
      ports: ports({
        "/proc/loadavg": "0.50 1.25 2.00 1/200 999\n",
        "/proc/meminfo": "MemTotal:       8388608 kB\nMemAvailable:   2097152 kB\n",
        "/proc/uptime": "3600.55 12000.00\n",
      }),
    }).observe(owner);
    expect(view.cpu).toMatchObject({
      state: "observed",
      cores: 4,
      loadAverage1m: 0.5,
      loadAverage15m: 2,
    });
    expect(view.memory).toMatchObject({ totalMiB: 8192, availableMiB: 2048 });
    expect(view.uptime).toMatchObject({ seconds: 3600 });
    expect(view.filesystems[0]).toMatchObject({ id: "pro-root", totalGiB: 100, usedPercent: 75 });
    expect(view.filesystems[1]).toMatchObject({
      id: "cell-data",
      state: "unknown",
      reason: "UNREADABLE",
    });
    expect(view.openbao).toMatchObject({ state: "observed", sealed: false });
  });

  it("rejects malformed kernel data and reports an unreachable seal endpoint as unknown", async () => {
    const view = await new ServerObserver({
      baoAddress: "https://bao.internal:8200",
      ports: ports(
        { "/proc/loadavg": "nan x y", "/proc/meminfo": "MemTotal: 1 kB\nMemAvailable: 5 kB\n" },
        { sealed: async () => null },
      ),
    }).observe(owner);
    expect(view.cpu).toEqual({ state: "unknown", reason: "INVALID" });
    expect(view.memory).toEqual({ state: "unknown", reason: "INVALID" });
    expect(view.openbao).toEqual({ state: "unknown", reason: "UNREACHABLE" });
  });

  it("reads per-cell backup ages and ignores unrelated files", async () => {
    const view = await new ServerObserver({
      pgBackupDirectory: "/pg",
      ports: ports({
        [`/pg/${CELL}.json`]: JSON.stringify({
          fullAt: "2026-11-15T12:00:00Z",
          archiveCheckAt: "2026-11-16T11:30:00Z",
          archiveCheckOk: true,
          lastFailureAt: "2026-11-10T00:00:00Z",
        }),
        "/pg/notes.json": "{}",
        [`/pg/${CELL.replace("0b", "0c")}.json`]: "not json",
      }),
    }).observe(owner);
    expect(view.pgBackup).toMatchObject({
      state: "observed",
      cells: [
        {
          allocationId: CELL,
          fullAgeHours: 24,
          differentialAgeHours: null,
          archiveCheckAgeHours: 0.5,
          archiveCheckOk: true,
          lastFailureAt: "2026-11-10T00:00:00.000Z",
        },
      ],
    });
  });

  it("digests a fresh host health file, filters bad alerts and refuses stale or invalid ones", async () => {
    const observe = (content: string | null) =>
      new ServerObserver({
        hostHealthFile: "/host.json",
        ports: ports(content === null ? {} : { "/host.json": content }),
      }).observe(owner);
    const fresh = await observe(hostHealth("2026-11-16T11:50:00Z"));
    expect(fresh.host).toMatchObject({
      state: "observed",
      health: {
        hostName: "godseye-wg",
        status: "degraded",
        poolCapacityPercent: 41,
        scrubAgeDays: 12.5,
        weakestVmBackupAgeHours: 7.9,
        alerts: [{ severity: "warning", message: "host has a pending reboot" }],
      },
    });
    expect((await observe(hostHealth("2026-11-16T10:00:00Z"))).host).toEqual({
      state: "unknown",
      reason: "STALE",
    });
    expect((await observe("{")).host).toEqual({ state: "unknown", reason: "INVALID" });
    expect((await observe(null)).host).toEqual({ state: "unknown", reason: "UNREADABLE" });
  });

  it("refuses non-owner actors", async () => {
    await expect(
      new ServerObserver({ ports: ports({}) }).observe({
        id: "agent",
        kind: "service",
        projectIds: [],
      }),
    ).rejects.toMatchObject({ status: 403 });
  });
});

describe("GET /infrastructure/server", () => {
  let fixture: OwnerAuthFixture;
  let headers: Headers;
  let app: ReturnType<typeof createApp>;
  beforeEach(async () => {
    fixture = await ownerAuthFixture();
    app = createApp(
      fixture.core,
      loadConfiguration({ GODSEYE_MODE: "local" }),
      fixture.identity,
      undefined,
      undefined,
      new InfrastructureEngine(fixture.store),
      new ServerObserver({ rootPath: "/", ports: ports({ "/proc/uptime": "90.0 0.0" }) }),
    );
    headers = (await fixture.session()).headers;
    headers.set(CONTROL_API_HEADER, CONTROL_API_VERSION);
  });
  afterEach(async () => fixture.close());

  it("serves a contract-valid observation to the signed-in owner only", async () => {
    const response = await app.request(new URL("/api/v1/infrastructure/server", fixture.origin), {
      headers,
    });
    expect(response.status).toBe(200);
    const view: ServerObservationView = ServerObservation.parse(await response.json());
    expect(view.uptime).toMatchObject({ state: "observed", seconds: 90 });
    expect(view.filesystems[0]).toMatchObject({ state: "observed", usedPercent: 75 });
    const anonymous = await app.request(new URL("/api/v1/infrastructure/server", fixture.origin), {
      headers: { origin: fixture.origin, host: new URL(fixture.origin).host },
    });
    expect(anonymous.status).toBe(401);
  });
});
