import { randomBytes } from "node:crypto";
import pg from "pg";
import {
  allocateCellPort,
  assertArgv,
  type CellHost,
  type CellHostExecutor,
  type CellLayout,
  cellLayout,
  parseEnv,
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
const gib = (value: number) => `${value}G`;

/**
 * Per-cell PostgreSQL 18 instance on the dedicated server: one `godseye-pg@<allocation>` systemd
 * instance, ZFS child datasets with hard quotas for PGDATA and WAL, a private TLS identity, a
 * loopback/private-bridge listener and a bootstrap-only Unix socket. Nothing is adopted by name:
 * creation fails when any cell state already exists.
 */
export class ServerPostgresTransport implements PostgresInstanceTransport {
  private chain: Promise<unknown> = Promise.resolve();
  constructor(private readonly options: ServerPostgresTransportOptions) {}
  private get host() {
    return this.options.host;
  }
  private run(argv: string[], user?: string) {
    assertArgv(argv);
    return this.options.executor.run(argv, user ? { user } : undefined);
  }
  /** Creation allocates ports and datasets; serialize it so two cells cannot select the same port. */
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
      if ((await this.options.executor.readFile(layout.envFile)) !== null)
        throw new Error("Cell state already exists; refusing to adopt it");
      const port = await allocateCellPort(this.host, this.options.executor);
      await this.createDatasets(layout, profile);
      await this.writeCellFiles(scope, profile, layout, port);
      await this.run(
        [
          `${this.host.postgresBinDirectory}/initdb`,
          "-D",
          layout.dataPath,
          "-X",
          layout.walPath,
          "-U",
          layout.bootstrapRole,
          `--pwfile=${layout.adminPasswordFile}`,
          "--auth-local=scram-sha-256",
          "--auth-host=reject",
          "--data-checksums",
          "--encoding=UTF8",
          "--locale=C.UTF-8",
        ],
        this.host.serviceUser,
      );
    });
  }
  private async createDatasets(layout: CellLayout, profile: CompiledDatabaseProfile) {
    const common = ["-o", "compression=lz4", "-o", "atime=off", "-o", "canmount=on"];
    const specs = [
      [
        layout.dataset.data,
        layout.dataPath,
        profile.storage.dataQuotaGiB,
        "16K",
        profile.dataVolume,
      ],
      [layout.dataset.wal, layout.walPath, profile.storage.walQuotaGiB, "128K", profile.walVolume],
      [
        layout.dataset.repo,
        layout.repositoryPath,
        this.host.repositoryQuotaGiB,
        "128K",
        `pgrepo-${layout.suffix}`,
      ],
    ] as const;
    for (const [name, mountpoint, quota, recordsize, volume] of specs) {
      await this.run([
        this.host.zfsExecutable,
        "create",
        "-p",
        ...common,
        "-o",
        `quota=${gib(quota)}`,
        "-o",
        `recordsize=${recordsize}`,
        "-o",
        `mountpoint=${mountpoint}`,
        "-o",
        `godseye:volume=${volume}`,
        "-o",
        `godseye:allocation=${layout.allocationId}`,
        name,
      ]);
      await this.run([
        "/usr/bin/chown",
        `${this.host.serviceUser}:${this.host.serviceUser}`,
        mountpoint,
      ]);
      await this.run(["/usr/bin/chmod", "0700", mountpoint]);
    }
  }
  private async writeCellFiles(
    scope: DatabaseProviderScope,
    profile: CompiledDatabaseProfile,
    layout: CellLayout,
    port: number,
  ) {
    const { host, executor } = this.options;
    const service = { mode: 0o640, owner: "root", group: host.serviceUser } as const;
    for (const [directory, owner] of [
      [layout.pgBackRestInclude, host.serviceUser],
      [layout.pgBackRestLog, host.serviceUser],
    ] as const)
      await this.run(["/usr/bin/install", "-d", "-m", "0750", "-o", owner, directory]);
    const adminPassword = randomBytes(32).toString("base64url");
    await executor.writeFile(layout.adminPasswordFile, `${adminPassword}\n`, {
      mode: 0o440,
      owner: host.controlUser,
      group: host.serviceUser,
    });
    const cipher = await this.options.archiveCipher(scope);
    if (cipher.length < 32 || /[\r\n\0]/.test(cipher)) throw new Error("Invalid archive cipher");
    await executor.writeFile(layout.archiveEnvFile, `PGBACKREST_REPO1_CIPHER_PASS=${cipher}\n`, {
      mode: 0o600,
      owner: "root",
    });
    await this.run([
      host.certificateHelper,
      layout.allocationId,
      host.servername,
      layout.tlsDirectory,
    ]);
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
    await executor.writeFile(layout.configFile, `${conf}\n`, service);
    await executor.writeFile(
      layout.hbaFile,
      renderDatabaseHba(profile, {
        ipv4Cidr: host.clientIpv4Cidr,
        ipv6Cidr: host.clientIpv6Cidr,
        bootstrapRole: layout.bootstrapRole,
      }),
      service,
    );
    await executor.writeFile(layout.identFile, "", service);
    await executor.writeFile(layout.pgBackRestConfig, archive.config, service);
    await executor.writeFile(
      layout.envFile,
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
      { mode: 0o644, owner: "root" },
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
    };
  }
  private async cell(scope: DatabaseProviderScope) {
    const layout = cellLayout(this.host, scope.allocationId);
    const env = parseEnv(await this.options.executor.readFile(layout.envFile));
    return { layout, env };
  }
  async start(scope: DatabaseProviderScope, providerRef: string | null) {
    const { layout, env } = await this.cell(scope);
    if (!env.PORT) throw new Error("Cell has not been created");
    if (providerRef !== null && providerRef !== layout.unit)
      throw new Error("Provider reference differs from the cell unit");
    await this.run([this.host.systemctlExecutable, "enable", layout.unit]);
    await this.run([this.host.systemctlExecutable, "start", layout.unit]);
    const sleep = this.options.sleep ?? ((ms) => new Promise((done) => setTimeout(done, ms)));
    for (let attempt = 0; attempt < (this.options.readyAttempts ?? 30); attempt++) {
      try {
        await this.run(
          [
            `${this.host.postgresBinDirectory}/pg_isready`,
            "-h",
            layout.socketDirectory,
            "-p",
            env.PORT,
            "-q",
          ],
          this.host.serviceUser,
        );
        return;
      } catch {
        await sleep(1000);
      }
    }
    throw new Error("Cell PostgreSQL did not become ready");
  }
  async stop(scope: DatabaseProviderScope, providerRef: string) {
    const layout = cellLayout(this.host, scope.allocationId);
    if (providerRef !== layout.unit)
      throw new Error("Provider reference differs from the cell unit");
    await this.run([this.host.systemctlExecutable, "stop", layout.unit]);
    await this.run([this.host.systemctlExecutable, "disable", layout.unit]);
  }
  async connect(scope: DatabaseProviderScope): Promise<PostgresConnectionFactory> {
    const { layout, env } = await this.cell(scope);
    const password = (await this.options.executor.readFile(layout.adminPasswordFile))?.trim();
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
    const state = (
      await this.run([
        this.host.systemctlExecutable,
        "show",
        "--property=ActiveState",
        "--value",
        layout.unit,
      ])
    ).trim();
    const control = await this.run(
      [`${this.host.postgresBinDirectory}/pg_controldata`, layout.dataPath],
      this.host.serviceUser,
    );
    const systemIdentifier = /^Database system identifier:\s+(\d+)$/m.exec(control)?.[1];
    if (!systemIdentifier) throw new Error("Cell system identifier is unavailable");
    const volume = await this.volume(
      layout.dataset.data,
      layout.dataPath,
      Number(env.QUOTA_DATA_GIB),
    );
    const wal = await this.volume(layout.dataset.wal, layout.walPath, Number(env.QUOTA_WAL_GIB));
    const [conf, hba] = await Promise.all([
      this.options.executor.readFile(layout.configFile),
      this.options.executor.readFile(layout.hbaFile),
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
  /** ZFS is the source of truth for quota, mount and ownership; names alone prove nothing. */
  private async volume(name: string, mountpoint: string, expectedGiB: number) {
    const out = await this.run([
      this.host.zfsExecutable,
      "get",
      "-H",
      "-p",
      "-o",
      "property,value",
      "quota,mountpoint,godseye:volume",
      name,
    ]);
    const values = Object.fromEntries(
      out
        .split("\n")
        .filter(Boolean)
        .map((line) => line.split("\t") as [string, string]),
    );
    return {
      volume: values["godseye:volume"] ?? "",
      owned: values.mountpoint === mountpoint && Boolean(values["godseye:volume"]),
      quotaEnforced:
        Number.isInteger(expectedGiB) &&
        expectedGiB > 0 &&
        Number(values.quota) === expectedGiB * 1024 ** 3,
    };
  }
}

/**
 * Live host probe, never an owner declaration: validates the versions, template unit, ZFS pool and
 * certificate helper on the server itself and expires after `ttlMs`.
 */
export function hostQualification(
  host: CellHost,
  executor: CellHostExecutor,
  binding: DatabaseProviderBinding,
  now: () => Date = () => new Date(),
  ttlMs = 300_000,
) {
  return async (): Promise<DatabaseQualification | null> => {
    const run = (argv: string[]) => {
      assertArgv(argv);
      return executor.run(argv);
    };
    try {
      const pool = host.zfsParent.split("/")[0] ?? "";
      const [health, postgres, pgbackrest] = await Promise.all([
        run(["/usr/sbin/zpool", "list", "-H", "-o", "health", pool]),
        run([`${host.postgresBinDirectory}/postgres`, "--version"]),
        run([host.pgBackRestExecutable, "version"]),
        run([host.systemctlExecutable, "cat", "godseye-pg@.service"]),
        run(["/usr/bin/test", "-x", host.certificateHelper]),
      ]);
      if (
        health.trim() !== "ONLINE" ||
        !postgres.startsWith("postgres (PostgreSQL) 18.") ||
        !pgbackrest.startsWith("pgBackRest 2.60")
      )
        return null;
    } catch {
      return null;
    }
    const observedAt = now();
    const evidence = fingerprint({
      binding,
      host: host.zfsParent,
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
