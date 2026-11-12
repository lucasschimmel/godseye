import { PGlite } from "@electric-sql/pglite";
import { type NodePgDatabase, drizzle as postgresDrizzle } from "drizzle-orm/node-postgres";
import { type PgliteDatabase, drizzle as pgliteDrizzle } from "drizzle-orm/pglite";
import pg from "pg";
import { migrate } from "./migrations.js";
import * as schema from "./schema.js";

export type ControlDatabase = PgliteDatabase<typeof schema> | NodePgDatabase<typeof schema>;
export type DatabaseAccess = Pick<
  ControlDatabase,
  "select" | "insert" | "update" | "delete" | "execute"
>;
export interface Store {
  db: DatabaseAccess;
  fullDb: ControlDatabase;
  transaction<T>(work: (tx: DatabaseAccess) => Promise<T>): Promise<T>;
  close(): Promise<void>;
  driver: "pglite" | "postgres";
}

export async function openStore(
  options: { dataDir?: string; databaseUrl?: string } = {},
): Promise<Store> {
  if (options.databaseUrl) {
    const pool = new pg.Pool({ connectionString: options.databaseUrl, max: 5 });
    try {
      await migrate(
        (statement) => pool.query(statement),
        async (work) => {
          const connection = await pool.connect();
          try {
            await connection.query("BEGIN");
            await work({
              exec: (statement) => connection.query(statement),
              rows: async (statement) => (await connection.query(statement)).rows,
            });
            await connection.query("COMMIT");
          } catch (error) {
            await connection.query("ROLLBACK");
            throw error;
          } finally {
            connection.release();
          }
        },
      );
      const db = postgresDrizzle(pool, { schema });
      return {
        db,
        fullDb: db,
        transaction: (work) => db.transaction(work),
        close: () => pool.end(),
        driver: "postgres",
      };
    } catch (error) {
      await pool.end();
      throw error;
    }
  }
  const client = new PGlite(options.dataDir ?? "memory://");
  await client.waitReady;
  try {
    await migrate(
      (statement) => client.exec(statement),
      async (work) =>
        client.transaction(async (connection) => {
          await work({
            exec: (statement) => connection.exec(statement),
            rows: async (statement) =>
              (await connection.query<Record<string, unknown>>(statement)).rows,
          });
        }),
    );
  } catch (error) {
    await client.close();
    throw error;
  }
  const db = pgliteDrizzle(client, { schema });
  return {
    db,
    fullDb: db,
    transaction: (work) => db.transaction(work),
    close: () => client.close(),
    driver: "pglite",
  };
}

export { schema };
