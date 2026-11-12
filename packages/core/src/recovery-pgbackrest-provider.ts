import { spawn } from "node:child_process";
import type { DatabaseProviderBinding } from "./database-provider.js";
import { immutableSnapshot } from "./infra-policy.js";
import { fingerprint } from "./journal.js";
import { inspectPgBackRestInfo } from "./recovery-pgbackrest-info.js";
import {
  type CompiledPgBackRest,
  compilePgBackRest,
  type PgBackRestBinding,
  pgBackRestArguments,
  pgBackRestRestoreArguments,
} from "./recovery-pgbackrest-policy.js";
import {
  assertRecoveryInspection,
  type RecoveryInspection,
  type RecoveryProvider,
  type RecoveryQualification,
  type RecoveryScope,
} from "./recovery-provider.js";

export interface RecoveryDestinationBinding {
  allocationId: string;
  environmentId: string;
  pgData: string;
  walPath: string;
  empty: true;
  linksAbsent: true;
  owned: true;
  privateNetwork: true;
  tablespaces: "default-only";
}
/** The callback delivers only repository cipher material through a private child environment. */
export interface RecoveryRepositoryMaterial {
  withInspectionMaterial?(
    scope: RecoveryScope,
    consume: (passphrase: string) => Promise<void>,
    gate: () => Promise<void>,
  ): Promise<void>;
  withMaterial(
    scope: RecoveryScope,
    consume: (passphrase: string) => Promise<void>,
    gate: () => Promise<void>,
  ): Promise<void>;
}
export interface PgBackRestTransport {
  binding(scope: RecoveryScope): Promise<PgBackRestBinding>;
  installConfiguration(scope: RecoveryScope, policy: CompiledPgBackRest): Promise<void>;
  execute(
    scope: RecoveryScope,
    args: readonly string[],
    privateEnvironment: Readonly<Record<string, string>>,
  ): Promise<string>;
  reserveEmptyDestination(scope: RecoveryScope): Promise<RecoveryDestinationBinding>;
  /** Replace ALL inherited config/includes/HBA/TLS/archive/external hooks before any postgres startup. */
  replaceRestoredConfiguration(
    scope: RecoveryScope,
    destination: RecoveryDestinationBinding,
  ): Promise<void>;
  startPaused(scope: RecoveryScope, destination: RecoveryDestinationBinding): Promise<void>;
  /** Independent manifest/continuous-WAL verification; info min/max filenames alone are insufficient. */
  inspect(scope: RecoveryScope, repositoryInfo: string): Promise<RecoveryInspection | null>;
}
/** Concrete fixed pgBackRest protocol. A transport is trusted only through independently qualified scope proofs. */
export class ManagedPgBackRestProvider implements RecoveryProvider {
  readonly binding: DatabaseProviderBinding;
  constructor(
    binding: DatabaseProviderBinding,
    private readonly transport: PgBackRestTransport,
    private readonly material: RecoveryRepositoryMaterial,
    private readonly qualify: (scope: RecoveryScope) => Promise<RecoveryQualification | null>,
    private readonly now = () => new Date(),
  ) {
    this.binding = immutableSnapshot(binding);
  }
  qualification(input: RecoveryScope) {
    return this.qualify(immutableSnapshot(input));
  }
  private async policy(scope: RecoveryScope) {
    const binding = immutableSnapshot(await this.transport.binding(scope));
    if (
      binding.projectId !== scope.projectId ||
      binding.sourceAllocationId !== scope.sourceAllocationId ||
      binding.repositoryId !== scope.repositoryId
    )
      throw new Error(
        "Private backup mapping differs from the authenticated source and repository",
      );
    return compilePgBackRest({
      ...binding,
      fullRetention: scope.policy.fullRetention,
      differentialRetention: scope.policy.differentialRetention,
    });
  }
  private async invoke(
    scope: RecoveryScope,
    args: readonly string[],
    gate: () => Promise<void>,
    inspection = false,
  ) {
    let result: string | undefined;
    const deliver = inspection
      ? this.material.withInspectionMaterial?.bind(this.material)
      : this.material.withMaterial.bind(this.material);
    if (!deliver)
      throw new Error("Read-only recovery inspection material authority is unavailable");
    await deliver(
      scope,
      async (material) => {
        if (material.length < 32 || material.length > 16384 || /[\r\n\0]/.test(material))
          throw new Error("Invalid private repository material");
        await gate();
        result = await this.transport.execute(scope, args, {
          PGBACKREST_REPO1_CIPHER_PASS: material,
        });
        await gate();
      },
      gate,
    );
    if (result === undefined) throw new Error("Private backup invocation was not completed");
    return result;
  }
  async backup(input: RecoveryScope, gate: () => Promise<void>) {
    const scope = immutableSnapshot(input);
    if (scope.kind !== "full" && scope.kind !== "diff") throw new Error("Backup kind differs");
    const policy = await this.policy(scope);
    await gate();
    await this.transport.installConfiguration(scope, policy);
    await gate();
    await this.invoke(scope, pgBackRestArguments(policy, "stanza-create"), gate);
    await this.invoke(scope, pgBackRestArguments(policy, "check"), gate);
    const args = pgBackRestArguments(policy, scope.kind);
    args.splice(args.length - 1, 0, `--annotation=godseye-preparation=${scope.preparationHash}`);
    await this.invoke(scope, args, gate);
  }
  async restore(input: RecoveryScope, gate: () => Promise<void>) {
    const scope = immutableSnapshot(input);
    if (
      scope.kind !== "restore" ||
      !scope.backup ||
      !scope.targetTime ||
      scope.allocationId === scope.sourceAllocationId ||
      scope.environmentId === scope.sourceEnvironmentId
    )
      throw new Error("Restore requires a distinct held physical destination and exact backup");
    const backupScope = { ...scope, kind: scope.backup.kind, backup: null, targetTime: null };
    assertRecoveryInspection(
      backupScope,
      { scopeHash: fingerprint(backupScope), metadata: scope.backup, destination: null },
      this.now(),
    );
    if (
      Date.parse(scope.targetTime) < Date.parse(scope.backup.recoverableFrom) ||
      Date.parse(scope.targetTime) > Date.parse(scope.backup.recoverableTo)
    )
      throw new Error("Restore target is outside the proven archive interval");
    const policy = await this.policy(scope);
    await gate();
    const target = immutableSnapshot(await this.transport.reserveEmptyDestination(scope));
    await gate();
    if (
      target.allocationId !== scope.allocationId ||
      target.environmentId !== scope.environmentId ||
      !target.empty ||
      !target.linksAbsent ||
      !target.owned ||
      !target.privateNetwork ||
      target.tablespaces !== "default-only"
    )
      throw new Error("Recovery target is not an exact empty independently owned allocation");
    await this.transport.installConfiguration(scope, policy);
    await gate();
    await this.invoke(
      scope,
      pgBackRestRestoreArguments(policy, {
        pgData: target.pgData,
        walPath: target.walPath,
        backupLabel: scope.backup.backupLabel,
        targetTime: scope.targetTime,
        targetTimeline: scope.backup.timeline,
      }),
      gate,
    );
    await gate();
    await this.transport.replaceRestoredConfiguration(scope, target);
    await gate();
    await this.transport.startPaused(scope, target);
    await gate();
  }
  async check(input: RecoveryScope, gate: () => Promise<void>) {
    const scope = immutableSnapshot(input);
    if (scope.kind !== "check" || !scope.backup)
      throw new Error("Archive check requires an exact existing backup");
    const policy = await this.policy(scope);
    await gate();
    await this.transport.installConfiguration(scope, policy);
    await gate();
    await this.invoke(scope, pgBackRestArguments(policy, "check"), gate);
  }
  async inspect(input: RecoveryScope) {
    const scope = immutableSnapshot(input),
      policy = await this.policy(scope);
    const output = await this.invoke(
      scope,
      pgBackRestArguments(policy, "info"),
      async () => {
        const proof = await this.qualification(scope);
        if (
          !proof ||
          proof.scopeHash !== fingerprint(scope) ||
          Date.parse(proof.expiresAt) <= this.now().getTime()
        )
          throw new Error("Private recovery inspection authority expired");
      },
      true,
    );
    const selected = inspectPgBackRestInfo(output, policy, scope);
    const result = immutableSnapshot(await this.transport.inspect(scope, output));
    const verified = assertRecoveryInspection(scope, result, this.now());
    if (
      verified.metadata.backupLabel !== selected.label ||
      verified.metadata.startLsn !== selected.lsn.start ||
      verified.metadata.stopLsn !== selected.lsn.stop ||
      Date.parse(verified.metadata.startedAt) !== selected.timestamp.start * 1000 ||
      Date.parse(verified.metadata.completedAt) !== selected.timestamp.stop * 1000
    )
      throw new Error("Independent manifest evidence differs from selected repository information");
    return verified;
  }
}
/** Native process executor: no shell, inherited pgBackRest overrides, command output or private material in errors. */
export class PgBackRestProcess {
  constructor(
    private readonly executable: string,
    private readonly timeoutMs = 300000,
    private readonly outputLimit = 4 * 1024 * 1024,
  ) {
    if (
      !/^(?:\/[A-Za-z0-9_./-]+|[A-Za-z]:[\\/][A-Za-z0-9_./\\ -]+)$/.test(executable) ||
      !Number.isSafeInteger(timeoutMs) ||
      timeoutMs <= 0 ||
      !Number.isSafeInteger(outputLimit) ||
      outputLimit <= 0
    )
      throw new Error("Invalid private pgBackRest process binding");
  }
  execute(argsInput: readonly string[], privateEnvironment: Readonly<Record<string, string>>) {
    const args = immutableSnapshot(argsInput);
    const allowed = new Set(["stanza-create", "check", "info", "backup", "restore"]);
    if (
      !allowed.has(args.at(-1) ?? "") ||
      args.some((arg) => /[\0\r\n]/.test(arg)) ||
      Object.keys(privateEnvironment).some((key) => key !== "PGBACKREST_REPO1_CIPHER_PASS")
    )
      throw new Error("Invalid private pgBackRest invocation");
    const env: NodeJS.ProcessEnv = {};
    for (const key of ["PATH", "HOME", "LANG", "LC_ALL", "SYSTEMROOT", "TEMP", "TMP"])
      if (process.env[key]) env[key] = process.env[key];
    Object.assign(env, privateEnvironment);
    return new Promise<string>((resolve, reject) => {
      const child = spawn(this.executable, [...args], {
        env,
        shell: false,
        windowsHide: true,
        stdio: ["ignore", "pipe", "ignore"],
      });
      const chunks: Buffer[] = [];
      let size = 0,
        exceeded = false;
      const timeout = setTimeout(() => child.kill("SIGKILL"), this.timeoutMs);
      child.stdout.on("data", (chunk: Buffer) => {
        size += chunk.length;
        if (size > this.outputLimit) {
          exceeded = true;
          child.kill("SIGKILL");
        } else chunks.push(chunk);
      });
      child.once("error", () => {
        clearTimeout(timeout);
        reject(new Error("Private pgBackRest process unavailable"));
      });
      child.once("close", (code) => {
        clearTimeout(timeout);
        if (code !== 0 || exceeded)
          reject(new Error("Private pgBackRest command failed or exceeded bounds"));
        else resolve(Buffer.concat(chunks).toString("utf8"));
      });
    });
  }
}
