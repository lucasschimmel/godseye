import {
  allocateCellPort,
  assertArgv,
  type CellHost,
  type CellHostExecutor,
  cellLayout,
  parseEnv,
} from "./cell-host.js";
import { immutableSnapshot } from "./infra-policy.js";
import {
  type CompiledPgBackRest,
  compilePgBackRest,
  type PgBackRestBinding,
} from "./recovery-pgbackrest-policy.js";
import type {
  PgBackRestTransport,
  RecoveryDestinationBinding,
} from "./recovery-pgbackrest-provider.js";
import { renderHeldRecoveryPostgres } from "./recovery-postgres-policy.js";
import type { RecoveryScope } from "./recovery-provider.js";

/**
 * Per-cell pgBackRest transport: one stanza per source cell (named from its allocation), a ZFS
 * repository dataset with a hard quota, and restores into a new allocation whose datasets,
 * configuration and unit are independent of the source.
 */
export class ServerPgBackRestTransport implements PgBackRestTransport {
  constructor(
    private readonly host: CellHost,
    private readonly executor: CellHostExecutor,
  ) {}
  private run(argv: string[], options?: Parameters<CellHostExecutor["run"]>[1]) {
    assertArgv(argv);
    return this.executor.run(argv, options);
  }
  async binding(scope: RecoveryScope): Promise<PgBackRestBinding> {
    const layout = cellLayout(this.host, scope.sourceAllocationId);
    const env = parseEnv(await this.executor.readFile(layout.envFile));
    const port = Number(env.PORT);
    if (!Number.isInteger(port)) throw new Error("Source cell is not provisioned on this host");
    return {
      projectId: scope.projectId,
      sourceAllocationId: scope.sourceAllocationId,
      repositoryId: scope.repositoryId,
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
  async installConfiguration(scope: RecoveryScope, policy: CompiledPgBackRest) {
    const layout = cellLayout(this.host, scope.sourceAllocationId);
    if (policy.binding.configPath !== layout.pgBackRestConfig)
      throw new Error("Backup policy path differs from the source cell layout");
    if (scope.kind === "full" || scope.kind === "diff")
      await this.run([
        this.host.zfsExecutable,
        "set",
        `quota=${scope.policy.repositoryGiB}G`,
        layout.dataset.repo,
      ]);
    await this.executor.writeFile(layout.pgBackRestConfig, policy.config, {
      mode: 0o640,
      owner: "root",
      group: this.host.serviceUser,
    });
  }
  async execute(
    _scope: RecoveryScope,
    args: readonly string[],
    privateEnvironment: Readonly<Record<string, string>>,
  ) {
    // Authentication stays the repository cipher passphrase in the child environment only.
    return this.run([this.host.pgBackRestExecutable, ...args], {
      user: this.host.serviceUser,
      env: privateEnvironment,
    });
  }
  async reserveEmptyDestination(scope: RecoveryScope): Promise<RecoveryDestinationBinding> {
    if (scope.allocationId === scope.sourceAllocationId)
      throw new Error("Restore destination must differ from the source allocation");
    const layout = cellLayout(this.host, scope.allocationId);
    if ((await this.executor.readFile(layout.envFile)) !== null)
      throw new Error("Restore destination already exists");
    const storage = scope.sourceCatalog.storage;
    for (const [name, mountpoint, quota, volume] of [
      [layout.dataset.data, layout.dataPath, storage.dataQuotaGiB, `pgdata-${layout.suffix}`],
      [layout.dataset.wal, layout.walPath, storage.walQuotaGiB, `pgwal-${layout.suffix}`],
    ] as const) {
      await this.run([
        this.host.zfsExecutable,
        "create",
        "-p",
        "-o",
        `quota=${quota}G`,
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
    const [data, wal] = await Promise.all([
      this.executor.listDirectory(layout.dataPath),
      this.executor.listDirectory(layout.walPath),
    ]);
    if (data.length || wal.length) throw new Error("Restore destination is not empty");
    return {
      allocationId: scope.allocationId,
      environmentId: scope.environmentId,
      pgData: layout.dataPath,
      walPath: layout.walPath,
      empty: true,
      linksAbsent: true,
      owned: true,
      privateNetwork: true,
      tablespaces: "default-only",
    };
  }
  async replaceRestoredConfiguration(
    scope: RecoveryScope,
    destination: RecoveryDestinationBinding,
  ) {
    const layout = cellLayout(this.host, scope.allocationId);
    if (destination.pgData !== layout.dataPath || destination.walPath !== layout.walPath)
      throw new Error("Recovery destination differs from its allocation layout");
    const repository = compilePgBackRest({
      ...(await this.binding(scope)),
      fullRetention: scope.policy.fullRetention,
      differentialRetention: scope.policy.differentialRetention,
    });
    const port = await allocateCellPort(this.host, this.executor);
    await this.run([
      this.host.certificateHelper,
      layout.allocationId,
      this.host.servername,
      layout.tlsDirectory,
    ]);
    const rendered = renderHeldRecoveryPostgres(
      scope,
      {
        dataPath: layout.dataPath,
        walPath: layout.walPath,
        socketPath: layout.socketDirectory,
        hbaPath: layout.hbaFile,
        identPath: layout.identFile,
        tlsCertificatePath: layout.tlsCertificate,
        tlsKeyPath: layout.tlsKey,
        pgBackRestExecutable: this.host.pgBackRestExecutable,
        bootstrapRole: cellLayout(this.host, scope.sourceAllocationId).bootstrapRole,
        port,
      },
      repository,
    );
    const owned = { mode: 0o640, owner: "root", group: this.host.serviceUser } as const;
    await this.executor.writeFile(layout.configFile, rendered.configuration, owned);
    await this.executor.writeFile(layout.hbaFile, rendered.hba, owned);
    await this.executor.writeFile(layout.identFile, rendered.ident, owned);
    // Restored inherited configuration is replaced before any startup; empty files neutralize it.
    const inherited = { mode: 0o600, owner: this.host.serviceUser } as const;
    await this.executor.writeFile(
      `${layout.dataPath}/postgresql.auto.conf`,
      rendered.autoConfiguration,
      inherited,
    );
    await this.executor.writeFile(
      `${layout.dataPath}/recovery.signal`,
      rendered.recoverySignal,
      inherited,
    );
    await this.executor.writeFile(
      layout.envFile,
      `ALLOCATION=${layout.allocationId}\nPORT=${port}\nHELD=1\n`,
      { mode: 0o644, owner: "root" },
    );
  }
  async startPaused(scope: RecoveryScope, destination: RecoveryDestinationBinding) {
    const layout = cellLayout(this.host, scope.allocationId);
    if (destination.pgData !== layout.dataPath) throw new Error("Recovery destination differs");
    await this.run([this.host.systemctlExecutable, "start", layout.unit]);
  }
  /** Production inspection attestation remains unavailable until a manifest/WAL verifier is qualified. */
  async inspect() {
    return immutableSnapshot(null);
  }
}
