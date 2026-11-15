import { posix } from "node:path";
import { z } from "zod";
import { parsePrivateSubnet } from "./infra-network.js";

/**
 * Server-owned physical layout of per-cell PostgreSQL instances (E03/E00).
 * Everything here comes from private deployment configuration, never from an HTTP request.
 */
const absolutePath = z
  .string()
  .regex(/^\/[A-Za-z0-9_./-]+$/)
  .refine((p) => p !== "/" && posix.normalize(p) === p && !p.split("/").includes(".."));
const loopbackOrPrivate = (value: string) => {
  if (value === "127.0.0.1" || value === "::1") return true;
  try {
    parsePrivateSubnet(`${value}/${value.includes(":") ? 128 : 32}`);
    return true;
  } catch {
    return false;
  }
};
export const CellHostConfig = z
  .object({
    /**
     * Mount root of the dedicated XFS volume (mounted with `prjquota`). Each cell receives
     * `<mountRoot>/<allocation>/{data,wal[,repo]}`, every directory under its own XFS project with a
     * hard block limit, so a full cell fails with ENOSPC without affecting its neighbours.
     */
    mountRoot: absolutePath,
    configRoot: absolutePath.default("/etc/godseye/pg"),
    runRoot: absolutePath.default("/run/godseye-pg"),
    postgresBinDirectory: absolutePath.default("/usr/lib/postgresql/18/bin"),
    pgBackRestExecutable: absolutePath.default("/usr/bin/pgbackrest"),
    /** Command that issues a per-cell server certificate (run only by the root helper). */
    certificateHelper: absolutePath.default("/usr/local/sbin/godseye-pg-issue-cert"),
    /** Unix socket of the root helper (systemd socket-activated, group-restricted). */
    helperSocket: absolutePath.default("/run/godseye-cell-helper.sock"),
    serviceUser: z
      .string()
      .regex(/^[a-z_][a-z0-9_-]{0,31}$/)
      .default("postgres"),
    /** Unix account of the control process; it reaches cell sockets and admin files through this group. */
    controlUser: z
      .string()
      .regex(/^[a-z_][a-z0-9_-]{0,31}$/)
      .default("godseye"),
    /** Hard limit of a local pgBackRest repository directory; `0` disables the local repository (S3 only). */
    repositoryQuotaGiB: z.number().int().min(0).max(4096).default(16),
    /** Off-host S3-compatible repository (e.g. Backblaze B2). Credentials never live in this file. */
    s3Repository: z
      .object({
        bucket: z.string().regex(/^[a-z0-9][a-z0-9.-]{2,62}$/),
        endpoint: z.string().regex(/^[a-z0-9][a-z0-9.-]+$/),
        region: z.string().regex(/^[a-z0-9-]+$/),
        /** Distinct prefix per environment; each cell uses `<pathPrefix>/<allocation>`. */
        pathPrefix: absolutePath,
      })
      .strict()
      .optional(),
    /** Loopback or a private bridge address of this host; PostgreSQL listens only here. */
    bindAddress: z.string().refine(loopbackOrPrivate, "Bind address must be loopback or private"),
    /** Address families/CIDRs that application cells may connect from (private only). */
    clientIpv4Cidr: z.string().default("127.0.0.1/32"),
    clientIpv6Cidr: z.string().default("::1/128"),
    /** Name that must appear in each cell certificate (verify-full). */
    servername: z.string().regex(/^[a-z0-9.-]+$/),
    portRange: z
      .tuple([z.number().int().min(1024).max(65535), z.number().int().min(1024).max(65535)])
      .refine(([low, high]) => low <= high),
  })
  .strict();
export type CellHostConfigInput = z.input<typeof CellHostConfig>;
export type CellHost = z.infer<typeof CellHostConfig>;

/**
 * Closed set of privileged verbs. The root helper (`cell-helper.ts`) implements each one with
 * fixed binaries and strictly validated arguments; there is no generic command or file access.
 */
export const HELPER_VERBS = [
  "host-probe",
  "cells-list",
  "file-read",
  "file-write",
  "storage-create",
  "storage-resize",
  "storage-inspect",
  "storage-empty",
  "cell-dirs",
  "cert",
  "initdb",
  "unit",
  "timers",
  "pg-isready",
  "pg-controldata",
  "pgbackrest",
  "destroy",
] as const;
export type HelperVerb = (typeof HELPER_VERBS)[number];
/** Files the helper may read or write for one allocation; paths, owners and modes are helper-defined. */
export const CELL_FILE_KINDS = [
  "cell-env",
  "config",
  "hba",
  "ident",
  "pgbackrest-conf",
  "archive-env",
  "admin-pass",
  "auto-conf",
  "recovery-signal",
  "backup-status",
] as const;
export type CellFileKind = (typeof CELL_FILE_KINDS)[number];
export const HELPER_NOT_FOUND = 44;
export class HelperError extends Error {
  constructor(
    message: string,
    readonly code: number,
  ) {
    super(message);
  }
}

/** Minimal privileged-host effect surface: one call per fixed helper verb. */
export interface CellHostExecutor {
  /** Rejects with {@link HelperError} on a non-zero exit. */
  call(verb: HelperVerb, args: readonly string[], options?: { stdin?: string }): Promise<string>;
}
export interface CellLayout {
  allocationId: string;
  suffix: string;
  unit: string;
  dataPath: string;
  walPath: string;
  repositoryPath: string;
  configDirectory: string;
  configFile: string;
  hbaFile: string;
  identFile: string;
  envFile: string;
  archiveEnvFile: string;
  adminPasswordFile: string;
  tlsDirectory: string;
  tlsCertificate: string;
  tlsKey: string;
  tlsCa: string;
  socketDirectory: string;
  pgBackRestConfig: string;
  pgBackRestInclude: string;
  pgBackRestLock: string;
  pgBackRestLog: string;
  bootstrapRole: string;
}
export function parseCellHost(input: CellHostConfigInput): CellHost {
  const host = CellHostConfig.parse(input);
  for (const [cidr, family] of [
    [host.clientIpv4Cidr, 4],
    [host.clientIpv6Cidr, 6],
  ] as const) {
    if (cidr === "127.0.0.1/32" || cidr === "::1/128") continue;
    if (parsePrivateSubnet(cidr).family !== family)
      throw new Error("Invalid private client network");
  }
  if (!host.s3Repository && host.repositoryQuotaGiB < 1)
    throw new Error("A local repository needs a positive quota");
  return host;
}
export function cellLayout(host: CellHost, allocationId: string): CellLayout {
  z.string().uuid().parse(allocationId);
  const suffix = allocationId.replaceAll("-", "");
  const base = `${host.mountRoot}/${allocationId}`;
  const config = `${host.configRoot}/${allocationId}`;
  return {
    allocationId,
    suffix,
    unit: `godseye-pg@${allocationId}.service`,
    dataPath: `${base}/data`,
    walPath: `${base}/wal`,
    repositoryPath: host.s3Repository
      ? `${host.s3Repository.pathPrefix}/${allocationId}`
      : `${base}/repo`,
    configDirectory: config,
    configFile: `${config}/postgresql.conf`,
    hbaFile: `${config}/pg_hba.conf`,
    identFile: `${config}/pg_ident.conf`,
    envFile: `${config}/cell.env`,
    archiveEnvFile: `${config}/archive.env`,
    adminPasswordFile: `${config}/admin.pass`,
    tlsDirectory: `${config}/tls`,
    tlsCertificate: `${config}/tls/server.crt`,
    tlsKey: `${config}/tls/server.key`,
    tlsCa: `${config}/tls/ca.crt`,
    socketDirectory: `${host.runRoot}/${allocationId}`,
    pgBackRestConfig: `${config}/pgbackrest.conf`,
    pgBackRestInclude: `${config}/pgbackrest.conf.d`,
    pgBackRestLock: `${host.runRoot}/${allocationId}/pgbackrest-lock`,
    pgBackRestLog: `${base}/repo-log`,
    bootstrapRole: `g_${suffix}_admin`,
  };
}
export const parseEnv = (text: string | null): Record<string, string> =>
  Object.fromEntries(
    (text ?? "")
      .split("\n")
      .filter((line) => /^[A-Z_0-9]+=/.test(line))
      .map((line) => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1)]),
  );
/** Reads one helper-defined cell file; a missing file is `null`. */
export async function readCellFile(
  executor: CellHostExecutor,
  allocationId: string,
  kind: CellFileKind,
): Promise<string | null> {
  try {
    return await executor.call("file-read", [allocationId, kind]);
  } catch (error) {
    if (error instanceof HelperError && error.code === HELPER_NOT_FOUND) return null;
    throw error;
  }
}
export async function writeCellFile(
  executor: CellHostExecutor,
  allocationId: string,
  kind: CellFileKind,
  content: string,
) {
  await executor.call("file-write", [allocationId, kind], { stdin: content });
}
export async function listCells(executor: CellHostExecutor): Promise<string[]> {
  return (await executor.call("cells-list", [])).split("\n").filter(Boolean);
}
/** Lowest free port in the private range, derived from the persisted per-cell environment files. */
export async function allocateCellPort(host: CellHost, executor: CellHostExecutor) {
  const [low, high] = host.portRange;
  const used = new Set<number>();
  for (const allocationId of await listCells(executor)) {
    const port = Number(parseEnv(await readCellFile(executor, allocationId, "cell-env")).PORT);
    if (Number.isInteger(port)) used.add(port);
  }
  for (let port = low; port <= high; port++) if (!used.has(port)) return port;
  throw new Error("No private PostgreSQL cell port is available");
}
