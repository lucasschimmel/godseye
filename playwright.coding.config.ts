import { defineConfig } from "@playwright/test";
import base from "./playwright.config.js";

export default defineConfig({
  ...base,
  projects: base.projects
    ?.filter((project) => project.name === "agents")
    .map((project) => ({ ...project, testMatch: "coding.spec.ts" })),
  outputDir: "artifacts/coding-playwright-results",
  reporter: [["list"], ["junit", { outputFile: "artifacts/test-results/coding-e2e.xml" }]],
});
