import { LOCAL_DEFAULTS } from "@godseye/contracts";
import { z } from "zod";
import { identityPaths } from "./identity/runtime.js";
import { parseInngestCells } from "./inngest-config.js";
import { readPrivateJson } from "./private-json.js";
import { hostPort, serverSettings } from "./server-config.js";

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
  const mode = env.GODSEYE_MODE;
  if (mode !== "local" && mode !== "server")
    throw new Error("GODSEYE_MODE must be explicitly set to local or server");
  // Production is admitted only by a fully validated server configuration, never by a mode flag.
  if (mode === "local" && env.NODE_ENV === "production")
    throw new Error(
      "Local mode is refused in production; configure and validate GODSEYE_MODE=server",
    );
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
  const server = mode === "server" ? serverSettings(env, databaseUrl) : undefined;
  const host = server?.host ?? LOCAL_DEFAULTS.host;
  const ownerOrigin = server?.ownerOrigin ?? `http://localhost:${consolePort}`;
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
    mode,
    host,
    /** The single owner origin: WebAuthn relying party, cookies, Host/Origin allowlists, enrollment links. */
    ownerOrigin,
    trustedProxies: server?.trustedProxies ?? [],
    origins: server ? [ownerOrigin] : [`http://127.0.0.1:${consolePort}`, ownerOrigin],
    hosts: server
      ? [new URL(ownerOrigin).host, hostPort(host, apiPort)]
      : [
          `127.0.0.1:${apiPort}`,
          `localhost:${apiPort}`,
          `127.0.0.1:${consolePort}`,
          new URL(ownerOrigin).host,
        ],
    databaseUrl,
    /** Opt-in only: GODSEYE_JOBS_LOCAL_FIXTURES=enabled registers the simulated local handlers. */
    jobsLocalFixtures: env.GODSEYE_JOBS_LOCAL_FIXTURES === "enabled",
    inngestCells,
    jobsDetached,
    githubWebhookKey: env.GODSEYE_GITHUB_WEBHOOK_KEY,
    baoAddress: env.GODSEYE_BAO_ADDRESS,
    baoMount: env.GODSEYE_BAO_MOUNT,
    /** Server observations: unset paths stay unknown; only the server's own root disk and backup status directory have defaults. */
    serverObservation: {
      rootPath: env.GODSEYE_OBSERVE_ROOT_PATH ?? (server ? "/" : null),
      cellDataPath: env.GODSEYE_OBSERVE_CELL_DATA_PATH ?? null,
      hostHealthFile: env.GODSEYE_HOST_HEALTH_FILE ?? null,
      pgBackupDirectory:
        env.GODSEYE_PG_BACKUP_STATUS_DIR ?? (server ? "/var/lib/godseye/pg-backup" : null),
      baoAddress: env.GODSEYE_BAO_ADDRESS ?? null,
    },
    ...identityPaths(env.GODSEYE_DATA_DIR ?? ".local/control", env.GODSEYE_STATE_DIR),
  };
}
export type Configuration = ReturnType<typeof loadConfiguration>;
