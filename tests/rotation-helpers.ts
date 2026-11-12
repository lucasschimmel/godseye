import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { DATABASE_ROLES, type DatabaseRole } from "@godseye/contracts";
import {
  type DatabaseProviderScope,
  type IncidentNotifier,
  InfrastructureEngine,
  PostgresRoleRotationProvider,
  type RotationMaterialSink,
} from "@godseye/core";
import { schema } from "@godseye/store";
import { eq } from "drizzle-orm";
import type { PostgresConnectionFactory } from "../packages/core/src/database-postgres.js";
import { compiledDatabase, databasePreparationFor } from "../packages/core/src/database-state.js";
import { type DatabaseFixture, databaseFixture } from "./pg-helpers.js";

/** Test-only sink: captures staged secrets so tests can prove they never leave the private seam. */
export class CapturingSink implements RotationMaterialSink {
  readonly staged = new Map<string, string>();
  readonly committed: string[] = [];
  readonly discarded: string[] = [];
  failCommit = false;
  async stage(_scope: DatabaseProviderScope, _role: DatabaseRole, id: string, secret: string) {
    this.staged.set(id, secret);
  }
  async commit(id: string) {
    if (this.failCommit) throw new Error("sink unavailable");
    this.committed.push(id);
  }
  async discard(id: string) {
    this.discarded.push(id);
  }
}
/** An in-process PostgreSQL (PGlite) standing in for the cell cluster, with injectable faults. */
export class RotationCluster {
  readonly db = new PGlite();
  failOn: "alter" | "inspect" | null = null;
  loseCommitAck = false;
  qualificationDown = false;
  factory: PostgresConnectionFactory = async () => ({
    query: async (sql, values) => {
      if (this.failOn === "alter" && sql.startsWith("ALTER ROLE")) throw new Error("injected");
      if (this.failOn === "inspect" && sql.startsWith("SELECT shobj")) throw new Error("injected");
      const result = await this.db.query(sql, values);
      if (this.loseCommitAck && sql === "COMMIT") throw new Error("lost acknowledgment");
      return { rows: result.rows as Record<string, unknown>[] };
    },
    end: async () => undefined,
  });
  async verifier(roleName: string) {
    const result = await this.db.query<{ v: string | null }>(
      "SELECT rolpassword AS v FROM pg_authid WHERE rolname = $1",
      [roleName],
    );
    return result.rows[0]?.v ?? null;
  }
  async createRoles(names: string[]) {
    for (const name of names) await this.db.exec(`CREATE ROLE "${name}" LOGIN PASSWORD 'initial'`);
  }
}
export class NotifierFixture implements IncidentNotifier {
  readonly sent: string[] = [];
  fail = false;
  async notify(incident: { id: string }) {
    if (this.fail) throw new Error("notifier down");
    this.sent.push(incident.id);
  }
}
export async function rotationFixture(
  options: { rotation?: boolean; notifier?: NotifierFixture } = {},
) {
  const base: DatabaseFixture = await databaseFixture();
  try {
    const { allocation } = await base.admit();
    await base.infrastructure.foundation.tick("rotation-source-database-worker");
    const [row] = await base.store.db
      .select()
      .from(schema.databaseAllocations)
      .where(eq(schema.databaseAllocations.id, allocation.id));
    if (row?.state !== "ready") throw new Error("Rotation fixture allocation is not ready");
    const catalog = compiledDatabase(
      await databasePreparationFor(base.store.db, row.preparationId),
    );
    const roleNames = Object.fromEntries(
      DATABASE_ROLES.map((role) => [role, catalog.roles[role].name]),
    ) as Record<DatabaseRole, string>;
    const cluster = new RotationCluster();
    await cluster.createRoles(Object.values(roleNames));
    const sink = new CapturingSink();
    const targetId = randomUUID();
    const provider = new PostgresRoleRotationProvider(
      {
        providerId: "rotation-pglite-fixture",
        targetId,
        version: "fixture-v1",
        generation: "rotation-generation-1",
      },
      async () => cluster.factory,
      sink,
      async () =>
        cluster.qualificationDown
          ? null
          : {
              providerId: "rotation-pglite-fixture",
              targetId,
              version: "fixture-v1",
              generation: "rotation-generation-1",
              observedAt: base.clock.now().toISOString(),
              expiresAt: new Date(base.clock.now().getTime() + 300_000).toISOString(),
              evidence: "synthetic-pglite-rotation-qualification",
            },
    );
    const infrastructure = new InfrastructureEngine(base.store, {
      ...base.configuration,
      rotationProvider: options.rotation === false ? undefined : provider,
      incidentNotifier: options.notifier,
    });
    return { ...base, infrastructure, allocation: row, roleNames, cluster, sink, provider };
  } catch (error) {
    await base.store.close();
    throw error;
  }
}
export type RotationFixture = Awaited<ReturnType<typeof rotationFixture>>;
