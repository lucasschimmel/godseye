// Forward-compatibility guard tests for the versioned migration runner.
// Concurrency note: PGlite is a single in-process connection, so row-lock contention on
// control_migration_lock cannot be exercised meaningfully here. Real-PostgreSQL concurrent
// migration is covered by the PG lab; it is intentionally not faked in this file.
import { PGlite } from "@electric-sql/pglite";
import { afterEach, describe, expect, it } from "vitest";
import { MigrationCompatibilityError, migrate } from "../packages/store/src/migrations.js";

const clients: PGlite[] = [];
afterEach(async () => {
  await Promise.all(clients.splice(0).map((client) => client.close()));
});

async function run(client: PGlite) {
  await migrate(
    (statement) => client.exec(statement),
    (work) =>
      client.transaction(async (connection) => {
        await work({
          exec: (statement) => connection.exec(statement),
          rows: async (statement) =>
            (await connection.query<Record<string, unknown>>(statement)).rows,
        });
      }),
  );
}
async function migrated() {
  const client = new PGlite("memory://");
  await client.waitReady;
  clients.push(client);
  await run(client);
  return client;
}
const snapshot = async (client: PGlite) =>
  (
    await client.query<{ name: string; checksum: string }>(
      "SELECT name, checksum FROM control_migrations ORDER BY name",
    )
  ).rows;

describe("migration forward-compatibility guard", () => {
  it("refuses unknown future migrations with a typed error and no mutation", async () => {
    const client = await migrated();
    const before = await snapshot(client);
    await client.exec(
      "INSERT INTO control_migrations(name,checksum) VALUES('9999_from_the_future.sql','x')",
    );
    const expected = [...before, { name: "9999_from_the_future.sql", checksum: "x" }];
    const error = await run(client).then(
      () => undefined,
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(MigrationCompatibilityError);
    expect(error).toMatchObject({
      reason: "unknown_applied_migration",
      migrations: ["9999_from_the_future.sql"],
    });
    expect(await snapshot(client)).toEqual(expected);
  });

  it("refuses a partial or out-of-order applied set without mutation", async () => {
    const client = await migrated();
    const second = (await snapshot(client))[1]?.name as string;
    await client.exec(`DELETE FROM control_migrations WHERE name='${second}'`);
    const before = await snapshot(client);
    await expect(run(client)).rejects.toMatchObject({
      reason: "applied_set_has_gap",
      migrations: [second],
    });
    expect(await snapshot(client)).toEqual(before);
  });

  it("keeps the checksum mismatch message", async () => {
    const client = await migrated();
    const name = (await snapshot(client))[0]?.name as string;
    await client.exec(`UPDATE control_migrations SET checksum='bad' WHERE name='${name}'`);
    await expect(run(client)).rejects.toThrow(`Applied migration checksum mismatch: ${name}`);
  });

  it("is idempotent when re-run on a current database", async () => {
    const client = await migrated();
    const before = await snapshot(client);
    await run(client);
    await run(client);
    expect(await snapshot(client)).toEqual(before);
  });
});
