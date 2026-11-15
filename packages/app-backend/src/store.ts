import { createHash, randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import { type NodePgDatabase, drizzle as postgresDrizzle } from "drizzle-orm/node-postgres";
import { type PgliteDatabase, drizzle as pgliteDrizzle } from "drizzle-orm/pglite";
import pg from "pg";
import { ApplicationError, ApplicationScope, type ApplicationScopeInput } from "./contracts.js";
import { acquireApplicationInstance } from "./instance.js";
import { APPLICATION_JOBS_MIGRATION } from "./jobs-migration.js";
import { APPLICATION_MIGRATION } from "./migration.js";
import { protectApplicationDirectory } from "./private-files.js";
import * as schema from "./schema.js";
import { type ApplicationTlsOptions, applicationPoolConfig } from "./store-connection.js";

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
const migrationHash = () => createHash("sha256").update(APPLICATION_MIGRATION).digest("hex");
async function seedScope(tx: ApplicationAccess, scope: Readonly<ApplicationScopeInput>) {
  await tx
    .insert(schema.appScope)
    .values({
      id: 1,
      ...scope,
      migrationHash: migrationHash(),
      recoveryHold: false,
      storeId: randomUUID(),
    })
    .onConflictDoNothing();
}
async function applyJobsMigration(tx: ApplicationAccess) {
  for (const statement of APPLICATION_JOBS_MIGRATION.split(";").filter((value) => value.trim()))
    await tx.execute(statement);
}
export async function openApplicationStore(options: {
  scope: ApplicationScopeInput;
  dataDir?: string;
  databaseUrl?: string;
  /**
   * Optional separate DDL-capable identity (the cell `migration` role). When set, only it runs
   * migrations and seeds the scope row; the runtime identity in `databaseUrl` then needs DML only.
   */
  migrationDatabaseUrl?: string;
  tls?: ApplicationTlsOptions;
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
  if ((options.migrationDatabaseUrl || options.tls) && !options.databaseUrl)
    throw new ApplicationError(
      "INVALID_CONFIGURATION",
      "Role and TLS options need a database URL",
      422,
    );
  if (options.migrationDatabaseUrl && options.migrationDatabaseUrl === options.databaseUrl)
    throw new ApplicationError(
      "INVALID_CONFIGURATION",
      "Migration and runtime identities must differ",
      422,
    );
  const separateMigration = Boolean(options.migrationDatabaseUrl);
  const client = options.databaseUrl
    ? new pg.Pool(applicationPoolConfig(options.databaseUrl, options.tls, 5))
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
    const hash = migrationHash();
    if (options.migrationDatabaseUrl) {
      // Separate DDL identity: it migrates and seeds the scope row, then is closed before runtime use.
      const migrator = new pg.Pool(
        applicationPoolConfig(options.migrationDatabaseUrl, options.tls, 1),
      );
      try {
        await migrator.query(APPLICATION_MIGRATION);
        await postgresDrizzle(migrator, { schema }).transaction(async (tx) => {
          await seedScope(tx, scope);
          await applyJobsMigration(tx);
        });
      } finally {
        await migrator.end();
      }
    } else if (client instanceof PGlite) await client.exec(APPLICATION_MIGRATION);
    else await client.query(APPLICATION_MIGRATION);
    let recoveryHeld = false;
    let storeId = "";
    await db.transaction(async (tx) => {
      if (!separateMigration) await seedScope(tx, scope);
      const scopeQuery = tx.select().from(schema.appScope).where(eq(schema.appScope.id, 1));
      // The runtime identity only needs SELECT when it does not own the schema.
      const [existing] = await (separateMigration ? scopeQuery : scopeQuery.for("update"));
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
      if (!separateMigration) await applyJobsMigration(tx);
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
