import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";

interface MigrationConnection {
  exec(statement: string): Promise<unknown>;
  rows(statement: string): Promise<Record<string, unknown>[]>;
}
export type MigrationTransaction = (
  work: (connection: MigrationConnection) => Promise<void>,
) => Promise<void>;

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
