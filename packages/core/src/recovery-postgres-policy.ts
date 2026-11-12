import { posix } from "node:path";
import { z } from "zod";
import { renderDatabaseSettings } from "./database-policy.js";
import { immutableSnapshot } from "./infra-policy.js";
import type { CompiledPgBackRest } from "./recovery-pgbackrest-policy.js";
import { pgBackRestRestoreArguments } from "./recovery-pgbackrest-policy.js";
import type { RecoveryScope } from "./recovery-provider.js";

export interface HeldRecoveryPostgresBinding {
  dataPath: string;
  walPath: string;
  socketPath: string;
  hbaPath: string;
  identPath: string;
  tlsCertificatePath: string;
  tlsKeyPath: string;
  pgBackRestExecutable: string;
  bootstrapRole: string;
  port: number;
}
/** A complete replacement configuration, never an include of restored source configuration. */
export function renderHeldRecoveryPostgres(
  scopeInput: RecoveryScope,
  bindingInput: HeldRecoveryPostgresBinding,
  repository: CompiledPgBackRest,
) {
  const scope = immutableSnapshot(scopeInput),
    binding = immutableSnapshot(bindingInput);
  if (
    scope.kind !== "restore" ||
    !scope.backup ||
    !scope.targetTime ||
    scope.allocationId === scope.sourceAllocationId
  )
    throw new Error("Held configuration requires an exact physical recovery target");
  for (const [key, value] of Object.entries(binding)) {
    if (key.endsWith("Path") || key === "pgBackRestExecutable")
      z.string()
        .regex(/^\/[A-Za-z0-9_./-]+$/)
        .refine((p) => p !== "/" && posix.normalize(p) === p)
        .parse(value);
  }
  z.string()
    .regex(/^[a-z_][a-z0-9_]{0,62}$/)
    .parse(binding.bootstrapRole);
  z.number().int().min(1).max(65535).parse(binding.port);
  if (
    repository.binding.repositoryId !== scope.repositoryId ||
    repository.binding.sourceAllocationId !== scope.sourceAllocationId ||
    repository.binding.projectId !== scope.projectId
  )
    throw new Error("Recovery configuration repository scope differs");
  pgBackRestRestoreArguments(repository, {
    pgData: binding.dataPath,
    walPath: binding.walPath,
    backupLabel: scope.backup.backupLabel,
    targetTime: scope.targetTime,
    targetTimeline: scope.backup.timeline,
  });
  const base = repository.base.filter((arg) => arg !== "--repo=1").join(" ");
  const settings: Record<string, string> = {
    ...renderDatabaseSettings(scope.sourceCatalog),
    data_directory: binding.dataPath,
    hba_file: binding.hbaPath,
    ident_file: binding.identPath,
    unix_socket_directories: binding.socketPath,
    unix_socket_permissions: "0700",
    listen_addresses: "",
    port: String(binding.port),
    ssl: "on",
    ssl_cert_file: binding.tlsCertificatePath,
    ssl_key_file: binding.tlsKeyPath,
    archive_mode: "off",
    archive_command: "",
    archive_library: "",
    archive_cleanup_command: "",
    recovery_end_command: "",
    primary_conninfo: "",
    primary_slot_name: "",
    shared_preload_libraries: "",
    session_preload_libraries: "",
    local_preload_libraries: "",
    ssl_passphrase_command: "",
    external_pid_file: "",
    logging_collector: "off",
    log_destination: "stderr",
    default_transaction_read_only: "on",
    hot_standby: "on",
    restore_command: `${binding.pgBackRestExecutable} ${base} archive-get %f %p`,
    recovery_target_time: new Date(scope.targetTime)
      .toISOString()
      .replace("T", " ")
      .replace("Z", "+00"),
    recovery_target_timeline: String(scope.backup.timeline),
    recovery_target_action: "pause",
    recovery_target_inclusive: "on",
  };
  const configuration = `${Object.entries(settings)
    .map(([key, value]) => `${key} = '${value.replaceAll("'", "''")}'`)
    .join("\n")}\n`;
  const hba = [
    `local all ${binding.bootstrapRole} scram-sha-256`,
    "local all all reject",
    "host all all 0.0.0.0/0 reject",
    "host all all ::/0 reject",
    "",
  ].join("\n");
  return immutableSnapshot({
    configuration,
    hba,
    ident: "",
    autoConfiguration: "",
    recoverySignal: "",
  });
}
