import { randomBytes } from "node:crypto";
import pg from "pg";
import {
  allocateCellPort,
  type CellFileKind,
  type CellHost,
  type CellHostExecutor,
  type CellLayout,
  cellLayout,
  type HelperVerb,
  parseEnv,
  readCellFile,
  writeCellFile,
} from "./cell-host.js";
import {
  assertDatabaseProfile,
  type CompiledDatabaseProfile,
  renderDatabaseHba,
  renderDatabaseSettings,
} from "./database-policy.js";
import type { PostgresConnectionFactory } from "./database-postgres.js";
import type {
  DatabasePhysicalInspection,
  DatabaseProviderBinding,
  DatabaseProviderScope,
  DatabaseQualification,
  PostgresInstanceTransport,
} from "./database-provider.js";
import { immutableSnapshot } from "./infra-policy.js";
import { fingerprint } from "./journal.js";
import {
  compilePgBackRest,
  type PgBackRestBinding,
  pgBackRestArchiveCommand,
} from "./recovery-pgbackrest-policy.js";

export interface ServerPostgresTransportOptions {
  host: CellHost;
  executor: CellHostExecutor;
  /** Private repository cipher material for WAL archiving; delivered once into a root-only unit env file. */
  archiveCipher(scope: DatabaseProviderScope): Promise<string>;
  /** Overridable for tests. */
  sleep?: (ms: number) => Promise<void>;
  readyAttempts?: number;
}

/** One storage volume as reported by the helper from XFS project quotas (never from names). */
export interface CellVolumeReport {
  volume: string;
  mountpoint: string;
  hardBytes: number;
  usedBytes: number;
}
/** Parses `storage-inspect` output: `<volume>\t<mountpoint>\t<hardBytes>\t<usedBytes>` per line. */
export function parseVolumeReport(output: string): CellVolumeReport[] {
  return output
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [volume = "", mountpoint = "", hard = "", used = ""] = line.split("\t");
      return { volume, mountpoint, hardBytes: Number(hard), usedBytes: Number(used) };
    });
}

/**
 * Per-cell PostgreSQL 18 instance on the dedicated server: one `godseye-pg@<allocation>` systemd
 * instance, XFS project-quota directories with hard limits for PGDATA and WAL, a private TLS
 * identity, a loopback/private-bridge listener and a bootstrap-only Unix socket. Every privileged
 * effect is one fixed verb of the root helper. Nothing is adopted by name: creation fails when any
 * cell state already exists.
 */
export class ServerPostgresTransport implements PostgresInstanceTransport {
  private chain: Promise<unknown> = Promise.resolve();
  constructor(private readonly options: ServerPostgresTransportOptions) {}
  private get host() {
    return this.options.host;
  }
  private call(verb: HelperVerb, args: string[], stdin?: string) {
    return this.options.executor.call(verb, args, stdin === undefined ? undefined : { stdin });
  }
  /** Creation allocates ports and storage; serialize it so two cells cannot select the same port. */
  private exclusive<T>(work: () => Promise<T>) {
    const next = this.chain.then(work, work);
    this.chain = next.catch(() => undefined);
    return next;
  }
  async create(scope: DatabaseProviderScope, profileInput: CompiledDatabaseProfile) {
    const profile = immutableSnapshot(profileInput);
    assertDatabaseProfile(profile);
    if (profile.allocationId !== scope.allocationId)
      throw new Error("Database profile differs from the allocation scope");
    const layout = cellLayout(this.host, scope.allocationId);
    await this.exclusive(async () => {
      if ((await readCellFile(this.options.executor, layout.allocationId, "cell-env")) !== null)
        throw new Error("Cell state already exists; refusing to adopt it");
      const port = await allocateCellPort(this.host, this.options.executor);
      await this.call("storage-create", [
        layout.allocationId,
        String(profile.storage.dataQuotaGiB),
        String(profile.storage.walQuotaGiB),
        String(this.host.s3Repository ? 0 : this.host.repositoryQuotaGiB),
      ]);
      await this.writeCellFiles(scope, profile, layout, port);
      await this.call("initdb", [layout.allocationId]);
    });
  }
  private async writeCellFiles(
    scope: DatabaseProviderScope,
    profile: CompiledDatabaseProfile,
    layout: CellLayout,
    port: number,
  ) {
    const { host, executor } = this.options;
    const write = (kind: CellFileKind, content: string) =>
      writeCellFile(executor, layout.allocationId, kind, content);
    await this.call("cell-dirs", [layout.allocationId]);
    await write("admin-pass", `${randomBytes(32).toString("base64url")}\n`);
    const cipher = await this.options.archiveCipher(scope);
    if (cipher.length < 32 || /[\r\n\0]/.test(cipher)) throw new Error("Invalid archive cipher");
    await write("archive-env", `PGBACKREST_REPO1_CIPHER_PASS=${cipher}\n`);
    await this.call("cert", [layout.allocationId, host.servername]);
    const archive = compilePgBackRest(this.pgBackRestBinding(layout, port, scope.projectId));
    const settings: Record<string, string> = {
      ...renderDatabaseSettings(profile),
      data_directory: layout.dataPath,
      hba_file: layout.hbaFile,
      ident_file: layout.identFile,
      unix_socket_directories: layout.socketDirectory,
      unix_socket_permissions: "0660",
      unix_socket_group: host.controlUser,
      listen_addresses: host.bindAddress,
      port: String(port),
      ssl_cert_file: layout.tlsCertificate,
      ssl_key_file: layout.tlsKey,
      archive_mode: "on",
      archive_command: pgBackRestArchiveCommand(archive, host.pgBackRestExecutable),
      archive_timeout: "60",
      wal_level: "replica",
      logging_collector: "off",
      log_destination: "stderr",
      shared_preload_libraries: "",
    };
    const conf = Object.entries(settings)
      .map(([key, value]) => `${key} = '${value.replaceAll("'", "''")}'`)
      .join("\n");
    await write("config", `${conf}\n`);
    await write(
      "hba",
      renderDatabaseHba(profile, {
        ipv4Cidr: host.clientIpv4Cidr,
        ipv6Cidr: host.clientIpv6Cidr,
        bootstrapRole: layout.bootstrapRole,
      }),
    );
    await write("ident", "");
    await write("pgbackrest-conf", archive.config);
    await write(
      "cell-env",
      [
        `ALLOCATION=${layout.allocationId}`,
        `PROJECT=${scope.projectId}`,
        `ENVIRONMENT=${scope.environmentId}`,
        `PORT=${port}`,
        `QUOTA_DATA_GIB=${profile.storage.dataQuotaGiB}`,
        `QUOTA_WAL_GIB=${profile.storage.walQuotaGiB}`,
        `CONFIGURATION_HASH=${profile.configurationHash}`,
        "",
      ].join("\n"),
    );
  }
  /** Build-time placeholder repository identity; the recovery transport installs the exact policy later. */
  private pgBackRestBinding(
    layout: CellLayout,
    port: number,
    projectId: string,
  ): PgBackRestBinding {
    return {
      projectId,
      sourceAllocationId: layout.allocationId,
      repositoryId: layout.allocationId,
      pgData: layout.dataPath,
      pgWal: layout.walPath,
      pgSocket: layout.socketDirectory,
      pgPort: port,
      pgUser: layout.bootstrapRole,
      repositoryPath: layout.repositoryPath,
      configPath: layout.pgBackRestConfig,
      configIncludePath: layout.pgBackRestInclude,
      lockPath: layout.pgBackRestLock,
      logPath: layout.pgBackRestLog,
      ...(this.host.s3Repository
        ? {
            s3: {
              bucket: this.host.s3Repository.bucket,
              endpoint: this.host.s3Repository.endpoint,
              region: this.host.s3Repository.region,
            },
          }
        : {}),
    };
  }
  private async cell(scope: DatabaseProviderScope) {
    const layout = cellLayout(this.host, scope.allocationId);
    const env = parseEnv(
      await readCellFile(this.options.executor, layout.allocationId, "cell-env"),
    );
    return { layout, env };
  }
  async start(scope: DatabaseProviderScope, providerRef: string | null) {
    const { layout, env } = await this.cell(scope);
    if (!env.PORT) throw new Error("Cell has not been created");
    if (providerRef !== null && providerRef !== layout.unit)
      throw new Error("Provider reference differs from the cell unit");
    await this.call("unit", [layout.allocationId, "enable"]);
    await this.call("unit", [layout.allocationId, "start"]);
    const sleep = this.options.sleep ?? ((ms) => new Promise((done) => setTimeout(done, ms)));
    let ready = false;
    for (let attempt = 0; attempt < (this.options.readyAttempts ?? 30); attempt++) {
      try {
        await this.call("pg-isready", [layout.allocationId]);
        ready = true;
        break;
      } catch {
        await sleep(1000);
      }
    }
    if (!ready) throw new Error("Cell PostgreSQL did not become ready");
    await this.call("timers", [layout.allocationId, "enable"]);
  }
  async stop(scope: DatabaseProviderScope, providerRef: string) {
    const layout = cellLayout(this.host, scope.allocationId);
    if (providerRef !== layout.unit)
      throw new Error("Provider reference differs from the cell unit");
    // Weekly full, daily differential and hourly check timers exist only while the cell runs.
    await this.call("timers", [layout.allocationId, "disable"]);
    await this.call("unit", [layout.allocationId, "stop"]);
    await this.call("unit", [layout.allocationId, "disable"]);
  }
  async connect(scope: DatabaseProviderScope): Promise<PostgresConnectionFactory> {
    const { layout, env } = await this.cell(scope);
    const password = (
      await readCellFile(this.options.executor, layout.allocationId, "admin-pass")
    )?.trim();
    if (!env.PORT || !password) throw new Error("Private PostgreSQL connection failed");
    return async (database) => {
      const client = new pg.Client({
        host: layout.socketDirectory,
        port: Number(env.PORT),
        user: layout.bootstrapRole,
        password,
        database,
        connectionTimeoutMillis: 5000,
        query_timeout: 30000,
        statement_timeout: 30000,
        application_name: "godseye-private-database-policy",
      });
      try {
        await client.connect();
        return client;
      } catch {
        await client.end();
        throw new Error("Private PostgreSQL connection failed");
      }
    };
  }
  async inspect(scope: DatabaseProviderScope, providerRef: string | null) {
    const { layout, env } = await this.cell(scope);
    if (!env.PORT) return null;
    if (providerRef !== null && providerRef !== layout.unit)
      throw new Error("Provider reference differs from the cell unit");
    const state = (await this.call("unit", [layout.allocationId, "state"])).trim();
    const control = await this.call("pg-controldata", [layout.allocationId]);
    const systemIdentifier = /^Database system identifier:\s+(\d+)$/m.exec(control)?.[1];
    if (!systemIdentifier) throw new Error("Cell system identifier is unavailable");
    const reports = parseVolumeReport(await this.call("storage-inspect", [layout.allocationId]));
    const volume = this.volume(
      reports,
      `pgdata-${layout.suffix}`,
      layout.dataPath,
      env.QUOTA_DATA_GIB,
    );
    const wal = this.volume(reports, `pgwal-${layout.suffix}`, layout.walPath, env.QUOTA_WAL_GIB);
    const [conf, hba] = await Promise.all([
      readCellFile(this.options.executor, layout.allocationId, "config"),
      readCellFile(this.options.executor, layout.allocationId, "hba"),
    ]);
    const privateNetwork =
      conf?.includes(`listen_addresses = '${this.host.bindAddress}'`) === true &&
      hba !== null &&
      !/\btrust\b/.test(hba);
    const physical = {
      scope,
      providerRef: layout.unit,
      systemIdentifier,
      configurationHash: fingerprint({ conf, hba }),
      running: state === "active",
      dataVolume: volume.volume,
      walVolume: wal.volume,
      independentInstance: volume.owned && wal.owned,
      quotaEnforced: volume.quotaEnforced && wal.quotaEnforced,
      privateNetwork,
    };
    return { ...physical, evidence: fingerprint(physical) } satisfies Omit<
      DatabasePhysicalInspection,
      "policyVerified"
    >;
  }
  /** XFS project quotas are the source of truth for limit and ownership; names alone prove nothing. */
  private volume(
    reports: CellVolumeReport[],
    name: string,
    mountpoint: string,
    expectedGiB: string | undefined,
  ) {
    const report = reports.find((entry) => entry.volume === name);
    const expected = Number(expectedGiB);
    return {
      volume: report?.volume ?? "",
      owned: report?.mountpoint === mountpoint,
      quotaEnforced:
        report !== undefined &&
        Number.isInteger(expected) &&
        expected > 0 &&
        report.hardBytes === expected * 1024 ** 3,
    };
  }
}

/**
 * Live host probe, never an owner declaration: the helper validates the versions, template unit,
 * quota-enabled XFS mount and certificate helper on the server itself; attestation expires after
 * `ttlMs`.
 */
export function hostQualification(
  host: CellHost,
  executor: CellHostExecutor,
  binding: DatabaseProviderBinding,
  now: () => Date = () => new Date(),
  ttlMs = 300_000,
) {
  return async (): Promise<DatabaseQualification | null> => {
    try {
      const probe = parseEnv(await executor.call("host-probe", []));
      if (
        probe.FILESYSTEM !== "xfs" ||
        probe.PRJQUOTA !== "on" ||
        probe.UNIT !== "ok" ||
        probe.CERTIFICATE_HELPER !== "ok" ||
        !probe.POSTGRES?.startsWith("postgres (PostgreSQL) 18.") ||
        !probe.PGBACKREST?.startsWith("pgBackRest 2.60")
      )
        return null;
    } catch {
      return null;
    }
    const observedAt = now();
    const evidence = fingerprint({
      binding,
      host: host.mountRoot,
      observedAt: observedAt.toISOString(),
    });
    return {
      ...binding,
      observedAt: observedAt.toISOString(),
      expiresAt: new Date(observedAt.getTime() + ttlMs).toISOString(),
      independentInstances: true,
      persistentQuota: true,
      privateNetwork: true,
      tlsIdentity: true,
      evidence,
    };
  };
}
