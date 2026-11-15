import { z } from "zod";
import { LocalInngestCell, parseInngestCells } from "../../control-api/src/inngest-config.js";
import { workflowEndpoint } from "../../control-api/src/workflow-endpoint.js";

export const ExternalStorage = z
  .object({
    projectId: z.string().uuid(),
    environmentId: z.string().uuid(),
    postgresUri: z.string().max(4096),
    redisUri: z.string().max(4096),
  })
  .strict();
export type ExternalStorage = z.infer<typeof ExternalStorage>;
export function validateExternalStorage(raw: unknown, controlDatabaseUrl?: string) {
  const entries = z.array(ExternalStorage).min(1).max(21).parse(raw);
  const postgres = new Set<string>(),
    redis = new Set<string>(),
    scopes = new Set<string>();
  for (const entry of entries) {
    const pgEndpoint = workflowEndpoint(entry.postgresUri, "postgresql"),
      rdEndpoint = workflowEndpoint(entry.redisUri, "redis"),
      pg = pgEndpoint.url,
      rd = rdEndpoint.url;
    if (
      !pg.username ||
      !pg.password ||
      !/^\/[a-zA-Z0-9_-]+$/.test(pg.pathname) ||
      !rd.password ||
      !/^\/(?:0|[1-9]|1[0-5])?$/.test(rd.pathname)
    )
      throw new Error(
        "Private external workflow storage requires independent authenticated endpoints",
      );
    const scope = `${entry.projectId}:${entry.environmentId}`,
      pgId = `${pgEndpoint.hostKey}:${pg.port}${pg.pathname}`,
      rdId = `${rdEndpoint.hostKey}:${rd.port}`;
    if (scopes.has(scope) || postgres.has(pgId) || redis.has(rdId))
      throw new Error("Workflow cells cannot reuse scope, PostgreSQL databases or Redis instances");
    if (controlDatabaseUrl) {
      const control = new URL(controlDatabaseUrl);
      if (
        ["localhost", "127.0.0.1", "[::1]"].includes(control.hostname) &&
        (control.port || "5432") === pg.port &&
        control.pathname === pg.pathname
      )
        throw new Error("Workflow storage cannot reuse the owner control database");
    }
    scopes.add(scope);
    postgres.add(pgId);
    redis.add(rdId);
  }
  return entries;
}
export function localStorageUri(raw: string, protocol: "postgresql:" | "redis:") {
  return workflowEndpoint(raw, protocol === "postgresql:" ? "postgresql" : "redis").url;
}
export function autonomousCells(raw: string | undefined, reservedPorts: number[] = []) {
  return parseInngestCells(raw, reservedPorts);
}
export const WorkerSettings = z
  .object({
    cell: LocalInngestCell,
    directory: z.string(),
    engineDirectory: z.string(),
    eventKey: z.string().regex(/^[a-f0-9]{64}$/),
    signingKey: z.string().regex(/^[a-f0-9]{64}$/),
    workerModule: z.string().optional(),
    settings: z
      .object({
        allowedOrigins: z.array(z.string()),
        registrationEnabled: z.boolean(),
        maxFileMiB: z.number(),
        storageMiB: z.number(),
        maxFiles: z.number(),
        eventRetention: z.number(),
      })
      .strict(),
  })
  .strict();
export type WorkerSettings = z.infer<typeof WorkerSettings>;

/** No parent preloads, owner URLs, provider authority or arbitrary environment reaches a cell. */
export function workerEnvironment(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const allowed = new Set([
    "systemroot",
    "windir",
    "temp",
    "tmp",
    "path",
    "pathext",
    "lang",
    "lc_all",
    "tz",
  ]);
  return Object.fromEntries(
    Object.entries(env).filter(([name]) => allowed.has(name.toLowerCase())),
  );
}
