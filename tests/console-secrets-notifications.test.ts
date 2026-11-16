import type { AccessOverviewView, IncidentOverviewView, ProjectDTO } from "@godseye/contracts";
import { describe, expect, it } from "vitest";
import { channelStatus } from "../apps/console/src/lib/notification-channels";
import {
  bindingLabels,
  bindingRows,
  IMPORT_EXPLANATION,
  providerExplanations,
  rotationExplanations,
  rotationHeadings,
} from "../apps/console/src/lib/secrets-bindings";

const P = "11111111-1111-4111-8111-111111111111";
const E = "22222222-2222-4222-8222-222222222222";
const I = "33333333-3333-4333-8333-333333333333";
const S = "44444444-4444-4444-8444-444444444444";
const project = {
  id: P,
  name: "Atelier",
  environments: [
    { id: E, name: "dev", kind: "development", recoveryHold: false, deliveryHold: false },
  ],
} as unknown as ProjectDTO;
const identity = {
  id: I,
  projectId: P,
  environmentId: E,
  purpose: "runtime",
  name: "Runtime",
  status: "active",
} as AccessOverviewView["identities"][number];
const slot = (state: AccessOverviewView["slots"][number]["state"]) =>
  ({
    id: S,
    identityId: I,
    name: "Connexion",
    state,
    activeVersion: null,
    stagedVersion: null,
  }) as AccessOverviewView["slots"][number];
const access = (partial: Partial<AccessOverviewView>): AccessOverviewView => ({
  provider: { state: "ready" },
  identities: [],
  slots: [],
  operations: [],
  adapters: [],
  ...partial,
});

describe("secret bindings per environment", () => {
  it("reports an environment without identity", () => {
    const [row] = bindingRows([project], access({}));
    expect(row?.state).toBe("no-identity");
  });

  it("reports an identity without slot", () => {
    const [row] = bindingRows([project], access({ identities: [identity] }));
    expect(row?.state).toBe("no-slot");
  });

  it("reports an empty slot as no imported value", () => {
    const [row] = bindingRows(
      [project],
      access({ identities: [identity], slots: [slot("empty")] }),
    );
    expect(bindingLabels[row?.state ?? "unknown"]).toMatch(/aucune valeur importée/);
  });

  it("reports an active slot with the latest operation timestamp", () => {
    const op = (createdAt: string) =>
      ({ id: I, slotId: S, createdAt }) as AccessOverviewView["operations"][number];
    const [row] = bindingRows(
      [project],
      access({
        identities: [identity],
        slots: [slot("active")],
        operations: [op("2026-11-01T00:00:00.000Z"), op("2026-11-10T00:00:00.000Z")],
      }),
    );
    expect([row?.state, row?.lastOperationAt]).toEqual(["active", "2026-11-10T00:00:00.000Z"]);
  });

  it("prefers the unresolved state over an active one", () => {
    const [row] = bindingRows(
      [project],
      access({ identities: [identity], slots: [slot("unknown"), slot("active")] }),
    );
    expect(row?.state).toBe("unknown");
  });

  it("reports a revoked identity", () => {
    const [row] = bindingRows(
      [project],
      access({ identities: [{ ...identity, status: "revoked" }], slots: [slot("active")] }),
    );
    expect(row?.state).toBe("revoked");
  });

  it("skips recovery environments", () => {
    const held = {
      ...project,
      environments: [{ ...project.environments[0], kind: "recovery" }],
    } as unknown as ProjectDTO;
    expect(bindingRows([held], access({}))).toEqual([]);
  });

  it("explains every provider state and the owner-only import without placeholders", () => {
    const texts = [
      ...Object.values(providerExplanations),
      ...Object.values(rotationExplanations),
      ...Object.values(rotationHeadings),
      IMPORT_EXPLANATION.where,
      IMPORT_EXPLANATION.why,
    ];
    expect(texts.filter((text) => /à connecter/.test(text))).toEqual([]);
  });
});

const incident = (
  state: IncidentOverviewView["incidents"][number]["delivery"]["state"],
  lastAttemptAt: string | null,
) =>
  ({
    delivery: { state, attempts: lastAttemptAt ? 1 : 0, lastAttemptAt },
  }) as IncidentOverviewView["incidents"][number];

describe("notification channel status", () => {
  it("states that no channel is configured and what the owner must do", () => {
    const status = channelStatus({ notifier: "unconfigured", incidents: [] });
    expect([status.state, status.title, Boolean(status.ownerAction)]).toEqual([
      "not-configured",
      "Aucun canal configuré",
      true,
    ]);
  });

  it("shows the latest recorded delivery attempt and counts", () => {
    const status = channelStatus({
      notifier: "configured",
      incidents: [
        incident("notified", "2026-11-10T00:00:00.000Z"),
        incident("failed", "2026-11-12T00:00:00.000Z"),
        incident("pending", null),
      ],
    });
    expect([status.lastAttemptAt, status.counts.notified, status.counts.failed]).toEqual([
      "2026-11-12T00:00:00.000Z",
      1,
      1,
    ]);
  });

  it("does not claim a delivery when none was recorded", () => {
    const status = channelStatus({
      notifier: "configured",
      incidents: [incident("pending", null)],
    });
    expect([status.state, status.lastAttemptAt, status.ownerAction]).toEqual([
      "configured",
      null,
      null,
    ]);
  });
});
