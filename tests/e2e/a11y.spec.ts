import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";
import { createProject, mockReleaseData } from "./a11y-fixtures.js";
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

/** Zero axe violations (WCAG 2.2 AA) and no horizontal page scroll on the page as currently shown. */
async function expectAccessible(page: Page) {
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
        await expectAccessible(page);
      });
    }
  });
}

const POPULATED_VIEWPORTS = [VIEWPORTS[0], VIEWPORTS[3]] as const;

for (const viewport of POPULATED_VIEWPORTS) {
  test.describe(`populated states at ${viewport.label}`, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height } });

    test.beforeEach(async ({ page, baseURL }, testInfo) => {
      await enrollConsoleOwner(page, baseURL, testInfo.project.metadata);
    });

    test("project list and project detail with data have no violations", async ({ page }) => {
      const name = `A11y liste ${randomUUID().slice(0, 8)}`;
      const project = await createProject(page, name);
      await expectAccessible(page);
      await page.goto("/projects");
      await expect(page.getByText(name, { exact: true }).first()).toBeVisible();
      await settle(page);
      await expectAccessible(page);
      await page.goto(`/projects/${project.id}`);
      await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
      await settle(page);
      await expectAccessible(page);
    });

    test("release table, build links and platform builds with data have no violations", async ({
      page,
    }) => {
      const project = await createProject(page, `A11y livraison ${randomUUID().slice(0, 8)}`);
      await mockReleaseData(page, project);
      await page.goto("/pipelines");
      const releases = page.getByRole("region", { name: "Versions en service" });
      const row = releases.getByRole("row").filter({ hasText: project.name });
      await expect(row.getByText("a1b2c3d4e5f6")).toBeVisible();
      await expect(releases.getByRole("link", { name: "Voir le build Jenkins" })).toHaveAttribute(
        "href",
        "http://10.20.1.10:8080/job/godseye-platform/42/",
      );
      const platform = page.getByRole("region", { name: "Builds de la plateforme" });
      await expect(platform.getByRole("table").first()).toBeVisible();
      await settle(page);
      await expectAccessible(page);
    });

    test("redeploy confirmation dialog is named, operable by keyboard and has no violations", async ({
      page,
    }) => {
      const project = await createProject(page, `A11y dialogue ${randomUUID().slice(0, 8)}`);
      await mockReleaseData(page, project);
      await page.goto("/pipelines");
      const row = page
        .getByRole("region", { name: "Versions en service" })
        .getByRole("row")
        .filter({ hasText: project.name });
      // Only the production environment has a current release, so only its button is enabled.
      await row.locator("button:enabled", { hasText: "Redéployer" }).click();
      const dialog = page.getByRole("alertdialog", { name: "Confirmer le redéploiement" });
      await expect(dialog).toBeVisible();
      await expectAccessible(page);
      await dialog.getByRole("button", { name: "Annuler", exact: true }).click();
      await expect(dialog).toHaveCount(0);
    });
  });
}

test.describe("forms with errors", () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test.beforeEach(async ({ page, baseURL }, testInfo) => {
    await enrollConsoleOwner(page, baseURL, testInfo.project.metadata);
  });

  test("new project form announces a validation error without violations", async ({ page }) => {
    await page.goto("/projects/new");
    await page.getByLabel("Nom du projet", { exact: true }).fill("Projet invalide");
    await page.getByLabel("Identifiant", { exact: true }).fill("1-invalide");
    // The browser would block this submit with its own bubble; the console's own error is audited.
    await page.locator("form.project-form").evaluate((form) => {
      (form as HTMLFormElement).noValidate = true;
    });
    await page.getByRole("button", { name: "Enregistrer le projet", exact: true }).click();
    await expect(
      page.getByRole("alert").filter({ hasText: "L’identifiant doit commencer" }),
    ).toBeVisible();
    await expectAccessible(page);
  });

  test("a rejected duplicate project shows its server error without violations", async ({
    page,
  }) => {
    const name = `A11y doublon ${randomUUID().slice(0, 8)}`;
    await createProject(page, name);
    await page.goto("/projects/new");
    await page.getByLabel("Nom du projet", { exact: true }).fill(name);
    await page.getByRole("button", { name: "Enregistrer le projet", exact: true }).click();
    await expect(
      page.getByRole("alert").filter({ hasText: "Cet identifiant de projet est déjà utilisé." }),
    ).toBeVisible();
    await expectAccessible(page);
  });

  test("repository form announces a validation error without violations", async ({ page }) => {
    const project = await createProject(page, `A11y dépôt ${randomUUID().slice(0, 8)}`);
    await page.goto(`/projects/${project.id}`);
    await page.getByLabel("Dépôt", { exact: true }).fill("pas un dépôt");
    await page.getByLabel("ID du dépôt", { exact: true }).fill("12345");
    await page.getByLabel("ID de l’installation GitHub App", { exact: true }).fill("67890");
    await page.getByRole("button", { name: "Enregistrer l’association", exact: true }).click();
    await expect(page.getByRole("alert").filter({ hasText: "Vérifiez le dépôt" })).toBeVisible();
    await expectAccessible(page);
  });
});

/** WCAG 1.4.10: content reflows at 320 CSS px (400% of 1280) and stays usable at 200% (640 px). */
const REFLOW_VIEWPORTS = [
  { label: "zoom-200-percent-640", width: 640, height: 512 },
  { label: "reflow-320", width: 320, height: 256 },
] as const;

for (const viewport of REFLOW_VIEWPORTS) {
  test.describe(viewport.label, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height } });

    test.beforeEach(async ({ page, baseURL }, testInfo) => {
      await enrollConsoleOwner(page, baseURL, testInfo.project.metadata);
    });

    for (const route of ROUTES) {
      test(`${route.name} reflows without violations or two-dimensional scrolling`, async ({
        page,
      }) => {
        await page.goto(route.path);
        await expect(page.locator("main h1").first()).toBeVisible();
        await settle(page);
        await expectAccessible(page);
      });
    }

    test("populated release table and dialog reflow without horizontal page scroll", async ({
      page,
    }) => {
      const project = await createProject(page, `A11y reflow ${randomUUID().slice(0, 8)}`);
      await mockReleaseData(page, project);
      await page.goto("/pipelines");
      const row = page
        .getByRole("region", { name: "Versions en service" })
        .getByRole("row")
        .filter({ hasText: project.name });
      await row.locator("button:enabled", { hasText: "Redéployer" }).click();
      await expect(page.getByRole("alertdialog")).toBeVisible();
      await settle(page);
      await expectAccessible(page);
    });
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
