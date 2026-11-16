import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineConfig } from "@playwright/test";

// Dedicated accessibility run: one isolated local instance on ports 4720 (console) / 4721 (API).
const consolePort = Number(process.env.GODSEYE_E2E_A11Y_CONSOLE_PORT ?? 4720);
const apiPort = Number(process.env.GODSEYE_E2E_A11Y_API_PORT ?? 4721);
// Workers re-evaluate this file; the env var keeps them on the same temporary run directory.
const dataDir =
  process.env.GODSEYE_E2E_A11Y_DATA_DIR ?? mkdtempSync(join(tmpdir(), "godseye-e2e-a11y-"));
process.env.GODSEYE_E2E_A11Y_DATA_DIR = dataDir;
const stateDir = join(dataDir, "state");
const baseURL = `http://localhost:${consolePort}`;

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: "a11y.spec.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 120_000,
  expect: { timeout: 10_000 },
  outputDir: "artifacts/a11y-playwright-results",
  reporter: [["list"]],
  use: { browserName: "chromium", baseURL, trace: "retain-on-failure" },
  projects: [
    {
      name: "a11y",
      metadata: { ownerStateDir: stateDir, ownerApiPort: apiPort, ownerConsolePort: consolePort },
    },
  ],
  webServer: {
    name: "a11y isolated application",
    command: "node scripts/dev.mjs",
    url: `${baseURL}/api/v1/health`,
    reuseExistingServer: false,
    timeout: 240_000,
    env: {
      GODSEYE_MODE: "local",
      NODE_ENV: "development",
      GODSEYE_CONSOLE_PORT: String(consolePort),
      GODSEYE_API_PORT: String(apiPort),
      GODSEYE_DATA_DIR: join(dataDir, "control"),
      GODSEYE_STATE_DIR: stateDir,
      GODSEYE_DATABASE_URL: "",
    },
    stdout: "ignore",
    stderr: "pipe",
  },
});
