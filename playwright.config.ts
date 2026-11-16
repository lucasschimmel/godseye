import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, isAbsolute, join, relative, resolve } from "node:path";
import { defineConfig } from "@playwright/test";

const consolePort = Number(process.env.GODSEYE_E2E_CONSOLE_PORT ?? 4400);
const apiPort = Number(process.env.GODSEYE_E2E_API_PORT ?? 4401);
// Workers inherit this run's directory; never reuse the owner's development database.
const dataDir = process.env.GODSEYE_E2E_DATA_DIR ?? mkdtempSync(join(tmpdir(), "godseye-e2e-"));
process.env.GODSEYE_E2E_DATA_DIR = dataDir;
const relativeData = relative(resolve(tmpdir()), resolve(dataDir));
if (
  !relativeData ||
  relativeData.startsWith("..") ||
  isAbsolute(relativeData) ||
  !basename(dataDir).startsWith("godseye-e2e-")
)
  throw new Error("E2E application data must belong to an owned temporary run directory");

// Files that mutate project state must not share a store with the empty-registry journey.
const instances = [
  { name: "console", testMatch: "console.spec.ts", consolePort, apiPort },
  {
    name: "access",
    testMatch: "access.spec.ts",
    consolePort: Number(process.env.GODSEYE_E2E_ACCESS_CONSOLE_PORT ?? consolePort + 2),
    apiPort: Number(process.env.GODSEYE_E2E_ACCESS_API_PORT ?? apiPort + 2),
  },
  {
    name: "infrastructure",
    testMatch: "infrastructure.spec.ts",
    consolePort: Number(process.env.GODSEYE_E2E_INFRA_CONSOLE_PORT ?? consolePort + 4),
    apiPort: Number(process.env.GODSEYE_E2E_INFRA_API_PORT ?? apiPort + 4),
  },
  {
    name: "databases",
    testMatch: "databases.spec.ts",
    consolePort: Number(process.env.GODSEYE_E2E_DATABASE_CONSOLE_PORT ?? consolePort + 6),
    apiPort: Number(process.env.GODSEYE_E2E_DATABASE_API_PORT ?? apiPort + 6),
  },
  {
    name: "recovery",
    testMatch: "recovery.spec.ts",
    consolePort: Number(process.env.GODSEYE_E2E_RECOVERY_CONSOLE_PORT ?? consolePort + 8),
    apiPort: Number(process.env.GODSEYE_E2E_RECOVERY_API_PORT ?? apiPort + 8),
  },
  {
    name: "delivery",
    testMatch: "delivery.spec.ts",
    consolePort: Number(process.env.GODSEYE_E2E_DELIVERY_CONSOLE_PORT ?? consolePort + 10),
    apiPort: Number(process.env.GODSEYE_E2E_DELIVERY_API_PORT ?? apiPort + 10),
  },
  {
    name: "backend",
    testMatch: "backend.spec.ts",
    consolePort: Number(process.env.GODSEYE_E2E_BACKEND_CONSOLE_PORT ?? consolePort + 12),
    apiPort: Number(process.env.GODSEYE_E2E_BACKEND_API_PORT ?? apiPort + 12),
  },
  {
    name: "jobs",
    testMatch: "jobs.spec.ts",
    consolePort: Number(process.env.GODSEYE_E2E_JOBS_CONSOLE_PORT ?? consolePort + 14),
    apiPort: Number(process.env.GODSEYE_E2E_JOBS_API_PORT ?? apiPort + 14),
  },
  {
    name: "lifecycle",
    testMatch: "lifecycle.spec.ts",
    consolePort: Number(process.env.GODSEYE_E2E_LIFECYCLE_CONSOLE_PORT ?? consolePort + 16),
    apiPort: Number(process.env.GODSEYE_E2E_LIFECYCLE_API_PORT ?? apiPort + 16),
  },
  {
    name: "agents",
    testMatch: "agents.spec.ts",
    consolePort: Number(process.env.GODSEYE_E2E_AGENTS_CONSOLE_PORT ?? consolePort + 18),
    apiPort: Number(process.env.GODSEYE_E2E_AGENTS_API_PORT ?? apiPort + 18),
  },
].map((instance) => ({
  ...instance,
  baseURL: `http://localhost:${instance.consolePort}`,
  stateDir: join(dataDir, instance.name, "state"),
  storeDir: join(dataDir, instance.name, "control"),
}));
// Targeted journeys can start one owned instance; default full-suite behavior is unchanged.
const selectedInstance = process.env.GODSEYE_E2E_INSTANCE;
if (selectedInstance && !instances.some((instance) => instance.name === selectedInstance))
  throw new Error("Unknown isolated E2E instance");
const serverInstances = selectedInstance
  ? instances.filter((instance) => instance.name === selectedInstance)
  : instances;

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 45_000,
  expect: { timeout: 10_000 },
  outputDir: "artifacts/playwright-results",
  reporter: [
    ["list"],
    ["junit", { outputFile: process.env.GODSEYE_E2E_JUNIT ?? "artifacts/test-results/e2e.xml" }],
  ],
  use: {
    browserName: "chromium",
    viewport: { width: 1440, height: 1000 },
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    ...instances.map((instance) => ({
      name: instance.name,
      testMatch: instance.testMatch,
      use: { baseURL: instance.baseURL },
      metadata: {
        ownerStateDir: instance.stateDir,
        ownerApiPort: instance.apiPort,
        ownerConsolePort: instance.consolePort,
      },
    })),
    { name: "owner-auth", testMatch: "owner-auth.spec.ts" },
  ],
  webServer: serverInstances.map((instance) => ({
    name: `${instance.name} isolated application`,
    command: "node scripts/dev.mjs",
    // The console proxies /api to the control API, so this health route answers only once both are up;
    // waiting on the console page alone let the first journey hit a closed API port.
    url: `${instance.baseURL}/api/v1/health`,
    reuseExistingServer: false,
    timeout: 90_000,
    env: {
      GODSEYE_MODE: "local",
      NODE_ENV: "development",
      GODSEYE_CONSOLE_PORT: String(instance.consolePort),
      GODSEYE_API_PORT: String(instance.apiPort),
      GODSEYE_DATA_DIR: instance.storeDir,
      GODSEYE_STATE_DIR: instance.stateDir,
      GODSEYE_DATABASE_URL: "",
    },
    stdout: "ignore" as const,
    stderr: "pipe" as const,
  })),
});
