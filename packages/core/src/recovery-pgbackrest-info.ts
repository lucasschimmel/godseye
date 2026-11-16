import { z } from "zod";
import type { CompiledPgBackRest } from "./recovery-pgbackrest-policy.js";
import type { RecoveryScope } from "./recovery-provider.js";

const Backup = z.object({
  error: z.literal(false),
  label: z.string().regex(/^\d{8}-\d{6}F(?:_\d{8}-\d{6}[DI])?$/),
  type: z.enum(["full", "diff", "incr"]),
  prior: z.string().nullable(),
  database: z.object({ id: z.number().int().positive(), "repo-key": z.number().int().positive() }),
  timestamp: z.object({ start: z.number().int().positive(), stop: z.number().int().positive() }),
  lsn: z.object({ start: z.string(), stop: z.string() }),
  archive: z.object({ start: z.string(), stop: z.string() }),
  annotation: z.record(z.string(), z.string()).nullable().optional(),
});
const Info = z.array(
  z.object({
    name: z.string(),
    status: z.object({ code: z.number().int() }),
    db: z.array(
      z.object({
        id: z.number().int().positive(),
        "repo-key": z.number().int().positive(),
        "system-id": z.string().regex(/^\d{1,20}$/),
      }),
    ),
    backup: z.array(Backup),
    repo: z.array(
      z.object({
        key: z.number().int().positive(),
        cipher: z.literal("aes-256-cbc"),
        status: z.object({ code: z.literal(0) }),
      }),
    ),
  }),
);
/** JSON repository status can report an error with exit code zero. Preserve 64-bit PostgreSQL identities. */
export function inspectPgBackRestInfo(
  text: string,
  policy: CompiledPgBackRest,
  scope: RecoveryScope,
) {
  if (Buffer.byteLength(text) > 4 * 1024 * 1024)
    throw new Error("Repository information exceeds its bound");
  let parsed: z.infer<typeof Info>;
  try {
    parsed = Info.parse(JSON.parse(text.replace(/("system-id"\s*:\s*)(\d+)/g, '$1"$2"')));
  } catch {
    throw new Error("Repository information is malformed or unavailable");
  }
  if (parsed.length !== 1 || parsed[0]?.name !== policy.stanza || parsed[0].status.code !== 0)
    throw new Error("Exact repository stanza is not healthy");
  const stanza = parsed[0];
  if (stanza.repo.length !== 1 || stanza.repo[0]?.key !== 1)
    throw new Error("Exact encrypted repository is unavailable");
  const matches = stanza.backup.filter((backup) =>
    scope.kind === "restore" || scope.kind === "check"
      ? backup.label === scope.backup?.backupLabel
      : backup.annotation?.["godseye-preparation"] === scope.preparationHash,
  );
  const backup = matches[0];
  if (
    matches.length !== 1 ||
    !backup ||
    backup.type !==
      (scope.kind === "restore" || scope.kind === "check" ? scope.backup?.kind : scope.kind)
  )
    throw new Error("Exact recovery backup selection is missing or ambiguous");
  const databases = stanza.db.filter((db) => db.id === backup.database.id && db["repo-key"] === 1);
  if (
    backup.database["repo-key"] !== 1 ||
    databases.length !== 1 ||
    databases[0]?.["system-id"] !== scope.sourceSystemIdentifier ||
    backup.timestamp.stop < backup.timestamp.start ||
    ![backup.archive.start, backup.archive.stop].every((wal) => /^[A-F0-9]{24}$/.test(wal))
  )
    throw new Error("Repository backup source lineage differs");
  // This verifies identity only. It deliberately does not derive a continuous archive interval.
  return backup;
}
