import type {
  EnvironmentView,
  OperationalOverviewView,
  OrchestrationDetailView,
  ProjectView,
  ServerObservationView,
} from "@godseye/contracts";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildDecisions,
  dollars,
  openIncidents,
} from "../apps/console/src/components/today/today-data";
import { ApiError } from "../apps/console/src/lib/api";
import { activeNavItem } from "../apps/console/src/lib/navigation";
import { environmentTone, projectState } from "../apps/console/src/lib/project-status";
import {
  cpuLoadPercent,
  memoryUsedPercent,
  oldestBackupAgeHours,
  relativeTime,
} from "../apps/console/src/lib/server-metrics";
import { onStepUpRequest, withStepUp } from "../apps/console/src/lib/step-up";

const NOW = Date.parse("2026-11-17T10:00:00.000Z");
const HOUR = 3_600_000;

const unknown = { state: "unknown", reason: "NOT_CONFIGURED" } as const;
function server(overrides: Partial<ServerObservationView> = {}): ServerObservationView {
  return {
    observedAt: new Date(NOW).toISOString(),
    cpu: unknown,
    memory: unknown,
    uptime: unknown,
    filesystems: [],
    openbao: unknown,
    pgBackup: unknown,
    host: unknown,
    ...overrides,
  };
}

function environment(overrides: Partial<EnvironmentView> = {}): EnvironmentView {
  return {
    id: "env-1",
    projectId: "project-1",
    kind: "production",
    name: "production",
    revision: 1,
    expiresAt: null,
    recoveryHold: false,
    status: "planned",
    requestedState: null,
    isolationProfile: "gvisor-service-sandbox",
    memoryMiB: 1024,
    cpuMilliCores: 1000,
    diskGiB: 10,
    ...overrides,
  };
}

function project(
  environments: EnvironmentView[],
  status: ProjectView["status"] = "draft",
): ProjectView {
  return {
    id: "project-1",
    name: "Melvyn",
    slug: "melvyn",
    kind: "worker",
    description: "",
    status,
    revision: 1,
    createdAt: new Date(NOW).toISOString(),
    updatedAt: new Date(NOW).toISOString(),
    repository: null,
    environments,
  };
}

function plan(
  state: OrchestrationDetailView["state"],
  expiresInMs: number,
): OrchestrationDetailView {
  return {
    plan: {
      id: `plan-${state}`,
      projectId: "project-1",
      environmentId: "env-1",
      expectedProjectRevision: 1,
      expectedEnvironmentRevision: 1,
      title: "Déplacer SQLite",
      epoch: 1,
      maxCostMicros: 400_000,
      steps: [],
      hash: "7f3a9c2eb81d",
      createdAt: new Date(NOW).toISOString(),
      expiresAt: new Date(NOW + expiresInMs).toISOString(),
      sourceTaskId: null,
      supersedesId: null,
    },
    state,
    children: [],
    approvedAt: null,
    approvedBy: null,
    reason: null,
    updatedAt: new Date(NOW).toISOString(),
  } as OrchestrationDetailView;
}

describe("server metrics", () => {
  it("reports unknown instead of a value when nothing was observed", () => {
    expect(cpuLoadPercent(server())).toBeNull();
    expect(memoryUsedPercent(server())).toBeNull();
    expect(oldestBackupAgeHours(server())).toBeNull();
  });

  it("derives load and memory pressure from observed counters", () => {
    const observed = server({
      cpu: {
        state: "observed",
        observedAt: new Date(NOW).toISOString(),
        cores: 8,
        loadAverage1m: 2,
        loadAverage5m: 2,
        loadAverage15m: 2,
      },
      memory: {
        state: "observed",
        observedAt: new Date(NOW).toISOString(),
        totalMiB: 1000,
        availableMiB: 250,
      },
    });
    expect(cpuLoadPercent(observed)).toBe(25);
    expect(memoryUsedPercent(observed)).toBe(75);
  });

  it("treats a cell without a differential backup as infinitely old", () => {
    const observed = server({
      pgBackup: {
        state: "observed",
        observedAt: new Date(NOW).toISOString(),
        cells: [
          {
            allocationId: "6c4f8a0e-0d6c-4a43-9b4c-0b1b6a6a0001",
            fullAgeHours: 3,
            differentialAgeHours: 2,
            archiveCheckAgeHours: 1,
            archiveCheckOk: true,
            lastFailureAt: null,
          },
          {
            allocationId: "6c4f8a0e-0d6c-4a43-9b4c-0b1b6a6a0002",
            fullAgeHours: null,
            differentialAgeHours: null,
            archiveCheckAgeHours: null,
            archiveCheckOk: false,
            lastFailureAt: null,
          },
        ],
      },
    });
    expect(oldestBackupAgeHours(observed)).toBe(Number.POSITIVE_INFINITY);
  });

  it("formats past and future moments in French", () => {
    expect(relativeTime(new Date(NOW - 4 * 60_000).toISOString(), NOW)).toBe("il y a 4 min");
    expect(relativeTime(new Date(NOW + 6 * HOUR).toISOString(), NOW)).toBe("dans 6 h");
  });
});

describe("today decisions", () => {
  const projects = [project([environment()])];

  it("lists pending and clarification plans, the nearest expiry marked urgent", () => {
    const decisions = buildDecisions(
      [
        plan("pending", 2 * HOUR),
        plan("waiting_clarification", 20 * HOUR),
        plan("succeeded", HOUR),
      ],
      undefined,
      projects,
      NOW,
    );
    expect(decisions.map((decision) => [decision.kind, decision.urgent])).toEqual([
      ["Plan Hermes", true],
      ["Question d’Hermes", false],
    ]);
    expect(decisions[0]?.scope).toBe("melvyn · production");
  });

  it("adds a preview that expires within a day, but not one that already expired", () => {
    const decisions = buildDecisions(
      [],
      undefined,
      [
        project([
          environment({
            id: "soon",
            name: "pr-42",
            kind: "preview",
            expiresAt: new Date(NOW + 3 * HOUR).toISOString(),
          }),
          environment({
            id: "gone",
            name: "pr-41",
            kind: "preview",
            expiresAt: new Date(NOW - HOUR).toISOString(),
          }),
        ]),
      ],
      NOW,
    );
    expect(decisions.map((decision) => decision.id)).toEqual(["preview-soon"]);
  });

  it("surfaces chat and execution approvals counted by the control plane", () => {
    const operational = {
      decisionCounts: { foundation: 2, orchestration: 0, chat: 1 },
    } as OperationalOverviewView;
    const decisions = buildDecisions([], operational, projects, NOW);
    expect(decisions.map((decision) => decision.id)).toEqual([
      "chat-proposals",
      "foundation-decisions",
    ]);
  });

  it("keeps only open, unmuted incidents with critical ones first", () => {
    const base = {
      key: "k",
      kind: "health",
      projectId: null,
      environmentId: null,
      allocationId: null,
      subject: null,
      mutedUntil: null,
      resolution: null,
      reason: "r",
      summary: "s",
      occurrences: 1,
      revision: 1,
      delivery: { state: "unconfigured", attempts: 0, lastAttemptAt: null },
    };
    const incidents = openIncidents({
      notifier: "unconfigured",
      incidents: [
        { ...base, id: "warning", severity: "warning", state: "open", muted: false },
        { ...base, id: "muted", severity: "critical", state: "open", muted: true },
        { ...base, id: "resolved", severity: "critical", state: "resolved", muted: false },
        { ...base, id: "critical", severity: "critical", state: "acknowledged", muted: false },
      ],
    } as never);
    expect(incidents.map((incident) => incident.id)).toEqual(["critical", "warning"]);
  });

  it("prints an absent amount as a dash, never as zero", () => {
    expect(dollars(null)).toBe("—");
    expect(dollars(1_500_000)).toBe("1,50 $");
  });
});

describe("project state", () => {
  it("reads a never-provisioned project as declared, not healthy", () => {
    expect(projectState(project([environment()])).tone).toBe("decl");
  });

  it("lets the weakest environment decide, unknown above degraded", () => {
    const state = projectState(
      project(
        [environment({ status: "ready" }), environment({ id: "e2", status: "unknown" })],
        "validated",
      ),
    );
    expect(state).toEqual({ tone: "unk", label: "À réconcilier" });
    expect(environmentTone("quarantined")).toBe("danger");
  });
});

describe("navigation", () => {
  it("assigns project pages to Projets and keeps / exact", () => {
    expect(activeNavItem("/")?.key).toBe("today");
    expect(activeNavItem("/projects/abc")?.key).toBe("projects");
    expect(activeNavItem("/platform/data")?.key).toBe("data");
  });
});

describe("step-up retry", () => {
  let release: (() => void) | undefined;
  afterEach(() => release?.());

  it("runs a refused action once more after the owner confirms", async () => {
    release = onStepUpRequest((request) => request.settle?.(true));
    let calls = 0;
    const result = await withStepUp("Confirmer", async () => {
      calls += 1;
      if (calls === 1) throw new ApiError("step-up", "STEP_UP_REQUIRED", 403);
      return "done";
    });
    expect([result, calls]).toEqual(["done", 2]);
  });

  it("does not retry when the owner cancels the passkey sheet", async () => {
    release = onStepUpRequest((request) => request.settle?.(false));
    let calls = 0;
    await expect(
      withStepUp("Confirmer", async () => {
        calls += 1;
        throw new ApiError("step-up", "STEP_UP_REQUIRED", 403);
      }),
    ).rejects.toThrow("step-up");
    expect(calls).toBe(1);
  });

  it("never retries other refusals", async () => {
    release = onStepUpRequest((request) => request.settle?.(true));
    let calls = 0;
    await expect(
      withStepUp("Confirmer", async () => {
        calls += 1;
        throw new ApiError("conflict", "REVISION_CONFLICT", 409);
      }),
    ).rejects.toThrow("conflict");
    expect(calls).toBe(1);
  });
});
