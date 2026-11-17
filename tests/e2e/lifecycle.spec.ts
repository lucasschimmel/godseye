import { randomUUID } from "node:crypto";
import { expect, type Page, test } from "@playwright/test";
import { enrollConsoleOwner } from "./owner-fixture.js";

test.use({ timezoneId: "Europe/Paris" });
test.beforeEach(async ({ page, baseURL }, testInfo) => {
  await enrollConsoleOwner(page, baseURL, testInfo.project.metadata);
});

async function createProject(page: Page, prefix: string) {
  const name = `${prefix} ${randomUUID().slice(0, 8)}`;
  await page.goto("/projects/new");
  await page.getByLabel("Nom du projet", { exact: true }).fill(name);
  await page.getByRole("button", { name: "Enregistrer le projet", exact: true }).click();
  await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
  await page
    .getByRole("navigation", { name: "Sections du projet" })
    .getByRole("link", { name: "Cycle de vie" })
    .click();
  return name;
}
const panel = (page: Page) => page.getByRole("region", { name: "Cycle de vie du projet" });

test("walks suspension, export, quarantine and release without claiming physical stops", async ({
  page,
}) => {
  await createProject(page, "Lifecycle");
  const lifecycle = panel(page);
  await expect(lifecycle.getByText(/aucune ressource physique enregistrée/i)).toBeVisible();
  await expect(lifecycle.getByText(/Suspendez le projet avant d’engager/)).toBeVisible();

  await lifecycle.getByRole("button", { name: "Suspendre le projet" }).click();
  await expect(lifecycle.getByText("Bloqué par la plateforme").first()).toBeVisible();
  await expect(lifecycle.getByRole("button", { name: "Mettre en quarantaine" })).toBeDisabled();

  await lifecycle.getByRole("button", { name: "Exporter les métadonnées" }).click();
  await expect(lifecycle.getByRole("list", { name: "Exports de métadonnées" })).toBeVisible();
  await lifecycle.getByRole("button", { name: "Mettre en quarantaine" }).click();
  await expect(lifecycle.getByText(/Purge possible après le/)).toBeVisible();
  await expect(lifecycle.getByRole("form", { name: "Purger le projet" })).toBeVisible();

  await lifecycle.getByRole("button", { name: "Annuler la quarantaine" }).click();
  await expect(lifecycle.getByRole("button", { name: "Reprendre le projet" })).toBeVisible();
  await lifecycle.getByRole("button", { name: "Reprendre le projet" }).click();
  await expect(lifecycle.getByRole("button", { name: "Suspendre le projet" })).toBeVisible();
});

test("keeps purge disabled until the project identifier is typed and retention ends", async ({
  page,
}) => {
  await createProject(page, "Purge guard");
  const lifecycle = panel(page);
  await lifecycle.getByRole("button", { name: "Suspendre le projet" }).click();
  await lifecycle.getByRole("button", { name: "Exporter les métadonnées" }).click();
  await lifecycle.getByRole("button", { name: "Mettre en quarantaine" }).click();

  const form = lifecycle.getByRole("form", { name: "Purger le projet" });
  await expect(form.getByRole("button", { name: "Purger définitivement" })).toBeDisabled();
  await form.getByLabel(/Saisissez l’identifiant/).fill("mauvais-identifiant");
  await expect(form.getByRole("button", { name: "Purger définitivement" })).toBeDisabled();
});

test("keeps the lifecycle panel within a mobile viewport", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await createProject(page, "Lifecycle mobile");
  await expect(panel(page)).toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth - innerWidth),
  ).toBeLessThanOrEqual(1);
});
