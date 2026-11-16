import { DATABASE_ROLES } from "@godseye/contracts";
import type { CompiledDatabaseProfile } from "./database-policy.js";
import type { PostgresConnection } from "./database-postgres.js";

const dataPrivileges = ["SELECT", "INSERT", "UPDATE", "DELETE"];
function consumers(schema: string, type: string): Record<string, string[]> {
  const readers: Record<string, string[]> = type === "r" ? { backup: ["SELECT"] } : {};
  const writable = type === "r" ? dataPrivileges : type === "S" ? ["USAGE", "SELECT"] : [];
  if (schema === "app") return { ...readers, api: writable, worker: writable };
  if (schema === "auth") return { ...readers, auth: writable };
  if (schema === "workflow") return { ...readers, workflow: writable };
  if (schema === "analysis") return { reader: type === "r" ? ["SELECT"] : [] };
  return {};
}
function ownerFor(profile: CompiledDatabaseProfile, schema: string) {
  return profile.roles[schema === "workflow" ? "workflowMigration" : "migration"].name;
}
function assertAcl(profile: CompiledDatabaseProfile, row: Record<string, unknown>) {
  const owner = String(row.owner),
    schema = String(row.schema),
    type = String(row.type);
  if (
    !["app", "auth", "analysis", "workflow"].includes(schema) ||
    owner !== ownerFor(profile, schema)
  )
    throw new Error("Database object ownership differs from policy");
  if (row.grantee === owner && !row.is_grantable) return;
  if (row.grantee === owner) return; // An object's owner intrinsically retains its own grant authority.
  const role = DATABASE_ROLES.find((key) => profile.roles[key].name === row.grantee);
  if (
    !role ||
    row.is_grantable ||
    !(consumers(schema, type)[role] ?? []).includes(String(row.privilege_type))
  )
    throw new Error("Database object/default ACL exceeds scoped service authority");
}
async function inspectObjects(profile: CompiledDatabaseProfile, connection: PostgresConnection) {
  const relations =
    await connection.query(`SELECT n.nspname AS schema,c.relname,c.relkind,CASE WHEN c.relkind='S' THEN 'S' ELSE 'r' END AS type,o.rolname AS owner,g.rolname AS grantee,a.privilege_type,a.is_grantable
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_roles o ON o.oid=c.relowner
    CROSS JOIN LATERAL aclexplode(coalesce(c.relacl,acldefault(CASE WHEN c.relkind='S' THEN 's'::"char" ELSE 'r'::"char" END,c.relowner))) a LEFT JOIN pg_roles g ON g.oid=a.grantee
    WHERE n.nspname !~ '^pg_' AND n.nspname<>'information_schema' AND c.relkind IN('r','p','v','m','S','f')`);
  for (const row of relations.rows) assertAcl(profile, row);
  const columns =
    await connection.query(`SELECT n.nspname AS schema,'r' AS type,o.rolname AS owner,g.rolname AS grantee,a.privilege_type,a.is_grantable
    FROM pg_attribute at JOIN pg_class c ON c.oid=at.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_roles o ON o.oid=c.relowner
    CROSS JOIN LATERAL aclexplode(at.attacl) a LEFT JOIN pg_roles g ON g.oid=a.grantee
    WHERE n.nspname !~ '^pg_' AND n.nspname<>'information_schema' AND at.attnum>0 AND NOT at.attisdropped`);
  for (const row of columns.rows) assertAcl(profile, row);
  const functions =
    await connection.query(`SELECT n.nspname AS schema,'f' AS type,o.rolname AS owner,g.rolname AS grantee,a.privilege_type,a.is_grantable
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace JOIN pg_roles o ON o.oid=p.proowner
    CROSS JOIN LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a LEFT JOIN pg_roles g ON g.oid=a.grantee WHERE n.nspname !~ '^pg_' AND n.nspname<>'information_schema'`);
  for (const row of functions.rows) assertAcl(profile, row);
  const types =
    await connection.query(`SELECT n.nspname AS schema,'T' AS type,o.rolname AS owner,g.rolname AS grantee,a.privilege_type,a.is_grantable
    FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace JOIN pg_roles o ON o.oid=t.typowner
    CROSS JOIN LATERAL aclexplode(coalesce(t.typacl,acldefault('T',t.typowner))) a LEFT JOIN pg_roles g ON g.oid=a.grantee
    WHERE n.nspname !~ '^pg_' AND n.nspname<>'information_schema' AND t.typtype IN('d','e','r','m') AND t.typelem=0`);
  for (const row of types.rows) assertAcl(profile, row);
}
async function inspectDefaults(
  profile: CompiledDatabaseProfile,
  connection: PostgresConnection,
  schemas: string[],
) {
  const defaults = await connection.query(
    `SELECT coalesce(n.nspname,'') AS schema,d.defaclobjtype AS type,o.rolname AS owner,g.rolname AS grantee,a.privilege_type,a.is_grantable
    FROM pg_default_acl d JOIN pg_roles o ON o.oid=d.defaclrole LEFT JOIN pg_namespace n ON n.oid=d.defaclnamespace
    CROSS JOIN LATERAL aclexplode(d.defaclacl) a LEFT JOIN pg_roles g ON g.oid=a.grantee WHERE o.rolname=ANY($1)`,
    [DATABASE_ROLES.map((role) => profile.roles[role].name)],
  );
  for (const row of defaults.rows) {
    if (row.schema === "") {
      if (
        row.grantee !== row.owner ||
        ![profile.roles.migration.name, profile.roles.workflowMigration.name].includes(
          String(row.owner),
        )
      )
        throw new Error("Global default privileges exceed migration authority");
    } else assertAcl(profile, row);
  }
  for (const schema of schemas)
    for (const type of ["r", "S"]) {
      for (const [role, privileges] of Object.entries(consumers(schema, type)))
        for (const privilege of privileges) {
          const grantee = profile.roles[role as keyof typeof profile.roles].name;
          if (
            !defaults.rows.some(
              (row) =>
                row.schema === schema &&
                row.owner === ownerFor(profile, schema) &&
                row.type === type &&
                row.grantee === grantee &&
                row.privilege_type === privilege,
            )
          )
            throw new Error("Required per-service default privileges are missing");
        }
    }
}
/** Includes existing objects and every creating owner's global AND schema-scoped future grants. */
export async function inspectDatabaseAcls(
  profile: CompiledDatabaseProfile,
  connection: PostgresConnection,
  schemas: string[],
) {
  await inspectObjects(profile, connection);
  await inspectDefaults(profile, connection, schemas);
  const ownership = await connection.query(
    "SELECT n.nspname,r.rolname FROM pg_namespace n JOIN pg_roles r ON r.oid=n.nspowner WHERE n.nspname=ANY($1)",
    [schemas],
  );
  if (
    ownership.rows.length !== schemas.length ||
    ownership.rows.some((row) => row.rolname !== ownerFor(profile, String(row.nspname)))
  )
    throw new Error("Database schema ownership differs");
}
