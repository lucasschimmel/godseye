import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { DATABASE_ROLES } from "@godseye/contracts";
import {
  type CellHostConfigInput,
  cellLayout,
  parseCellHost,
  parseEnv,
  readCellFile,
} from "../../../packages/core/src/cell-host.js";
import {
  type CompiledDatabaseProfile,
  compileDatabaseProfile,
} from "../../../packages/core/src/database-policy.js";
import type { DatabaseMaterial } from "../../../packages/core/src/database-postgres.js";
import { postgresConnectionFactory } from "../../../packages/core/src/database-postgres.js";
import { ManagedPostgresProvider } from "../../../packages/core/src/database-provider.js";
import {
  hostQualification,
  ServerPostgresTransport,
} from "../../../packages/core/src/database-server-transport.js";
import {
  compilePgBackRest,
  pgBackRestArguments,
} from "../../../packages/core/src/recovery-pgbackrest-policy.js";
import { ServerPgBackRestTransport } from "../../../packages/core/src/recovery-server-transport.js";
import { HelperSocketExecutor, UnixSocketHelperTransport } from "./cell-host-process.js";
import { FileDatabaseMaterial, repositoryPassphrase } from "./cell-providers.js";

/**
 * Operator harness that drives the REAL cell transports against the live helper: provisions
 * disposable cells and proves quota enforcement, role separation, cross-cell denial and restart
 * persistence. It prints sanitized JSON only (no passwords, no passphrases). Runs as the `godseye`
 * user; state lives in a private directory. Subcommands:
 *   up <label> <dataGiB> | down <label> | inspect <label>
 *   verify <labelA> <labelB> | seed <label> | digest <label>
 *   pgbackrest <label> <stanza-create|check|full|diff|info>
 */
const STATE = process.env.GODSEYE_CELLS_PROOF_DIR ?? "/var/lib/godseye/cells-proof";
const HOST_FILE = process.env.GODSEYE_CELL_HOST_FILE ?? "/etc/godseye/pg/host.json";
const CA_FILE = process.env.GODSEYE_CELLS_CA_FILE ?? "/etc/godseye/pg/cells-ca.crt";
const SECRETS = join(STATE, "secrets");
const FILL_BATCH_ROWS = 120_000;
const FILL_BATCH_LIMIT = 80;
const PROFILE = {
  engine: "postgresql",
  majorVersion: 18,
  cpuMilliCores: 500,
  memoryMiB: 512,
  walGiB: 1,
  temporaryMiB: 32,
  maxConnections: 32,
} as const;
interface CellState {
  label: string;
  scope: {
    allocationId: string;
    projectId: string;
    environmentId: string;
    preparationHash: string;
    generation: number;
    epoch: number;
  };
  profile: CompiledDatabaseProfile;
  port: number;
}
const host = parseCellHost(JSON.parse(await readFile(HOST_FILE, "utf8")) as CellHostConfigInput);
const executor = new HelperSocketExecutor(new UnixSocketHelperTransport(host.helperSocket));
const binding = {
  providerId: "cells-proof",
  targetId: randomUUID(),
  version: "postgresql-18/pgbackrest-2.60",
  generation: "proof",
};
const transport = new ServerPostgresTransport({
  host,
  executor,
  archiveCipher: (scope) => repositoryPassphrase(SECRETS, scope.allocationId),
});
const provider = new ManagedPostgresProvider(
  binding,
  transport,
  new FileDatabaseMaterial(SECRETS),
  hostQualification(host, executor, binding),
);
const statePath = (label: string) => join(STATE, `${label}.json`);
const load = async (label: string) =>
  JSON.parse(await readFile(statePath(label), "utf8")) as CellState;
const log = (event: string, detail: Record<string, unknown> = {}) =>
  console.log(JSON.stringify({ event, ...detail }));
const noop = async () => undefined;

async function material(state: CellState) {
  return JSON.parse(
    await readFile(join(SECRETS, state.scope.allocationId, "roles.json"), "utf8"),
  ) as DatabaseMaterial;
}
async function connection(
  state: CellState,
  role: (typeof DATABASE_ROLES)[number],
  port = state.port,
) {
  const values = await material(state);
  return postgresConnectionFactory({
    host: host.bindAddress,
    port,
    user: state.profile.roles[role].name,
    password: values[role],
    ca: await readFile(CA_FILE, "utf8"),
    servername: host.servername,
  });
}
/** Runs one statement and reports the PostgreSQL error code instead of throwing. */
async function attempt(
  factory: ReturnType<typeof postgresConnectionFactory>,
  database: string,
  sql: string,
) {
  let client: Awaited<ReturnType<typeof factory>> | undefined;
  try {
    client = await factory(database);
    await client.query(sql);
    return { ok: true as const };
  } catch (error) {
    const code = (error as { code?: string }).code ?? "connect";
    const message = error instanceof Error ? error.message.replace(/"[^"]*"/g, '"…"') : "error";
    return { ok: false as const, code, message: message.slice(0, 120) };
  } finally {
    await client?.end().catch(() => undefined);
  }
}
async function query<T>(
  factory: ReturnType<typeof postgresConnectionFactory>,
  database: string,
  sql: string,
) {
  const client = await factory(database);
  try {
    return (await client.query(sql)).rows as T[];
  } finally {
    await client.end();
  }
}

async function up(label: string, dataGiB: number) {
  const allocationId = randomUUID();
  const scope = {
    allocationId,
    projectId: randomUUID(),
    environmentId: randomUUID(),
    preparationHash: "proof",
    generation: 1,
    epoch: 1,
  };
  const profile = compileDatabaseProfile(
    { ...PROFILE, dataGiB },
    { allocationId, projectId: scope.projectId, environmentId: scope.environmentId },
  );
  await provider.provision(scope, profile, noop);
  const port = Number(parseEnv(await readCellFile(executor, allocationId, "cell-env")).PORT);
  await writeFile(statePath(label), JSON.stringify({ label, scope, profile, port }), {
    mode: 0o600,
  });
  log("up", { label, allocationId, port, quotas: profile.storage });
}
async function down(label: string) {
  const state = await load(label);
  await transport.stop(state.scope, cellLayout(host, state.scope.allocationId).unit);
  await executor.call("destroy", [state.scope.allocationId]);
  log("down", { label, allocationId: state.scope.allocationId });
}
async function inspect(label: string) {
  const state = await load(label);
  const result = await provider.inspect(state.scope, state.profile, null);
  log("inspect", {
    label,
    running: result?.running,
    quotaEnforced: result?.quotaEnforced,
    independentInstance: result?.independentInstance,
    privateNetwork: result?.privateNetwork,
    policyVerified: result?.policyVerified,
  });
}
async function storage(state: CellState) {
  const out = await executor.call("storage-inspect", [state.scope.allocationId]);
  return out
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [name = "", , hard = "", used = ""] = line.split("\t");
      return {
        volume: name.replace(/-[0-9a-f]{32}$/, ""),
        hardBytes: Number(hard),
        usedBytes: Number(used),
      };
    });
}
async function verify(labelA: string, labelB: string) {
  const [a, b] = [await load(labelA), await load(labelB)];
  const dbA = a.profile.applicationDatabase;
  const dbB = b.profile.applicationDatabase;
  const migrationA = await connection(a, "migration");
  const migrationB = await connection(b, "migration");
  await attempt(migrationA, dbA, "DROP TABLE IF EXISTS proof_t, proof_fill");
  await attempt(migrationB, dbB, "DROP TABLE IF EXISTS proof_t, proof_fill");
  const created = await attempt(
    migrationA,
    dbA,
    "CREATE TABLE proof_t (id int primary key, note text)",
  );
  log("role.migration-ddl", { ok: created.ok });
  for (const role of ["api", "worker"] as const) {
    const ddl = await attempt(await connection(a, role), dbA, "CREATE TABLE denied_ddl (id int)");
    const alter = await attempt(
      await connection(a, role),
      dbA,
      "ALTER TABLE proof_t ADD COLUMN x int",
    );
    const dml = await attempt(
      await connection(a, role),
      dbA,
      "INSERT INTO proof_t VALUES (1, 'dml')",
    );
    log("role.separation", {
      role,
      ddlDenied: !ddl.ok && ddl.code === "42501",
      alterDenied: !alter.ok,
      dmlAllowed: dml.ok,
      ddlCode: ddl.ok ? null : ddl.code,
    });
  }
  // Cross-cell denial: credentials of one cell must never open the other cell.
  const foreignApiOnB = await attempt(await connection(a, "api", b.port), dbB, "SELECT 1");
  const ownApiOnB = await attempt(await connection(a, "api", b.port), dbA, "SELECT 1");
  const foreignMigrationOnA = await attempt(
    await connection(b, "migration", a.port),
    dbA,
    "SELECT 1",
  );
  log("cross-cell", {
    aCredentialsOnBWithBDatabase: foreignApiOnB.ok ? "ALLOWED" : "denied",
    aCredentialsOnBWithADatabase: ownApiOnB.ok ? "ALLOWED" : "denied",
    bMigrationOnA: foreignMigrationOnA.ok ? "ALLOWED" : "denied",
  });
  // Quota: fill cell A past its hard data limit; cell B must stay healthy.
  await attempt(migrationA, dbA, "CREATE TABLE proof_fill (id bigserial, pad text)");
  const before = await storage(a);
  let failure: { code: string; message: string } | null = null;
  let batches = 0;
  for (; batches < FILL_BATCH_LIMIT && !failure; batches++) {
    const step = await attempt(
      migrationA,
      dbA,
      `INSERT INTO proof_fill (pad) SELECT repeat('x', 1000) FROM generate_series(1, ${FILL_BATCH_ROWS})`,
    );
    if (!step.ok) failure = step;
  }
  const after = await storage(a);
  const dataBefore = before.find((v) => v.volume === "pgdata");
  const dataAfter = after.find((v) => v.volume === "pgdata");
  const inB = await attempt(
    migrationB,
    dbB,
    "CREATE TABLE proof_t (id int primary key, note text)",
  );
  const writeB = await attempt(
    migrationB,
    dbB,
    "INSERT INTO proof_t VALUES (1, 'b-still-writable')",
  );
  log("quota.fill", {
    batches,
    failedWith: failure,
    hardBytes: dataAfter?.hardBytes,
    usedBytesBefore: dataBefore?.usedBytes,
    usedBytesAfter: dataAfter?.usedBytes,
    cellBWritable: inB.ok && writeB.ok,
    cellAStillAnswers: (await attempt(migrationA, dbA, "SELECT 1")).ok,
  });
  const cleaned = await attempt(migrationA, dbA, "TRUNCATE proof_fill");
  log("quota.recover", {
    truncateOk: cleaned.ok,
    afterTruncateUsedBytes: (await storage(a)).find((v) => v.volume === "pgdata")?.usedBytes,
  });
}
async function restart(label: string) {
  const state = await load(label);
  const db = state.profile.applicationDatabase;
  const factory = await connection(state, "migration");
  await attempt(
    factory,
    db,
    "CREATE TABLE IF NOT EXISTS persist_t (id int primary key, note text)",
  );
  await attempt(
    factory,
    db,
    "INSERT INTO persist_t VALUES (1, 'before-restart') ON CONFLICT DO NOTHING",
  );
  const unit = cellLayout(host, state.scope.allocationId).unit;
  await transport.stop(state.scope, unit);
  const stopped = (await executor.call("unit", [state.scope.allocationId, "state"])).trim();
  await transport.start(state.scope, unit);
  const rows = await query<{ note: string }>(
    await connection(state, "migration"),
    db,
    "SELECT note FROM persist_t WHERE id = 1",
  );
  log("restart", { label, stateWhileStopped: stopped, rowAfterRestart: rows[0]?.note ?? null });
}
async function seed(label: string) {
  const state = await load(label);
  const db = state.profile.applicationDatabase;
  const factory = await connection(state, "migration");
  await attempt(factory, db, "DROP TABLE IF EXISTS drill_records");
  await attempt(
    factory,
    db,
    "CREATE TABLE drill_records (id int primary key, marker text NOT NULL, payload text NOT NULL)",
  );
  await attempt(
    factory,
    db,
    "INSERT INTO drill_records SELECT g, 'DRILL_ROW_' || g, md5(g::text) FROM generate_series(1, 5000) g",
  );
  await digest(label);
}
async function digest(label: string) {
  const state = await load(label);
  const rows = await query<{ n: string; d: string }>(
    await connection(state, "migration"),
    state.profile.applicationDatabase,
    "SELECT count(*)::text AS n, md5(string_agg(id || marker || payload, ',' ORDER BY id)) AS d FROM drill_records",
  );
  log("digest", {
    label,
    rows: rows[0]?.n,
    md5: rows[0]?.d,
    database: state.profile.applicationDatabase,
  });
}
async function pgbackrest(label: string, operation: string) {
  const state = await load(label);
  const backup = new ServerPgBackRestTransport(host, executor);
  const bound = await backup.binding({
    projectId: state.scope.projectId,
    sourceAllocationId: state.scope.allocationId,
    repositoryId: state.scope.allocationId,
  } as never);
  const policy = compilePgBackRest(bound);
  const operations = ["stanza-create", "check", "full", "diff", "info"] as const;
  const op = operations.find((o) => o === operation);
  if (!op) throw new Error("Unsupported operation");
  const started = Date.now();
  const output = await executor.call("pgbackrest", [
    state.scope.allocationId,
    ...pgBackRestArguments(policy, op),
  ]);
  if (op === "info") {
    const info = JSON.parse(output) as {
      name: string;
      backup: {
        label: string;
        type: string;
        timestamp: { start: number; stop: number };
        database: { id: number };
        archive: { start: string; stop: string };
        info: { size: number; repository: { size: number } };
      }[];
      archive: { min: string; max: string }[];
      cipher: string;
      status: { message: string };
    }[];
    log("pgbackrest.info", {
      label,
      stanza: info[0]?.name,
      status: info[0]?.status.message,
      cipher: info[0]?.cipher,
      backups: info[0]?.backup.map((x) => ({
        label: x.label,
        type: x.type,
        start: x.timestamp.start,
        stop: x.timestamp.stop,
        archiveStart: x.archive.start,
        archiveStop: x.archive.stop,
        repoBytes: x.info.repository.size,
      })),
      archive: info[0]?.archive[0],
    });
  } else
    log("pgbackrest", {
      label,
      operation: op,
      ok: true,
      seconds: Math.round((Date.now() - started) / 1000),
    });
}
async function main() {
  await mkdir(SECRETS, { recursive: true, mode: 0o700 });
  const [command = "", a = "", b = ""] = process.argv.slice(2);
  if (command === "up") return up(a, Number(b || "1"));
  if (command === "down") return down(a);
  if (command === "inspect") return inspect(a);
  if (command === "verify") return verify(a, b);
  if (command === "restart") return restart(a);
  if (command === "seed") return seed(a);
  if (command === "digest") return digest(a);
  if (command === "pgbackrest") return pgbackrest(a, b);
  throw new Error("Unknown command");
}
await main();
