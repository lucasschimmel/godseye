import { mkdirSync } from "node:fs";
import { join } from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";
import { enrollConsoleOwner } from "./owner-fixture.js";

/** Every owner-console page reachable from the main navigation, rendered in local mode. */
const ROUTES = [
  { path: "/", name: "overview" },
  { path: "/projects", name: "projects" },
  { path: "/databases", name: "databases" },
  { path: "/pipelines", name: "pipelines" },
  { path: "/jobs", name: "jobs" },
  { path: "/usage", name: "usage" },
  { path: "/observability", name: "observability" },
  { path: "/operations", name: "operations" },
  { path: "/infrastructure", name: "infrastructure" },
  { path: "/agents", name: "agents" },
  { path: "/security", name: "security" },
  { path: "/access", name: "access" },
] as const;

const VIEWPORTS = [
  { label: "desktop-1280", width: 1280, height: 900 },
  { label: "tablet-1024", width: 1024, height: 768 },
  { label: "tablet-768", width: 768, height: 1024 },
  { label: "mobile-375", width: 375, height: 812 },
] as const;

const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
const SCREENSHOT_DIR = process.env.GODSEYE_A11Y_SCREENSHOTS;

async function settle(page: Page) {
  await page.waitForLoadState("networkidle");
  // Loading placeholders would otherwise be audited instead of the real panel.
  await expect(page.getByText("Chargement des données…")).toHaveCount(0, { timeout: 15_000 });
}

for (const viewport of VIEWPORTS) {
  test.describe(viewport.label, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height } });

    test.beforeEach(async ({ page, baseURL }, testInfo) => {
      await enrollConsoleOwner(page, baseURL, testInfo.project.metadata);
    });

    for (const route of ROUTES) {
      test(`${route.name} has no axe violations and no horizontal overflow`, async ({ page }) => {
        await page.goto(route.path);
        await expect(page.locator("main h1").first()).toBeVisible();
        await settle(page);
        if (SCREENSHOT_DIR) {
          mkdirSync(SCREENSHOT_DIR, { recursive: true });
          await page.screenshot({
            path: join(SCREENSHOT_DIR, `${route.name}-${viewport.label}.png`),
            fullPage: true,
          });
        }
        const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
        const summary = results.violations.map((violation) => ({
          rule: violation.id,
          impact: violation.impact,
          targets: violation.nodes.slice(0, 4).map((node) => node.target.join(" ")),
        }));
        expect(summary).toEqual([]);
        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        );
        expect(overflow).toBeLessThanOrEqual(0);
      });
    }
  });
}

test.describe("keyboard and landmarks", () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test.beforeEach(async ({ page, baseURL }, testInfo) => {
    await enrollConsoleOwner(page, baseURL, testInfo.project.metadata);
  });

  test("skip link is the first tab stop and moves focus to the main landmark", async ({ page }) => {
    await page.goto("/projects");
    await expect(page.locator("main h1").first()).toBeVisible();
    await page.keyboard.press("Tab");
    const skip = page.getByRole("link", { name: "Aller au contenu" });
    await expect(skip).toBeFocused();
    await expect(skip).toBeInViewport();
    await page.keyboard.press("Enter");
    await expect(page.locator("main#main-content")).toBeFocused();
  });

  test("exposes one banner, one main, labelled navigation and a single h1", async ({ page }) => {
    await page.goto("/infrastructure");
    await expect(page.locator("main h1").first()).toBeVisible();
    await expect(page.getByRole("banner")).toHaveCount(1);
    await expect(page.getByRole("main")).toHaveCount(1);
    await expect(page.getByRole("contentinfo")).toHaveCount(1);
    await expect(page.getByRole("navigation", { name: "Navigation principale" })).toHaveCount(1);
    await expect(page.locator("h1")).toHaveCount(1);
  });

  test("route changes move focus to the main landmark and announce the page", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("main h1").first()).toBeVisible();
    await page
      .getByRole("navigation", { name: "Navigation principale" })
      .getByRole("link", { name: "Projets", exact: true })
      .click();
    await expect(page.getByRole("heading", { name: "Projets", level: 1 })).toBeVisible();
    await expect(page.locator("main#main-content")).toBeFocused();
    await expect(page.locator("[data-route-announcer]")).toContainText("Projets");
  });

  test("keyboard focus is always visible", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("main h1").first()).toBeVisible();
    for (let step = 0; step < 14; step++) {
      await page.keyboard.press("Tab");
      const outline = await page.evaluate(() => {
        const style = getComputedStyle(document.activeElement as Element);
        return `${style.outlineStyle}:${Number.parseFloat(style.outlineWidth)}`;
      });
      expect(outline).not.toMatch(/^(none|hidden):/);
    }
  });

  test("reduced motion disables transitions and animations", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/");
    await expect(page.locator("main h1").first()).toBeVisible();
    const offenders = await page.evaluate(() =>
      [...document.querySelectorAll("*")]
        .filter((element) => {
          const style = getComputedStyle(element);
          const seconds = (value: string) =>
            Math.max(...value.split(",").map((part) => Number.parseFloat(part) || 0));
          return (
            seconds(style.transitionDuration) > 0.01 || seconds(style.animationDuration) > 0.01
          );
        })
        .map((element) => element.className.toString() || element.tagName)
        .slice(0, 8),
    );
    expect(offenders).toEqual([]);
  });
});
