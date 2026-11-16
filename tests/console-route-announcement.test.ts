import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { RouteAnnouncer } from "../apps/console/src/components/route-announcer";
import {
  focusMainLandmark,
  isNavigation,
  MAIN_LANDMARK_ID,
  pageAnnouncement,
  pageTitle,
} from "../apps/console/src/lib/route-announcement";

describe("route focus management", () => {
  it("focuses the main landmark without scrolling", () => {
    const focus = vi.fn<(options?: { preventScroll?: boolean }) => void>();
    const getElementById = vi.fn<(id: string) => { focus: typeof focus } | null>(() => ({ focus }));

    const moved = focusMainLandmark({ getElementById });

    expect(moved).toBe(true);
    expect(getElementById).toHaveBeenCalledWith(MAIN_LANDMARK_ID);
    expect(focus).toHaveBeenCalledWith({ preventScroll: true });
  });

  it("reports false when the main landmark is missing", () => {
    expect(focusMainLandmark({ getElementById: () => null })).toBe(false);
  });

  it("does not treat the first render as a navigation", () => {
    expect(isNavigation(null, "/projects")).toBe(false);
  });

  it("does not treat a re-render on the same path as a navigation", () => {
    expect(isNavigation("/projects", "/projects")).toBe(false);
  });

  it("treats a path change as a navigation", () => {
    expect(isNavigation("/", "/projects")).toBe(true);
  });
});

describe("route announcements", () => {
  it("announces the page name in French", () => {
    expect(pageAnnouncement("Projets")).toBe("Page : Projets");
  });

  it("gives every page a distinct tab title", () => {
    expect(pageTitle("Projets")).not.toBe(pageTitle("Jobs"));
    expect(pageTitle("Projets")).toContain("G.O.D.S.E.Y.E");
  });

  it("renders a polite status region that is empty before any navigation", () => {
    const html = renderToStaticMarkup(
      createElement(RouteAnnouncer, { pathname: "/", label: "Vue d’ensemble" }),
    );

    expect(html).toContain('role="status"');
    expect(html).toContain('aria-label="Navigation"');
    expect(html).not.toContain("Page :");
  });
});
