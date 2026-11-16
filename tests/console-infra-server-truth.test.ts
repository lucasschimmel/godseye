import { DeclareInventory, type InfrastructureHeadroomView } from "@godseye/contracts";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { InfrastructureHeadroomPanel } from "../apps/console/src/components/infra-headroom-panel";
import { InfrastructureInventoryForm } from "../apps/console/src/components/infra-inventory-form";
import { serverInventory } from "../apps/console/src/lib/infra-server-inventory";
import { headroomCallToAction, headroomEvidence } from "../apps/console/src/lib/infra-server-truth";
import { validateDesired } from "../packages/core/src/infra-state.js";

const unknownRow = (resource: "cpu" | "memory") => ({
  resource,
  unit: resource === "cpu" ? ("milliCores" as const) : ("MiB" as const),
  state: "unknown" as const,
  capacity: null,
  committed: 0,
  protectedReserve: null,
  free: null,
  utilization: null,
  pressure: "unknown" as const,
  reason: "Desired inventory is not declared",
});
const headroom: InfrastructureHeadroomView = {
  generatedAt: "2026-11-16T12:00:00.000Z",
  observationState: "unknown",
  pressure: "unknown",
  thresholds: { warn: 0.8, critical: 0.9 },
  scopes: [
    {
      scope: "host",
      name: "Physical host",
      pressure: "unknown",
      resources: [unknownRow("cpu"), unknownRow("memory")],
    },
  ],
  heavyQueue: { maxConcurrent: 1, maxQueued: 4, running: 0, queued: 0, full: false, reason: null },
  admission: { state: "open", reason: null, updatedAt: null, revision: 0 },
} as unknown as InfrastructureHeadroomView;
const render = (evidence: "table" | "declare" | "measure") =>
  renderToStaticMarkup(
    createElement(InfrastructureHeadroomPanel, {
      data: headroom,
      fresh: true,
      busy: false,
      onAdmission: () => undefined,
      evidence,
    }),
  );

describe("server topology defaults", () => {
  it("is a valid declaration under the same contract the API enforces", () => {
    expect(() => DeclareInventory.parse(serverInventory)).not.toThrow();
  });

  it("passes the core capacity and network validation without edits", () => {
    expect(() => validateDesired(structuredClone(serverInventory))).not.toThrow();
  });

  it("records the measured host: 64 076 MiB of memory and the 472 GiB pool", () => {
    expect(serverInventory.host.capacity).toMatchObject({ memoryMiB: 64_076, storageGiB: 472 });
  });

  it("records the three guests actually created, with their real sizes", () => {
    const byRole = Object.fromEntries(serverInventory.guests.map((g) => [g.role, g.capacity]));
    expect(byRole.professional).toMatchObject({ memoryMiB: 32_768, storageGiB: 320 });
    expect(byRole.games).toMatchObject({ memoryMiB: 16_384, storageGiB: 80 });
    expect(byRole.task).toMatchObject({ memoryMiB: 6_144, storageGiB: 20 });
  });

  it("does not carry the generic planning defaults", () => {
    expect(serverInventory.host.capacity.memoryMiB).not.toBe(65_536);
    expect(serverInventory.host.capacity.storageGiB).not.toBe(960);
  });
});

describe("headroom evidence on the server", () => {
  const declared = { desired: serverInventory } as const;
  it("asks for the topology when nothing is declared", () => {
    expect(headroomEvidence(true, { desired: null, observationState: "unknown" })).toBe("declare");
  });

  it("asks for a measurement when the topology is declared but nothing fresh is observed", () => {
    expect(headroomEvidence(true, { ...declared, observationState: "stale" })).toBe("measure");
  });

  it("shows the table once the topology is declared and observed", () => {
    expect(headroomEvidence(true, { ...declared, observationState: "observed" })).toBe("table");
  });

  it("keeps the table in local mode whatever the evidence", () => {
    expect(headroomEvidence(false, { desired: null, observationState: "unknown" })).toBe("table");
  });
});

describe("headroom panel without evidence", () => {
  it("replaces the unknown wall by one call to action", () => {
    const html = render("declare");
    expect(html).toContain(headroomCallToAction.declare);
    expect(html).not.toContain("Pression globale");
    expect(html).not.toContain("Inconnu");
  });

  it("keeps the admission controls available", () => {
    expect(render("declare")).toContain("Suspendre l’admission");
  });

  it("still renders the tables when asked to", () => {
    expect(render("table")).toContain("Pression globale : Inconnu");
  });
});

describe("inventory form defaults", () => {
  const overview = { desired: null, revision: 0 } as never;
  const form = (serverDefaults: boolean) =>
    renderToStaticMarkup(
      createElement(InfrastructureInventoryForm, {
        overview,
        disabled: false,
        save: async () => undefined,
        serverDefaults,
      }),
    );

  it("pre-fills the real server values and states their basis", () => {
    const html = form(true);
    expect(html).toContain('value="64076"');
    expect(html).toContain('value="472"');
    expect(html).toContain("480 GiB sur 472 GiB");
  });

  it("keeps the generic planning values outside server mode", () => {
    const html = form(false);
    expect(html).toContain('value="65536"');
    expect(html).not.toContain("inventory-basis");
  });
});
