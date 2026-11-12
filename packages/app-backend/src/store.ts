import { createHash, randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import { type NodePgDatabase, drizzle as postgresDrizzle } from "drizzle-orm/node-postgres";
import { type PgliteDatabase, drizzle as pgliteDrizzle } from "drizzle-orm/pglite";
import pg from "pg";
import { ApplicationError, ApplicationScope, type ApplicationScopeInput } from "./contracts.js";
import { acquireApplicationInstance } from "./instance.js";
import { APPLICATION_MIGRATION } from "./migration.js";
import { protectApplicationDirectory } from "./private-files.js";
import * as schema from "./schema.js";

export type ApplicationDatabase = PgliteDatabase<typeof schema> | NodePgDatabase<typeof schema>;
export type ApplicationAccess = Pick<
  ApplicationDatabase,
  "select" | "insert" | "update" | "delete" | "execute"
>;
export interface ApplicationStore {
  db: ApplicationDatabase;
  scope: Readonly<ApplicationScopeInput>;
  recoveryHeld: boolean;
  readonly healthy: boolean;
  readonly id: string;
  runtimeActive: boolean;
  transaction<T>(work: (tx: ApplicationAccess) => Promise<T>): Promise<T>;
  exclusive<T>(work: () => Promise<T>): Promise<T>;
  close(): Promise<void>;
}
export function serialApplicationLane() {
  let tail: Promise<unknown> = Promise.resolve();
  return <T>(work: () => Promise<T>): Promise<T> => {
    const current = tail.then(work, work);
    tail = current.catch(() => undefined);
    return current;
  };
}
export async function openApplicationStore(options: {
  scope: ApplicationScopeInput;
  dataDir?: string;
  databaseUrl?: string;
}): Promise<ApplicationStore> {
  const scope = Object.freeze(ApplicationScope.parse(options.scope));
  if (options.databaseUrl && options.dataDir)
    throw new ApplicationError("INVALID_CONFIGURATION", "Choose one application database", 422);
  if (options.dataDir && options.dataDir !== "memory://")
    await protectApplicationDirectory(options.dataDir);
  const releaseFile =
    options.dataDir && options.dataDir !== "memory://"
      ? await acquireApplicationInstance(`${options.dataDir}.runtime`)
      : undefined;
  const client = options.databaseUrl
    ? new pg.Pool({ connectionString: options.databaseUrl, max: 5 })
    : new PGlite(options.dataDir ?? "memory://");
  const db =
    client instanceof PGlite
      ? pgliteDrizzle(client, { schema })
      : postgresDrizzle(client, { schema });
  let connection: pg.PoolClient | undefined;
  let healthy = true;
  try {
    if (client instanceof PGlite) await client.waitReady;
    if (!(client instanceof PGlite)) {
      connection = await client.connect();
      const result = await connection.query<{ locked: boolean }>(
        "SELECT pg_try_advisory_lock(16034483, hashtext('godseye_application_runtime')) AS locked",
      );
      if (!result.rows[0]?.locked)
        throw new ApplicationError(
          "INSTANCE_LOCKED",
          "Application database already has a runtime",
          409,
        );
      connection.on("error", () => {
        healthy = false;
      });
      connection.on("end", () => {
        healthy = false;
      });
    }
    const hash = createHash("sha256").update(APPLICATION_MIGRATION).digest("hex");
    if (client instanceof PGlite) await client.exec(APPLICATION_MIGRATION);
    else await client.query(APPLICATION_MIGRATION);
    let recoveryHeld = false;
    let storeId = "";
    await db.transaction(async (tx) => {
      await tx
        .insert(schema.appScope)
        .values({
          id: 1,
          ...scope,
          migrationHash: hash,
          recoveryHold: false,
          storeId: randomUUID(),
        })
        .onConflictDoNothing();
      const [existing] = await tx
        .select()
        .from(schema.appScope)
        .where(eq(schema.appScope.id, 1))
        .for("update");
      if (
        existing?.projectId !== scope.projectId ||
        existing?.environmentId !== scope.environmentId ||
        existing?.migrationHash !== hash
      )
        throw new ApplicationError(
          "STORE_SCOPE_MISMATCH",
          "Application store scope or schema differs",
          409,
        );
      recoveryHeld = existing.recoveryHold;
      storeId = existing.storeId;
    });
    const exclusive = serialApplicationLane();
    let closed = false;
    return {
      db,
      scope,
      recoveryHeld,
      id: storeId,
      runtimeActive: false,
      get healthy() {
        return healthy;
      },
      exclusive,
      transaction: (work) => db.transaction(work),
      async close() {
        if (closed) return;
        closed = true;
        healthy = false;
        connection?.release(true);
        if (client instanceof PGlite) await client.close();
        else await client.end();
        await releaseFile?.();
      },
    };
  } catch (error) {
    connection?.release(true);
    if (client instanceof PGlite) await client.close();
    else await client.end();
    await releaseFile?.();
    throw error;
  }
}
