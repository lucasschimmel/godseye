import type { DomainTlsView } from "@godseye/contracts";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DomainTlsCell } from "../apps/console/src/components/domain-tls-cell";

const NOW = new Date("2026-11-16T12:00:00.000Z");
const DAY_MS = 86_400_000;
const tls = (patch: Partial<DomainTlsView>): DomainTlsView => ({
  state: "valid",
  expiresAt: new Date(NOW.getTime() + 60 * DAY_MS).toISOString(),
  reason: null,
  checkedAt: NOW.toISOString(),
  ...patch,
});
const render = (view: DomainTlsView) =>
  renderToStaticMarkup(createElement(DomainTlsCell, { tls: view, nowMs: NOW.getTime() }));

describe("domain TLS cell", () => {
  it("shows a valid certificate with its expiry date and no warning", () => {
    const html = render(tls({}));
    expect(html).toContain("Valide");
    expect(html).toContain("2027");
    expect(html).not.toContain("Expire bientôt");
  });

  it("warns in French with the remaining days when the certificate expires soon", () => {
    const html = render(
      tls({ state: "expiring", expiresAt: new Date(NOW.getTime() + 5 * DAY_MS).toISOString() }),
    );
    expect(html).toContain("Expire bientôt");
    expect(html).toContain("5 jours");
  });

  it("shows an expired certificate as expired", () => {
    const html = render(
      tls({ state: "expired", expiresAt: new Date(NOW.getTime() - DAY_MS).toISOString() }),
    );
    expect(html).toContain("Expiré");
  });

  it("states the unknown reason instead of a date", () => {
    const html = render(tls({ state: "unknown", expiresAt: null, reason: "PROBE_NOT_CONFIGURED" }));
    expect(html).toContain("Inconnue");
    expect(html).toContain("mode local");
  });
});
