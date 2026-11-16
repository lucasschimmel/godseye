import { defineConfig } from "@playwright/test";
import base from "./playwright.config.js";
export default defineConfig({
  ...base,
  projects: base.projects
    ?.filter((project) => project.name === "agents")
    .map((project) => ({ ...project, testMatch: "e08.spec.ts" })),
  webServer: Array.isArray(base.webServer)
    ? base.webServer.filter((server) => server.name === "agents isolated application")
    : base.webServer,
  outputDir: "artifacts/e08-playwright-results",
  reporter: [["list"], ["junit", { outputFile: "artifacts/test-results/e08-e2e.xml" }]],
});
