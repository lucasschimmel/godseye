import { DATABASE_ROLES } from "@godseye/contracts";
import { inspectDatabaseAcls } from "./database-acl-inspection.js";
import { assertDatabaseHba } from "./database-hba-inspection.js";
import {
  assertDatabaseProfile,
  type CompiledDatabaseProfile,
  renderDatabaseSettings,
} from "./database-policy.js";
import type { PostgresConnectionFactory } from "./database-postgres.js";
import { fingerprint } from "./journal.js";

export interface PostgresInspection {
  systemIdentifier: string;
  dataDirectory: string;
  majorVersion: number;
  policyVerified: boolean;
  evidence: string;
}
async function inspectSettings(
  profile: CompiledDatabaseProfile,
  connect: PostgresConnectionFactory,
) {
  const admin = await connect("postgres");
  try {
    const unexpected = await admin.query(
      "SELECT rolname FROM pg_roles WHERE rolcanlogin AND rolname<>current_user AND NOT(rolname=ANY($1))",
      [DATABASE_ROLES.map((role) => profile.roles[role].name)],
    );
    if (unexpected.rows.length)
      throw new Error("Unexpected login identity exists in isolated cluster");
    const identity = await admin.query("SELECT system_identifier::text FROM pg_control_system()");
    const settings = await admin.query("SELECT name,setting,unit FROM pg_settings");
    const actual = new Map(settings.rows.map((row) => [String(row.name), row]));
    for (const [key, value] of Object.entries(renderDatabaseSettings(profile))) {
      const row = actual.get(key);
      if (!row) throw new Error("Required PostgreSQL setting missing");
      const match = /^(\d+)MB$/.exec(value);
      const matches = match
        ? Number(row.setting) *
            (row.unit === "8kB" ? 8 : row.unit === "kB" ? 1 : row.unit === "MB" ? 1024 : 0) ===
          Number(match[1]) * 1024
        : String(row.setting) === value;
      if (!matches) throw new Error("Effective PostgreSQL settings differ from policy");
    }
    const version = Math.floor(Number(actual.get("server_version_num")?.setting) / 10000);
    if (version !== profile.limits.majorVersion)
      throw new Error("PostgreSQL major version differs");
    const hba = await admin.query(
      "SELECT type,database,user_name,address,netmask,auth_method,error FROM pg_hba_file_rules ORDER BY rule_number",
    );
    assertDatabaseHba(profile, hba.rows);
    if (
      hba.rows.some(
        (row) =>
          row.error ||
          (row.auth_method !== "reject" && !["local", "hostssl"].includes(String(row.type))) ||
          (row.auth_method !== "reject" && row.auth_method !== "scram-sha-256"),
      )
    )
      throw new Error("PostgreSQL HBA permits insecure transport");
    const tcp = hba.rows.filter((row) => row.type === "host" && row.auth_method === "reject");
    if (!tcp.some((row) => row.address === "0.0.0.0") || !tcp.some((row) => row.address === "::"))
      throw new Error("PostgreSQL HBA reject fallback missing");
    return {
      systemIdentifier: String(identity.rows[0]?.system_identifier),
      dataDirectory: String(actual.get("data_directory")?.setting),
      majorVersion: version,
    };
  } finally {
    await admin.end();
  }
}
async function inspectRoles(profile: CompiledDatabaseProfile, connect: PostgresConnectionFactory) {
  const admin = await connect("postgres");
  try {
    const roles = await admin.query(
      "SELECT rolname,rolsuper,rolcreatedb,rolcreaterole,rolinherit,rolreplication,rolbypassrls,rolconnlimit,rolcanlogin,rolpassword LIKE 'SCRAM-SHA-256$%' AS scram FROM pg_authid WHERE rolname = ANY($1)",
      [DATABASE_ROLES.map((role) => profile.roles[role].name)],
    );
    if (roles.rows.length !== DATABASE_ROLES.length)
      throw new Error("Required database roles missing");
    for (const role of DATABASE_ROLES) {
      const row = roles.rows.find((entry) => entry.rolname === profile.roles[role].name);
      if (
        !row ||
        [
          "rolsuper",
          "rolcreatedb",
          "rolcreaterole",
          "rolinherit",
          "rolreplication",
          "rolbypassrls",
        ].some((key) => row[key]) ||
        !row.rolcanlogin ||
        !row.scram ||
        row.rolconnlimit !== profile.roles[role].connections
      )
        throw new Error("Database role authority differs from policy");
    }
    const memberships = await admin.query(
      "SELECT 1 FROM pg_auth_members m JOIN pg_roles r ON r.oid=m.member WHERE r.rolname=ANY($1)",
      [DATABASE_ROLES.map((role) => profile.roles[role].name)],
    );
    if (memberships.rows.length) throw new Error("Database runtime role inherited authority");
    for (const role of DATABASE_ROLES) {
      const db = ["workflow", "workflowMigration"].includes(role)
        ? profile.workflowDatabase
        : profile.applicationDatabase;
      for (const database of [
        profile.applicationDatabase,
        profile.workflowDatabase,
        "postgres",
        "template1",
      ]) {
        const access = await admin.query(
          "SELECT has_database_privilege($1,$2,'CONNECT') AS connect,has_database_privilege($1,$2,'CREATE') AS create,has_database_privilege($1,$2,'TEMP') AS temp",
          [profile.roles[role].name, database],
        );
        const expected =
          database === db || (role === "backup" && database === profile.workflowDatabase);
        if (access.rows[0]?.connect !== expected || access.rows[0]?.create || access.rows[0]?.temp)
          throw new Error("Database connection privileges differ");
      }
    }
  } finally {
    await admin.end();
  }
}
async function inspectSchemas(
  profile: CompiledDatabaseProfile,
  connect: PostgresConnectionFactory,
) {
  for (const database of [profile.applicationDatabase, profile.workflowDatabase]) {
    const connection = await connect(database);
    try {
      const schemas =
        database === profile.applicationDatabase ? ["app", "auth", "analysis"] : ["workflow"];
      for (const schema of ["public", ...schemas])
        for (const role of DATABASE_ROLES) {
          const row = await connection.query(
            "SELECT has_schema_privilege($1,$2,'USAGE') AS usage,has_schema_privilege($1,$2,'CREATE') AS create",
            [profile.roles[role].name, schema],
          );
          const owner =
            schema === "workflow"
              ? role === "workflowMigration"
              : schema !== "public" && role === "migration";
          const usage =
            owner ||
            (schema === "app" && ["api", "worker", "backup"].includes(role)) ||
            (schema === "auth" && ["auth", "backup"].includes(role)) ||
            (schema === "analysis" && role === "reader") ||
            (schema === "workflow" && ["workflow", "backup"].includes(role));
          if (row.rows[0]?.usage !== usage || row.rows[0]?.create !== owner)
            throw new Error("Database schema privileges differ");
        }
      const publicAcl = await connection.query(
        "SELECT 1 FROM pg_namespace n CROSS JOIN LATERAL aclexplode(coalesce(n.nspacl,acldefault('n',n.nspowner))) a WHERE n.nspname=ANY($1) AND a.grantee=0",
        [["public", ...schemas]],
      );
      if (publicAcl.rows.length) throw new Error("PUBLIC retains schema privileges");
      const owner =
        profile.roles[database === profile.applicationDatabase ? "migration" : "workflowMigration"]
          .name;
      const defaults = await connection.query(
        "SELECT d.defaclobjtype,a.grantee,a.privilege_type FROM pg_default_acl d JOIN pg_roles r ON r.oid=d.defaclrole CROSS JOIN LATERAL aclexplode(d.defaclacl) a WHERE r.rolname=$1 AND d.defaclnamespace=0",
        [owner],
      );
      for (const type of ["f", "T"]) {
        if (
          !defaults.rows.some((row) => row.defaclobjtype === type) ||
          defaults.rows.some((row) => row.defaclobjtype === type && row.grantee === 0)
        )
          throw new Error("PUBLIC default function or type authority remains");
      }
      const owners = await connection.query(
        "SELECT 1 FROM pg_class c JOIN pg_roles r ON r.oid=c.relowner WHERE r.rolname=ANY($1)",
        [
          DATABASE_ROLES.filter((role) => !["migration", "workflowMigration"].includes(role)).map(
            (role) => profile.roles[role].name,
          ),
        ],
      );
      if (owners.rows.length) throw new Error("Runtime identity owns database objects");
      await inspectDatabaseAcls(profile, connection, schemas);
    } finally {
      await connection.end();
    }
  }
}
/** Actual catalog inspection, not provider labels or acknowledgement. Internal paths stay private. */
export async function inspectPostgres(
  profile: CompiledDatabaseProfile,
  connect: PostgresConnectionFactory,
): Promise<PostgresInspection> {
  assertDatabaseProfile(profile);
  try {
    const identity = await inspectSettings(profile, connect);
    await inspectRoles(profile, connect);
    await inspectSchemas(profile, connect);
    if (!/^\d+$/.test(identity.systemIdentifier) || !identity.dataDirectory)
      throw new Error("Database system identity missing");
    return {
      ...identity,
      policyVerified: true,
      evidence: fingerprint({ ...identity, configurationHash: profile.configurationHash }),
    };
  } catch {
    throw new Error("Effective PostgreSQL policy inspection failed");
  }
}
