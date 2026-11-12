import { DATABASE_ROLES, type DatabaseRole } from "@godseye/contracts";
import { assertDatabaseProfile, type CompiledDatabaseProfile } from "./database-policy.js";

export interface DatabaseStatement {
  database: string;
  sql: string;
}
export function databaseIdentifier(value: string) {
  if (!/^[a-z_][a-z0-9_]{0,62}$/.test(value))
    throw new Error("Invalid compiled database identifier");
  return `"${value}"`;
}
const q = databaseIdentifier;
function defaultPolicy(owner: string, schema: string, roles: string[], readonly = false) {
  return [
    `ALTER DEFAULT PRIVILEGES FOR ROLE ${q(owner)} REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC`,
    `ALTER DEFAULT PRIVILEGES FOR ROLE ${q(owner)} REVOKE USAGE ON TYPES FROM PUBLIC`,
    `ALTER DEFAULT PRIVILEGES FOR ROLE ${q(owner)} IN SCHEMA ${q(schema)} REVOKE ALL ON TABLES FROM PUBLIC`,
    `ALTER DEFAULT PRIVILEGES FOR ROLE ${q(owner)} IN SCHEMA ${q(schema)} REVOKE ALL ON SEQUENCES FROM PUBLIC`,
    ...roles.flatMap((role) => [
      `ALTER DEFAULT PRIVILEGES FOR ROLE ${q(owner)} IN SCHEMA ${q(schema)} GRANT ${readonly ? "SELECT" : "SELECT,INSERT,UPDATE,DELETE"} ON TABLES TO ${q(role)}`,
      ...(readonly
        ? []
        : [
            `ALTER DEFAULT PRIVILEGES FOR ROLE ${q(owner)} IN SCHEMA ${q(schema)} GRANT USAGE,SELECT ON SEQUENCES TO ${q(role)}`,
          ]),
    ]),
  ];
}
function schemaPolicy(
  profile: CompiledDatabaseProfile,
  database: string,
  schema: string,
  owner: DatabaseRole,
  consumers: DatabaseRole[],
) {
  const role = profile.roles[owner].name;
  return [
    `CREATE SCHEMA ${q(schema)} AUTHORIZATION ${q(role)}`,
    `REVOKE ALL ON SCHEMA ${q(schema)} FROM PUBLIC`,
    ...consumers.map(
      (consumer) => `GRANT USAGE ON SCHEMA ${q(schema)} TO ${q(profile.roles[consumer].name)}`,
    ),
    ...defaultPolicy(
      role,
      schema,
      consumers
        .filter((item) => item !== "backup" && item !== "reader")
        .map((item) => profile.roles[item].name),
    ),
    ...defaultPolicy(
      role,
      schema,
      consumers
        .filter((item) => item === "backup" || item === "reader")
        .map((item) => profile.roles[item].name),
      true,
    ),
  ].map((sql) => ({ database, sql }));
}
/** No secrets or client SQL. Only compiler-owned identifiers and bounded integer settings. */
export function compileDatabaseBootstrap(profile: CompiledDatabaseProfile): DatabaseStatement[] {
  assertDatabaseProfile(profile);
  const statements: DatabaseStatement[] = [];
  for (const role of DATABASE_ROLES) {
    const account = profile.roles[role];
    statements.push({
      database: "postgres",
      sql: `CREATE ROLE ${q(account.name)} NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS CONNECTION LIMIT ${account.connections}`,
    });
  }
  for (const database of [profile.applicationDatabase, profile.workflowDatabase]) {
    statements.push({
      database: "postgres",
      sql: `CREATE DATABASE ${q(database)} TEMPLATE template0 CONNECTION LIMIT ${profile.limits.maxConnections - 3}`,
    });
    statements.push({
      database: "postgres",
      sql: `REVOKE ALL ON DATABASE ${q(database)} FROM PUBLIC`,
    });
    statements.push({ database, sql: "REVOKE ALL ON SCHEMA public FROM PUBLIC" });
    statements.push({
      database,
      sql: "REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC",
    });
  }
  for (const database of ["postgres", "template1"])
    statements.push({
      database: "postgres",
      sql: `REVOKE ALL ON DATABASE ${q(database)} FROM PUBLIC`,
    });
  for (const role of DATABASE_ROLES) {
    const database = ["workflow", "workflowMigration"].includes(role)
      ? profile.workflowDatabase
      : profile.applicationDatabase;
    const name = q(profile.roles[role].name);
    const search = ["workflow", "workflowMigration"].includes(role)
      ? "workflow"
      : role === "auth"
        ? "auth"
        : role === "reader"
          ? "analysis"
          : "app";
    statements.push({
      database: "postgres",
      sql: `GRANT CONNECT ON DATABASE ${q(database)} TO ${name}`,
    });
    statements.push({
      database: "postgres",
      sql: `ALTER ROLE ${name} IN DATABASE ${q(database)} SET search_path = ${q(search)},pg_catalog`,
    });
    statements.push({
      database: "postgres",
      sql: `ALTER ROLE ${name} SET statement_timeout = '30s'`,
    });
  }
  statements.push(
    ...schemaPolicy(profile, profile.applicationDatabase, "app", "migration", [
      "api",
      "worker",
      "backup",
    ]),
  );
  statements.push(
    ...schemaPolicy(profile, profile.applicationDatabase, "auth", "migration", ["auth", "backup"]),
  );
  statements.push(
    ...schemaPolicy(profile, profile.applicationDatabase, "analysis", "migration", ["reader"]),
  );
  statements.push(
    ...schemaPolicy(profile, profile.workflowDatabase, "workflow", "workflowMigration", [
      "workflow",
      "backup",
    ]),
  );
  // Backup is logical read-only authority only; physical archive/recovery stays unqualified.
  statements.push({
    database: "postgres",
    sql: `GRANT CONNECT ON DATABASE ${q(profile.workflowDatabase)} TO ${q(profile.roles.backup.name)}`,
  });
  return statements;
}
