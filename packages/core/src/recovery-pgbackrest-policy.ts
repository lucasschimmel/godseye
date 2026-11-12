import { posix } from "node:path";
import { z } from "zod";
import { immutableSnapshot } from "./infra-policy.js";
import { fingerprint } from "./journal.js";

/** Private, server-owned paths. Never accepted from an owner request. */
export interface PgBackRestBinding {
  projectId: string;
  sourceAllocationId: string;
  repositoryId: string;
  pgData: string;
  pgWal: string;
  pgSocket: string;
  pgPort: number;
  pgUser: string;
  repositoryPath: string;
  configPath: string;
  configIncludePath: string;
  lockPath: string;
  logPath: string;
  fullRetention?: number;
  differentialRetention?: number;
}
const path = z
  .string()
  .regex(/^\/[A-Za-z0-9_./-]+$/)
  .refine((s) => s !== "/" && posix.normalize(s) === s && !s.split("/").includes(".."));
const overlaps = (a: string, b: string) =>
  a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`);
export function compilePgBackRest(bindingInput: PgBackRestBinding) {
  const binding = immutableSnapshot(bindingInput);
  for (const id of [binding.projectId, binding.sourceAllocationId, binding.repositoryId])
    z.string().uuid().parse(id);
  for (const value of [
    binding.pgData,
    binding.pgWal,
    binding.pgSocket,
    binding.repositoryPath,
    binding.configPath,
    binding.configIncludePath,
    binding.lockPath,
    binding.logPath,
  ])
    path.parse(value);
  z.number().int().min(1).max(65535).parse(binding.pgPort);
  z.string()
    .regex(/^[a-z_][a-z0-9_]{0,62}$/)
    .parse(binding.pgUser);
  const stanza = `g_${binding.sourceAllocationId.replaceAll("-", "")}`;
  const fullRetention = z
    .number()
    .int()
    .min(2)
    .max(4)
    .parse(binding.fullRetention ?? 4);
  const differentialRetention = z
    .number()
    .int()
    .min(1)
    .max(30)
    .parse(binding.differentialRetention ?? 7);
  if (
    overlaps(binding.pgData, binding.repositoryPath) ||
    overlaps(binding.pgWal, binding.repositoryPath) ||
    overlaps(binding.pgData, binding.pgWal)
  )
    throw new Error("Repository and database paths overlap");
  const config = [
    "[global]",
    `repo1-path=${binding.repositoryPath}`,
    "repo1-cipher-type=aes-256-cbc",
    `repo1-retention-full=${fullRetention}`,
    `repo1-retention-diff=${differentialRetention}`,
    "archive-check=y",
    "archive-timeout=60",
    "process-max=2",
    "log-level-console=off",
    "log-level-file=off",
    `lock-path=${binding.lockPath}`,
    `log-path=${binding.logPath}`,
    `[${stanza}]`,
    `pg1-path=${binding.pgData}`,
    `pg1-socket-path=${binding.pgSocket}`,
    `pg1-port=${binding.pgPort}`,
    `pg1-user=${binding.pgUser}`,
    "",
  ].join("\n");
  const base = [
    `--config=${binding.configPath}`,
    `--config-include-path=${binding.configIncludePath}`,
    `--stanza=${stanza}`,
    "--repo=1",
    "--log-level-console=off",
    "--log-level-file=off",
  ];
  return immutableSnapshot({
    binding,
    stanza,
    config,
    base,
    hash: fingerprint({ binding, config }),
  });
}
export type CompiledPgBackRest = ReturnType<typeof compilePgBackRest>;
export type PgBackRestOperation = "stanza-create" | "check" | "info" | "full" | "diff";
export function pgBackRestArguments(
  compiled: CompiledPgBackRest,
  operation: PgBackRestOperation,
): string[] {
  if (fingerprint(compilePgBackRest(compiled.binding)) !== fingerprint(compiled))
    throw new Error("pgBackRest policy integrity differs");
  if (operation === "full" || operation === "diff")
    return [...compiled.base, `--type=${operation}`, "--no-expire-auto", "backup"];
  if (operation === "info") return [...compiled.base, "--output=json", "info"];
  if (!["stanza-create", "check"].includes(operation))
    throw new Error("Unsupported backup command");
  return [...compiled.base.filter((arg) => arg !== "--repo=1"), operation];
}
export interface PgBackRestRestoreTarget {
  pgData: string;
  walPath: string;
  backupLabel: string;
  targetTime: string;
  targetTimeline: number;
}
/** Explicit immutable backup selection and pause; no delta, overwrite, latest or promote defaults. */
export function pgBackRestRestoreArguments(
  compiled: CompiledPgBackRest,
  input: PgBackRestRestoreTarget,
) {
  const target = immutableSnapshot(input);
  path.parse(target.pgData);
  path.parse(target.walPath);
  if (
    overlaps(target.pgData, target.walPath) ||
    [target.pgData, target.walPath].some((p) =>
      [
        compiled.binding.pgData,
        compiled.binding.pgWal,
        compiled.binding.pgSocket,
        compiled.binding.repositoryPath,
        compiled.binding.configPath,
        compiled.binding.configIncludePath,
        compiled.binding.lockPath,
        compiled.binding.logPath,
      ].some((source) => overlaps(p, source)),
    )
  )
    throw new Error("Recovery requires distinct destination data and WAL paths");
  z.string()
    .regex(/^\d{8}-\d{6}F(?:_\d{8}-\d{6}[DI])?$/)
    .parse(target.backupLabel);
  z.string().datetime().parse(target.targetTime);
  z.number().int().positive().max(4294967295).parse(target.targetTimeline);
  return [
    ...pgBackRestArguments(compiled, "info").slice(0, -2),
    `--pg1-path=${target.pgData}`,
    `--link-map=pg_wal=${target.walPath}`,
    `--set=${target.backupLabel}`,
    "--type=time",
    `--target=${new Date(target.targetTime).toISOString().replace("T", " ").replace("Z", "+00")}`,
    `--target-timeline=${target.targetTimeline}`,
    "--target-action=pause",
    "--archive-mode=off",
    "restore",
  ];
}
export function pgBackRestArchiveCommand(compiled: CompiledPgBackRest, executable: string) {
  path.parse(executable);
  return `${executable} ${compiled.base.filter((arg) => arg !== "--repo=1").join(" ")} archive-push %p`;
}
