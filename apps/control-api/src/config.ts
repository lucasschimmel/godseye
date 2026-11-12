import { LOCAL_DEFAULTS } from "@godseye/contracts";
import { identityPaths } from "./identity/runtime.js";

function port(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1024 || parsed > 65535)
    throw new Error("Invalid local port configuration");
  return parsed;
}

export function loadConfiguration(env: NodeJS.ProcessEnv = process.env) {
  if (env.GODSEYE_MODE !== "local" || env.NODE_ENV === "production") {
    throw new Error(
      "Only explicit local mode is available; remote private-network admission is not qualified",
    );
  }
  const apiPort = port(env.GODSEYE_API_PORT, LOCAL_DEFAULTS.apiPort);
  const consolePort = port(env.GODSEYE_CONSOLE_PORT, LOCAL_DEFAULTS.consolePort);
  return {
    apiPort,
    consolePort,
    host: LOCAL_DEFAULTS.host,
    origins: [`http://127.0.0.1:${consolePort}`, `http://localhost:${consolePort}`],
    hosts: [
      `127.0.0.1:${apiPort}`,
      `localhost:${apiPort}`,
      `127.0.0.1:${consolePort}`,
      `localhost:${consolePort}`,
    ],
    databaseUrl: env.GODSEYE_DATABASE_URL,
    /** Opt-in only: GODSEYE_JOBS_LOCAL_FIXTURES=enabled registers the simulated local handlers. */
    jobsLocalFixtures: env.GODSEYE_JOBS_LOCAL_FIXTURES === "enabled",
    githubWebhookKey: env.GODSEYE_GITHUB_WEBHOOK_KEY,
    baoAddress: env.GODSEYE_BAO_ADDRESS,
    baoMount: env.GODSEYE_BAO_MOUNT,
    ...identityPaths(env.GODSEYE_DATA_DIR ?? ".local/control", env.GODSEYE_STATE_DIR),
  };
}
export type Configuration = ReturnType<typeof loadConfiguration>;
