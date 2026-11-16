import {
  allocateCellPort,
  type CellHost,
  type CellHostExecutor,
  cellLayout,
  listCells,
  parseEnv,
  readCellFile,
  writeCellFile,
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
 * Per-cell pgBackRest transport: one stanza per source cell (named from its allocation), an
 * off-host S3 repository under a per-cell path (or a quota-bound local directory), and restores into a
 * new allocation whose storage, configuration and unit are independent of the source. Every
 * privileged step is one fixed helper verb.
 */
export class ServerPgBackRestTransport implements PgBackRestTransport {
  constructor(
    private readonly host: CellHost,
    private readonly executor: CellHostExecutor,
  ) {}
  async binding(scope: RecoveryScope): Promise<PgBackRestBinding> {
    const layout = cellLayout(this.host, scope.sourceAllocationId);
    const env = parseEnv(await readCellFile(this.executor, layout.allocationId, "cell-env"));
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
  async installConfiguration(scope: RecoveryScope, policy: CompiledPgBackRest) {
    const layout = cellLayout(this.host, scope.sourceAllocationId);
    if (policy.binding.configPath !== layout.pgBackRestConfig)
      throw new Error("Backup policy path differs from the source cell layout");
    if ((scope.kind === "full" || scope.kind === "diff") && !this.host.s3Repository)
      await this.executor.call("storage-resize", [
        layout.allocationId,
        "repo",
        String(scope.policy.repositoryGiB),
      ]);
    await writeCellFile(this.executor, layout.allocationId, "pgbackrest-conf", policy.config);
  }
  async execute(
    scope: RecoveryScope,
    args: readonly string[],
    _privateEnvironment: Readonly<Record<string, string>>,
  ) {
    // The helper loads the repository cipher passphrase and storage credentials from the source
    // cell's root-owned environment files; neither travels over the helper socket or in argv.
    return this.executor.call("pgbackrest", [scope.sourceAllocationId, ...args]);
  }
  async reserveEmptyDestination(scope: RecoveryScope): Promise<RecoveryDestinationBinding> {
    if (scope.allocationId === scope.sourceAllocationId)
      throw new Error("Restore destination must differ from the source allocation");
    const layout = cellLayout(this.host, scope.allocationId);
    if (
      (await readCellFile(this.executor, layout.allocationId, "cell-env")) !== null ||
      (await listCells(this.executor)).includes(layout.allocationId)
    )
      throw new Error("Restore destination already exists");
    const storage = scope.sourceCatalog.storage;
    await this.executor.call("storage-create", [
      layout.allocationId,
      String(storage.dataQuotaGiB),
      String(storage.walQuotaGiB),
      "0",
    ]);
    try {
      await this.executor.call("storage-empty", [layout.allocationId]);
    } catch {
      throw new Error("Restore destination is not empty");
    }
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
    await this.executor.call("cert", [layout.allocationId, this.host.servername]);
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
    const write = (kind: Parameters<typeof writeCellFile>[2], content: string) =>
      writeCellFile(this.executor, layout.allocationId, kind, content);
    await write("config", rendered.configuration);
    await write("hba", rendered.hba);
    await write("ident", rendered.ident);
    // Restored inherited configuration is replaced before any startup; empty files neutralize it.
    await write("auto-conf", rendered.autoConfiguration);
    await write("recovery-signal", rendered.recoverySignal);
    await write("cell-env", `ALLOCATION=${layout.allocationId}\nPORT=${port}\nHELD=1\n`);
  }
  async startPaused(scope: RecoveryScope, destination: RecoveryDestinationBinding) {
    const layout = cellLayout(this.host, scope.allocationId);
    if (destination.pgData !== layout.dataPath) throw new Error("Recovery destination differs");
    await this.executor.call("unit", [layout.allocationId, "start"]);
  }
  /** Production inspection attestation remains unavailable until a manifest/WAL verifier is qualified. */
  async inspect() {
    return immutableSnapshot(null);
  }
}
