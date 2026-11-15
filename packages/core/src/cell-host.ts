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
const dataset = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]*(?:\/[A-Za-z0-9][A-Za-z0-9_.:-]*)+$/);
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
    /** Parent ZFS dataset; each cell receives `<parent>/<allocation>/{data,wal,repo}` children. */
    zfsParent: dataset,
    /** Mount root of that dataset (children mount under `<mountRoot>/<allocation>/...`). */
    mountRoot: absolutePath,
    configRoot: absolutePath.default("/etc/godseye/pg"),
    runRoot: absolutePath.default("/run/godseye-pg"),
    postgresBinDirectory: absolutePath.default("/usr/lib/postgresql/18/bin"),
    pgBackRestExecutable: absolutePath.default("/usr/bin/pgbackrest"),
    zfsExecutable: absolutePath.default("/usr/sbin/zfs"),
    systemctlExecutable: absolutePath.default("/usr/bin/systemctl"),
    /** Command that issues a per-cell server certificate: `<helper> <allocation> <servername> <directory>`. */
    certificateHelper: absolutePath.default("/usr/local/sbin/godseye-pg-issue-cert"),
    serviceUser: z
      .string()
      .regex(/^[a-z_][a-z0-9_-]{0,31}$/)
      .default("postgres"),
    /** Unix account of the control process; it reaches cell sockets and admin files through this group. */
    controlUser: z
      .string()
      .regex(/^[a-z_][a-z0-9_-]{0,31}$/)
      .default("godseye"),
    /** Initial hard quota of each cell's pgBackRest repository dataset; tightened per backup policy. */
    repositoryQuotaGiB: z.number().int().min(1).max(4096).default(16),
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
    /** Optional repository root for pgBackRest (local ZFS child by default). */
    repositoryRoot: absolutePath.optional(),
  })
  .strict();
export type CellHostConfigInput = z.input<typeof CellHostConfig>;
export type CellHost = z.infer<typeof CellHostConfig>;

/** Minimal privileged-host effect surface; production runs fixed argv with no shell. */
export interface CellHostExecutor {
  /** Executes an absolute executable with fixed arguments. Rejects on a non-zero exit. */
  run(
    argv: readonly string[],
    options?: { user?: string; stdin?: string; env?: Readonly<Record<string, string>> },
  ): Promise<string>;
  /** Atomic write with explicit mode/owner/group; parents are created private. */
  writeFile(
    path: string,
    content: string,
    options: { mode: number; owner?: string; group?: string },
  ): Promise<void>;
  readFile(path: string): Promise<string | null>;
  listDirectory(path: string): Promise<string[]>;
  removeFile(path: string): Promise<void>;
}
export interface CellLayout {
  allocationId: string;
  suffix: string;
  unit: string;
  dataset: { data: string; wal: string; repo: string };
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
  return host;
}
export function cellLayout(host: CellHost, allocationId: string): CellLayout {
  z.string().uuid().parse(allocationId);
  const suffix = allocationId.replaceAll("-", "");
  const base = `${host.mountRoot}/${allocationId}`;
  const config = `${host.configRoot}/${allocationId}`;
  const repositoryPath = `${host.repositoryRoot ?? `${base}/repo`}${host.repositoryRoot ? `/${allocationId}` : ""}`;
  return {
    allocationId,
    suffix,
    unit: `godseye-pg@${allocationId}.service`,
    dataset: {
      data: `${host.zfsParent}/${allocationId}/data`,
      wal: `${host.zfsParent}/${allocationId}/wal`,
      repo: `${host.zfsParent}/${allocationId}/repo`,
    },
    dataPath: `${base}/data`,
    walPath: `${base}/wal`,
    repositoryPath,
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
/** Fixed-width shell-free argv guard shared by all transports. */
export function assertArgv(argv: readonly string[]) {
  if (
    !argv.length ||
    !argv[0]?.startsWith("/") ||
    argv.some((arg) => /[\0\r\n]/.test(arg) || arg.length > 4096)
  )
    throw new Error("Invalid private host command");
}
export const parseEnv = (text: string | null): Record<string, string> =>
  Object.fromEntries(
    (text ?? "")
      .split("\n")
      .filter((line) => /^[A-Z_]+=/.test(line))
      .map((line) => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1)]),
  );
/** Lowest free port in the private range, derived from the persisted per-cell environment files. */
export async function allocateCellPort(host: CellHost, executor: CellHostExecutor) {
  const [low, high] = host.portRange;
  const used = new Set<number>();
  for (const name of await executor.listDirectory(host.configRoot)) {
    const port = Number(
      parseEnv(await executor.readFile(`${host.configRoot}/${name}/cell.env`)).PORT,
    );
    if (Number.isInteger(port)) used.add(port);
  }
  for (let port = low; port <= high; port++) if (!used.has(port)) return port;
  throw new Error("No private PostgreSQL cell port is available");
}
