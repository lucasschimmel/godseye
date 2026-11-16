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
  /** A session-held PostgreSQL singleton lock, independent of any local directory spelling. */
  lockRuntime?(name: string, onLost?: () => void): Promise<() => Promise<void>>;
}

export async function openStore(
  options: { dataDir?: string; databaseUrl?: string } = {},
): Promise<Store> {
  if (options.databaseUrl) {
    const pool = new pg.Pool({ connectionString: options.databaseUrl, max: 5 });
    let bootstrap: pg.PoolClient | undefined;
    try {
      bootstrap = await pool.connect();
      // Session advisory lock exists before migration tables do, protecting concurrent cold starts.
      await bootstrap.query("SELECT pg_advisory_lock(714620061)");
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
        async lockRuntime(name, onLost) {
          const connection = await pool.connect();
          try {
            const result = await connection.query<{ locked: boolean }>(
              "SELECT pg_try_advisory_lock(hashtextextended($1, 0)) AS locked",
              [name],
            );
            if (!result.rows[0]?.locked)
              throw new Error("Another trusted runtime owns this database consumer partition");
          } catch {
            connection.release(true);
            throw new Error("Trusted runtime database ownership could not be acquired");
          }
          let released = false,
            lost = false;
          const fail = () => {
            if (!released && !lost) {
              lost = true;
              onLost?.();
            }
          };
          connection.on("error", fail);
          connection.on("end", fail);
          return async () => {
            if (released) return;
            released = true;
            connection.off("error", fail);
            connection.off("end", fail);
            try {
              if (!lost)
                await connection.query("SELECT pg_advisory_unlock(hashtextextended($1, 0))", [
                  name,
                ]);
            } finally {
              connection.release(lost);
            }
          };
        },
      };
    } catch (error) {
      bootstrap?.release(true);
      bootstrap = undefined;
      await pool.end();
      throw error;
    } finally {
      if (bootstrap) {
        try {
          await bootstrap.query("SELECT pg_advisory_unlock(714620061)");
        } finally {
          bootstrap.release();
        }
      }
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
