import {
  DATABASE_POLICY_VERSION,
  DATABASE_ROLES,
  DatabaseProfile,
  type DatabaseProfileInput,
  type DatabaseRole,
} from "@godseye/contracts";
import { z } from "zod";
import { parseInput } from "./errors.js";
import { parsePrivateSubnet } from "./infra-network.js";
import { fingerprint } from "./journal.js";

export interface DatabaseProfileScope {
  allocationId: string;
  projectId: string;
  environmentId: string;
}
export interface CompiledDatabaseProfile extends DatabaseProfileScope {
  policyVersion: typeof DATABASE_POLICY_VERSION;
  limits: DatabaseProfileInput;
  applicationDatabase: string;
  workflowDatabase: string;
  roles: Record<DatabaseRole, { name: string; connections: number }>;
  dataVolume: string;
  walVolume: string;
  storage: { dataQuotaGiB: number; walQuotaGiB: number; spillReservationGiB: number };
  configurationHash: string;
}
export function compileDatabaseProfile(
  input: DatabaseProfileInput,
  scope: DatabaseProfileScope,
): CompiledDatabaseProfile {
  const limits = parseInput(DatabaseProfile, input);
  for (const id of Object.values(scope)) z.string().uuid().parse(id);
  const suffix = scope.allocationId.replaceAll("-", "");
  const roles = Object.fromEntries(
    DATABASE_ROLES.map((role) => [
      role,
      {
        name: `g_${suffix}_${role.toLowerCase()}`,
        connections: ["api", "worker"].includes(role)
          ? Math.floor((limits.maxConnections - 16) / 4)
          : 2,
      },
    ]),
  ) as CompiledDatabaseProfile["roles"];
  const compiled = {
    ...scope,
    policyVersion: DATABASE_POLICY_VERSION,
    limits,
    applicationDatabase: `g_${suffix}_app`,
    workflowDatabase: `g_${suffix}_workflow`,
    roles,
    dataVolume: `pgdata-${suffix}`,
    walVolume: `pgwal-${suffix}`,
    storage: {
      dataQuotaGiB:
        limits.dataGiB + Math.ceil((limits.maxConnections * limits.temporaryMiB) / 1024),
      walQuotaGiB: limits.walGiB,
      spillReservationGiB: Math.ceil((limits.maxConnections * limits.temporaryMiB) / 1024),
    },
  };
  return { ...compiled, configurationHash: fingerprint(compiled) };
}
export function assertDatabaseProfile(profile: CompiledDatabaseProfile) {
  if (
    fingerprint(
      compileDatabaseProfile(profile.limits, {
        allocationId: profile.allocationId,
        projectId: profile.projectId,
        environmentId: profile.environmentId,
      }),
    ) !== fingerprint(profile)
  )
    throw new Error("Database profile integrity check failed");
}
/** The transport binds private volume paths and certificates; these are the immutable server settings. */
export function renderDatabaseSettings(profile: CompiledDatabaseProfile): Record<string, string> {
  assertDatabaseProfile(profile);
  return {
    ssl: "on",
    ssl_min_protocol_version: "TLSv1.2",
    password_encryption: "scram-sha-256",
    max_connections: String(profile.limits.maxConnections),
    superuser_reserved_connections: "3",
    shared_buffers: `${Math.floor(profile.limits.memoryMiB / 4)}MB`,
    work_mem: "1MB",
    maintenance_work_mem: "16MB",
    temp_file_limit: `${profile.limits.temporaryMiB}MB`,
    max_wal_size: `${profile.limits.walGiB * 512}MB`,
    min_wal_size: "80MB",
    max_slot_wal_keep_size: `${profile.limits.walGiB * 512}MB`,
    max_replication_slots: "0",
    max_wal_senders: "0",
    max_parallel_workers_per_gather: "0",
    max_parallel_maintenance_workers: "0",
    max_parallel_workers: "0",
    statement_timeout: "30000",
    lock_timeout: "5000",
    idle_in_transaction_session_timeout: "30000",
    log_statement: "none",
    log_min_error_statement: "panic",
    log_parameter_max_length: "0",
    log_parameter_max_length_on_error: "0",
    log_connections: "",
  };
}
export interface DatabaseHbaBinding {
  ipv4Cidr: string;
  ipv6Cidr: string;
  bootstrapRole: string;
}
/** Only private server bindings may supply addresses, never an HTTP input. */
export function renderDatabaseHba(
  profile: CompiledDatabaseProfile,
  binding: DatabaseHbaBinding,
): string {
  assertDatabaseProfile(profile);
  z.string()
    .regex(/^[a-z_][a-z0-9_]{0,62}$/)
    .parse(binding.bootstrapRole);
  for (const [cidr, family] of [
    [binding.ipv4Cidr, 4],
    [binding.ipv6Cidr, 6],
  ] as const) {
    if ((family === 4 && cidr === "127.0.0.1/32") || (family === 6 && cidr === "::1/128")) continue;
    if (parsePrivateSubnet(cidr).family !== family)
      throw new Error("Invalid private database network");
  }
  const lines = [`local all ${binding.bootstrapRole} scram-sha-256`, "local all all reject"];
  for (const role of DATABASE_ROLES) {
    const db = ["workflow", "workflowMigration"].includes(role)
      ? profile.workflowDatabase
      : profile.applicationDatabase;
    for (const cidr of [binding.ipv4Cidr, binding.ipv6Cidr]) {
      lines.push(`hostssl ${db} ${profile.roles[role].name} ${cidr} scram-sha-256`);
      if (role === "backup")
        lines.push(
          `hostssl ${profile.workflowDatabase} ${profile.roles[role].name} ${cidr} scram-sha-256`,
        );
    }
  }
  return [...lines, "host all all 0.0.0.0/0 reject", "host all all ::/0 reject", ""].join("\n");
}
