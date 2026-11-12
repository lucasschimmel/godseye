import { randomBytes } from "node:crypto";
import { DATABASE_ROLES, type DatabaseRole } from "@godseye/contracts";
import pg, { type ClientConfig } from "pg";
import { assertDatabaseProfile, type CompiledDatabaseProfile } from "./database-policy.js";
import { compileDatabaseBootstrap, databaseIdentifier } from "./database-sql.js";

export { inspectPostgres } from "./database-inspection.js";

export type DatabaseMaterial = Record<DatabaseRole, string>;
export interface PostgresConnection {
  query(sql: string, values?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
  end(): Promise<void>;
}
export type PostgresConnectionFactory = (database: string) => Promise<PostgresConnection>;
export function createDatabaseMaterial(): DatabaseMaterial {
  return Object.fromEntries(
    DATABASE_ROLES.map((role) => [role, randomBytes(32).toString("base64url")]),
  ) as DatabaseMaterial;
}
/** Private TCP adapter enforces CA and hostname validation, finite resources and no URI overrides. */
export function postgresConnectionFactory(config: {
  host: string;
  port: number;
  user: string;
  password: string;
  ca: string;
  servername: string;
}): PostgresConnectionFactory {
  return async (database) => {
    const client = new pg.Client({
      host: config.host,
      port: config.port,
      user: config.user,
      password: config.password,
      database,
      ssl: {
        ca: config.ca,
        rejectUnauthorized: true,
        servername: config.servername,
        minVersion: "TLSv1.2",
      },
      connectionTimeoutMillis: 5000,
      query_timeout: 30000,
      statement_timeout: 30000,
      application_name: "godseye-private-database-policy",
    } satisfies ClientConfig);
    try {
      await client.connect();
      return client;
    } catch {
      await client.end();
      throw new Error("Private PostgreSQL connection failed");
    }
  };
}
/** Executes the exact production policy. A partially completed bootstrap must be reconciled, never blindly replayed. */
export async function bootstrapPostgres(
  profile: CompiledDatabaseProfile,
  connect: PostgresConnectionFactory,
  material: DatabaseMaterial,
  assertDispatch: () => Promise<void> = async () => {},
) {
  assertDatabaseProfile(profile);
  const distinct = new Set(Object.values(material));
  if (
    distinct.size !== DATABASE_ROLES.length ||
    DATABASE_ROLES.some((role) => !/^[A-Za-z0-9_-]{43}$/.test(material[role]))
  )
    throw new Error("Invalid private role material");
  const connections = new Map<string, PostgresConnection>();
  try {
    const admin = await connect("postgres");
    connections.set("postgres", admin);
    await assertDispatch();
    await admin.query("SELECT pg_advisory_lock(740133001)");
    const existing = await admin.query(
      "SELECT datname FROM pg_database WHERE datname NOT IN ('postgres','template0','template1')",
    );
    if (existing.rows.length) throw new Error("Database bootstrap requires a new isolated cluster");
    for (const statement of compileDatabaseBootstrap(profile)) {
      await assertDispatch();
      let connection = connections.get(statement.database);
      if (!connection) {
        connection = await connect(statement.database);
        connections.set(statement.database, connection);
      }
      await assertDispatch();
      await connection.query(statement.sql);
    }
    for (const role of DATABASE_ROLES) {
      await assertDispatch();
      // PostgreSQL utility DDL does not accept bind placeholders; the material alphabet is validated above.
      await admin.query(
        `ALTER ROLE ${databaseIdentifier(profile.roles[role].name)} LOGIN PASSWORD '${material[role]}'`,
      );
    }
  } catch {
    throw new Error("Private PostgreSQL bootstrap requires inspection");
  } finally {
    await Promise.all([...connections.values()].map((connection) => connection.end()));
  }
}
