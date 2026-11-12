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
  return name;
}

async function jobsBackendReady(page: Page) {
  return page.evaluate(async () => (await fetch("/api/v1/jobs")).status === 200);
}

test("shows the unconfigured engine plainly with useful empty states and a nav entry", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("navigation", { name: "Navigation principale" }).getByText("Jobs").click();
  await expect(page.getByRole("heading", { name: "Jobs", exact: true })).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Moteur non configuré, aucune exécution", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Aucun environnement suspendu.", { exact: true })).toBeVisible();
  await expect(page.getByText("Aucune définition de job", { exact: true })).toBeVisible();
  await expect(page.getByText("Aucune exécution", { exact: true })).toBeVisible();
  await expect(page.getByText("Aucun effet sortant", { exact: true })).toBeVisible();
  await expect(page.getByText("Aucun environnement admissible", { exact: true })).toBeVisible();
  await expect(page.getByText(/^(sain|healthy)$/i)).toHaveCount(0);
});

test("keeps the jobs page within a mobile viewport", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await createProject(page, "Jobs mobile");
  await page.goto("/jobs");
  await expect(page.getByRole("form", { name: "Enregistrer une définition de job" })).toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth - innerWidth),
  ).toBeLessThanOrEqual(1);
  await page.screenshot({ path: "artifacts/jobs-mobile.png", fullPage: true });
});

test("rejects an invalid job identifier in the browser without sending a request", async ({
  page,
}) => {
  await createProject(page, "Jobs validation");
  await page.goto("/jobs");
  let posts = 0;
  page.on("request", (request) => {
    if (request.method() === "POST" && request.url().includes("/jobs/definitions")) posts++;
  });
  const form = page.getByRole("form", { name: "Enregistrer une définition de job" });
  await form.getByLabel("Nom du job", { exact: true }).fill("Not A Slug");
  await form.getByLabel("Gestionnaire (handler)", { exact: true }).fill("nightly.sync");
  await form.getByRole("button", { name: "Enregistrer la définition", exact: true }).click();
  expect(posts).toBe(0);
});

// Needs the E06 backend routes; skipped (not failed) until /api/v1/jobs answers 200.
test("registers, pauses, resumes and triggers a manual job on a fresh owner identity", async ({
  page,
}) => {
  const project = await createProject(page, "Jobs flow");
  await page.goto("/jobs");
  test.skip(!(await jobsBackendReady(page)), "jobs backend routes are not available yet");
  await page
    .getByRole("combobox", { name: "Projet", exact: true })
    .selectOption({ label: project });
  const form = page.getByRole("form", { name: "Enregistrer une définition de job" });
  await form.getByLabel("Nom du job", { exact: true }).fill("nightly-report");
  await form.getByLabel("Gestionnaire (handler)", { exact: true }).fill("report.build");
  await form.getByRole("button", { name: "Enregistrer la définition", exact: true }).click();
  const row = page.getByRole("row").filter({ hasText: "nightly-report" });
  await expect(row).toBeVisible();
  await expect(row.getByText("Actif", { exact: true })).toBeVisible();
  await row.getByRole("button", { name: "Mettre en pause", exact: true }).click();
  await expect(row.getByText("En pause", { exact: true })).toBeVisible();
  await expect(row.getByRole("button", { name: "Déclencher", exact: true })).toBeDisabled();
  await row.getByRole("button", { name: "Reprendre", exact: true }).click();
  await expect(row.getByText("Actif", { exact: true })).toBeVisible();
  await row.getByRole("button", { name: "Déclencher", exact: true }).click();
  // The default engine is unconfigured: triggering is refused (503) and no run is queued.
  await expect(
    page.getByText("Ce service doit d’abord être connecté et qualifié.").first(),
  ).toBeVisible();
  await expect(page.getByText("Aucune exécution", { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("row").filter({ hasText: "nightly-report" })).toBeVisible();
});
