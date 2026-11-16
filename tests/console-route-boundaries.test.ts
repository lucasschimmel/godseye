import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { RouteError, RoutePending } from "../apps/console/src/components/route-boundaries";

describe("route boundaries", () => {
  it("shows the failure message with a retry button", () => {
    const html = renderToStaticMarkup(
      createElement(RouteError, { error: new Error("Panneau indisponible"), reset: () => {} }),
    );

    expect(html).toContain("Panneau indisponible");
    expect(html).toContain("Réessayer");
    expect(html).toContain('role="alert"');
  });

  it("shows a neutral French loading state", () => {
    const html = renderToStaticMarkup(createElement(RoutePending));

    expect(html).toContain("Chargement des données…");
    expect(html).not.toMatch(/local/i);
  });
});
