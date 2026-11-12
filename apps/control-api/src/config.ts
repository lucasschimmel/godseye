import { LOCAL_DEFAULTS } from "@godseye/contracts";
import { z } from "zod";
import { identityPaths } from "./identity/runtime.js";
import { parseInngestCells } from "./inngest-config.js";
import { readPrivateJson } from "./private-json.js";

function port(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1024 || parsed > 65535)
    throw new Error("Invalid local port configuration");
  return parsed;
}

export function loadConfiguration(
  env: NodeJS.ProcessEnv = process.env,
  options: { purpose?: "runtime" | "administration" } = {},
) {
  if (env.GODSEYE_MODE !== "local" || env.NODE_ENV === "production") {
    throw new Error(
      "Only explicit local mode is available; remote private-network admission is not qualified",
    );
  }
  const apiPort = port(env.GODSEYE_API_PORT, LOCAL_DEFAULTS.apiPort);
  const consolePort = port(env.GODSEYE_CONSOLE_PORT, LOCAL_DEFAULTS.consolePort);
  if (env.GODSEYE_DATABASE_URL && env.GODSEYE_JOBS_CONTROL_FILE)
    throw new Error("Select exactly one owner database binding source");
  const databaseUrl = env.GODSEYE_JOBS_CONTROL_FILE
    ? z
        .object({ databaseUrl: z.string().max(4096) })
        .strict()
        .parse(readPrivateJson(env.GODSEYE_JOBS_CONTROL_FILE)).databaseUrl
    : env.GODSEYE_DATABASE_URL;
  // Recovery and private administration never start cell engines. Broken unrelated job settings
  // must not disable those paths; runtime listeners retain the full strict validation below.
  const inngestCells =
    options.purpose === "administration"
      ? []
      : parseInngestCells(env.GODSEYE_INNGEST_CELLS, [apiPort, consolePort]);
  if (inngestCells.length && env.GODSEYE_JOBS_LOCAL_FIXTURES === "enabled")
    throw new Error(
      "Fixture jobs and real local Inngest cells cannot share a runtime configuration",
    );
  const jobsDetached =
    options.purpose !== "administration" && env.GODSEYE_JOBS_RUNTIME === "autonomous";
  if (
    options.purpose !== "administration" &&
    env.GODSEYE_JOBS_RUNTIME &&
    !["embedded", "autonomous"].includes(env.GODSEYE_JOBS_RUNTIME)
  )
    throw new Error("Invalid local jobs runtime mode");
  if (jobsDetached && (!databaseUrl || !inngestCells.length))
    throw new Error("Detached jobs require PostgreSQL and explicit existing cell bindings");
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
    databaseUrl,
    /** Opt-in only: GODSEYE_JOBS_LOCAL_FIXTURES=enabled registers the simulated local handlers. */
    jobsLocalFixtures: env.GODSEYE_JOBS_LOCAL_FIXTURES === "enabled",
    inngestCells,
    jobsDetached,
    githubWebhookKey: env.GODSEYE_GITHUB_WEBHOOK_KEY,
    baoAddress: env.GODSEYE_BAO_ADDRESS,
    baoMount: env.GODSEYE_BAO_MOUNT,
    ...identityPaths(env.GODSEYE_DATA_DIR ?? ".local/control", env.GODSEYE_STATE_DIR),
  };
}
export type Configuration = ReturnType<typeof loadConfiguration>;
