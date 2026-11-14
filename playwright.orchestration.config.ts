import { defineConfig } from "@playwright/test";
import base from "./playwright.config.js";

export default defineConfig({
  ...base,
  projects: base.projects
    ?.filter((project) => project.name === "agents")
    .map((project) => ({ ...project, testMatch: "orchestration.spec.ts" })),
  webServer: Array.isArray(base.webServer)
    ? base.webServer.filter((server) => server.name === "agents isolated application")
    : base.webServer,
  outputDir: "artifacts/orchestration-playwright-results",
  reporter: [["list"], ["junit", { outputFile: "artifacts/test-results/orchestration-e2e.xml" }]],
});
