import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";

interface MigrationConnection {
  exec(statement: string): Promise<unknown>;
  rows(statement: string): Promise<Record<string, unknown>[]>;
}
export type MigrationTransaction = (
  work: (connection: MigrationConnection) => Promise<void>,
) => Promise<void>;

/** Raised before any mutation when the database history is incompatible with this code version. */
export class MigrationCompatibilityError extends Error {
  constructor(
    readonly reason: "unknown_applied_migration" | "applied_set_has_gap",
    readonly migrations: string[],
  ) {
    super(
      reason === "unknown_applied_migration"
        ? `Database has applied migrations unknown to this version (downgrade refused): ${migrations.join(", ")}`
        : `Applied migrations are not a contiguous prefix; missing before later applied ones: ${migrations.join(", ")}`,
    );
    this.name = "MigrationCompatibilityError";
  }
}

/** Versioned, checksummed migrations preserve existing local databases and reject drift. */
export async function migrate(
  exec: (statement: string) => Promise<unknown>,
  transaction: MigrationTransaction,
) {
  await exec(`CREATE TABLE IF NOT EXISTS control_migrations (name text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now());
    CREATE TABLE IF NOT EXISTS control_migration_lock (id integer PRIMARY KEY CHECK(id=1));
    INSERT INTO control_migration_lock VALUES(1) ON CONFLICT DO NOTHING;`);
  const directory = new URL("../migrations/", import.meta.url);
  const files = (await readdir(directory))
    .filter((name) => /^\d{4}_[a-z0-9_]+\.sql$/.test(name))
    .sort();
  await transaction(async (connection) => {
    await connection.rows("SELECT id FROM control_migration_lock WHERE id=1 FOR UPDATE");
    const applied = (await connection.rows("SELECT name FROM control_migrations")).map((row) =>
      String(row.name),
    );
    const unknown = applied.filter((name) => !files.includes(name)).sort();
    if (unknown.length) throw new MigrationCompatibilityError("unknown_applied_migration", unknown);
    const last = Math.max(-1, ...applied.map((name) => files.indexOf(name)));
    const gaps = files.slice(0, last + 1).filter((name) => !applied.includes(name));
    if (gaps.length) throw new MigrationCompatibilityError("applied_set_has_gap", gaps);
  });
  for (const name of files) {
    const statement = await readFile(new URL(name, directory), "utf8");
    const checksum = createHash("sha256").update(statement.replace(/\r\n/g, "\n")).digest("hex");
    await transaction(async (connection) => {
      await connection.rows("SELECT id FROM control_migration_lock WHERE id=1 FOR UPDATE");
      const [existing] = await connection.rows(
        `SELECT checksum FROM control_migrations WHERE name='${name}'`,
      );
      if (existing) {
        if (existing.checksum !== checksum)
          throw new Error(`Applied migration checksum mismatch: ${name}`);
        return;
      }
      await connection.exec(statement);
      await connection.exec(
        `INSERT INTO control_migrations(name,checksum) VALUES('${name}','${checksum}')`,
      );
    });
  }
}
