import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { RedeployControl } from "../apps/console/src/components/redeploy-control";
import { type RedeployContext, redeployBlockReason } from "../apps/console/src/lib/redeploy";

const now = Date.parse("2026-11-16T12:00:00.000Z");
const environmentId = "11111111-1111-4111-8111-111111111111";
const ready: RedeployContext = {
  environment: { kind: "production", recoveryHold: false, deliveryHold: false },
  environmentId,
  run: { state: "active", artifactId: "22222222-2222-4222-8222-222222222222" },
  delivery: {
    execution: "configured",
    source: "configured",
    policies: [
      {
        environmentId,
        revokedAt: null,
        expiresAt: "2026-11-20T12:00:00.000Z",
      } as RedeployContext["delivery"]["policies"][number],
    ],
  },
  fresh: true,
  now,
};

describe("redeploy availability", () => {
  it("is available for a verified current release with a current policy and a fresh owner", () => {
    expect(redeployBlockReason(ready)).toBeNull();
  });

  it.each([
    ["no current release", { run: null }, /Aucune version courante/],
    [
      "a release that is not active",
      { run: { state: "retired" as const, artifactId: "x" } },
      /Aucune version courante/,
    ],
    [
      "a recovery hold",
      { environment: { ...ready.environment, recoveryHold: true } },
      /restauration/,
    ],
    [
      "a delivery hold",
      { environment: { ...ready.environment, deliveryHold: true } },
      /Livraison suspendue/,
    ],
    [
      "unconfigured execution",
      { delivery: { ...ready.delivery, execution: "unconfigured" as const } },
      /non configurée/,
    ],
    [
      "an unconfigured source",
      { delivery: { ...ready.delivery, source: "unconfigured" as const } },
      /Source GitHub/,
    ],
    ["no policy", { delivery: { ...ready.delivery, policies: [] } }, /politique/],
    ["a stale owner confirmation", { fresh: false }, /clé d’accès/],
  ])("is blocked with a stated reason for %s", (_label, change, reason) => {
    expect(redeployBlockReason({ ...ready, ...change })).toMatch(reason);
  });
});

describe("redeploy control", () => {
  const props = {
    project: "Site vitrine",
    environment: "Production",
    commit: "abcdef123456",
    digest: `sha256:${"a".repeat(64)}`,
    pending: false,
    onConfirm: () => {},
  };

  it("shows a disabled button that explains why", () => {
    const html = renderToStaticMarkup(
      createElement(RedeployControl, { ...props, reason: "Aucune version courante vérifiée." }),
    );

    expect(html).toContain(' disabled=""');
    expect(html).toContain("Aucune version courante vérifiée.");
  });

  it("shows an enabled button without any reason when allowed", () => {
    const html = renderToStaticMarkup(createElement(RedeployControl, { ...props, reason: null }));

    expect(html).not.toContain(' disabled=""');
    expect(html).not.toContain("alertdialog");
  });

  it("asks for confirmation naming the same image and that no build happens", () => {
    const html = renderToStaticMarkup(
      createElement(RedeployControl, { ...props, reason: null, initialOpen: true }),
    );

    expect(html).toContain('role="alertdialog"');
    expect(html).toContain("Aucune nouvelle construction");
    expect(html).toContain("Confirmer le redéploiement");
  });
});
