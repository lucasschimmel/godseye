import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle as nodePg } from "drizzle-orm/node-postgres";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { drizzle as pglite } from "drizzle-orm/pglite";
import pg from "pg";
import { BOARDS_MIGRATION } from "./migration";
import { schema } from "./schema";

export type BoardsDatabase = PgDatabase<PgQueryResultHKT, typeof schema>;
export interface BoardsStore {
  db: BoardsDatabase;
  close(): Promise<void>;
}

/**
 * Opens the boards database: an external PostgreSQL when `databaseUrl` is given (the hosted case),
 * otherwise an embedded PGlite directory (local development) or `memory://` (tests).
 */
export async function openBoardsStore(options: {
  databaseUrl?: string;
  dataDir?: string;
}): Promise<BoardsStore> {
  if (options.databaseUrl) {
    const pool = new pg.Pool({ connectionString: options.databaseUrl, max: 5 });
    await pool.query(BOARDS_MIGRATION);
    return { db: nodePg(pool, { schema }), close: () => pool.end() };
  }
  const dataDir = options.dataDir ?? "memory://";
  if (dataDir !== "memory://") mkdirSync(dirname(resolve(dataDir)), { recursive: true });
  const client = new PGlite(dataDir);
  await client.waitReady;
  await client.exec(BOARDS_MIGRATION);
  return { db: pglite(client, { schema }), close: () => client.close() };
}
