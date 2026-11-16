import { createHash, randomBytes } from "node:crypto";
import type { DatabaseRole } from "@godseye/contracts";
import type { PostgresConnectionFactory } from "./database-postgres.js";
import type { DatabaseProviderBinding, DatabaseProviderScope } from "./database-provider.js";
import { databaseIdentifier } from "./database-sql.js";
import { immutableSnapshot } from "./infra-policy.js";

export interface DatabaseRotationTarget {
  role: DatabaseRole;
  /** Compiled server-owned PostgreSQL role name; never caller supplied. */
  roleName: string;
}
export interface RotationQualification extends DatabaseProviderBinding {
  observedAt: string;
  expiresAt: string;
  evidence: string;
}
export interface RotationInspection {
  /** `rotated` only when the exact rotation identifier is durably marked on the target role. */
  outcome: "rotated" | "prior" | "unknown";
  /** SHA-256 of the stored password verifier; a public change fingerprint, not a credential. */
  verifier: string | null;
}
/** Private injection only. Responses and errors never contain role material. */
export interface DatabaseRotationProvider {
  readonly binding: DatabaseProviderBinding;
  qualification(): Promise<RotationQualification | null>;
  rotate(
    scope: DatabaseProviderScope,
    target: DatabaseRotationTarget,
    rotationId: string,
    assertDispatch: () => Promise<void>,
  ): Promise<void>;
  inspect(
    scope: DatabaseProviderScope,
    target: DatabaseRotationTarget,
    rotationId: string,
  ): Promise<RotationInspection>;
  /** Idempotent hand-off finalization for the staged replacement material. */
  settle(
    scope: DatabaseProviderScope,
    target: DatabaseRotationTarget,
    rotationId: string,
    outcome: "committed" | "discarded",
  ): Promise<void>;
}
/** Private destination for replacement material, for example a broker slot stage. */
export interface RotationMaterialSink {
  stage(
    scope: DatabaseProviderScope,
    role: DatabaseRole,
    rotationId: string,
    secret: string,
  ): Promise<void>;
  commit(rotationId: string): Promise<void>;
  discard(rotationId: string): Promise<void>;
}
const MARKER = "godseye-rotation:";
const ID = /^[0-9a-f-]{36}$/;
const verifierOf = (value: unknown) =>
  typeof value === "string" && value ? createHash("sha256").update(value).digest("hex") : null;

/**
 * Role-password rotation over the private PostgreSQL connection seam. The password change and the
 * rotation marker commit atomically, so an uncertain acknowledgment is reconciled by reading the marker.
 */
export class PostgresRoleRotationProvider implements DatabaseRotationProvider {
  readonly binding: DatabaseProviderBinding;
  constructor(
    binding: DatabaseProviderBinding,
    private readonly connect: (scope: DatabaseProviderScope) => Promise<PostgresConnectionFactory>,
    private readonly sink: RotationMaterialSink,
    private readonly qualify: () => Promise<RotationQualification | null>,
  ) {
    this.binding = immutableSnapshot(binding);
  }
  qualification() {
    return this.qualify();
  }
  async rotate(
    scope: DatabaseProviderScope,
    target: DatabaseRotationTarget,
    rotationId: string,
    assertDispatch: () => Promise<void>,
  ) {
    if (!ID.test(rotationId)) throw new Error("Invalid rotation identifier");
    const role = databaseIdentifier(target.roleName);
    await assertDispatch();
    let secret = randomBytes(32).toString("base64url");
    try {
      await this.sink.stage(scope, target.role, rotationId, secret);
      await assertDispatch();
      const connection = await (await this.connect(scope))("postgres");
      try {
        await connection.query("BEGIN");
        // Utility DDL has no bind placeholders; the generated alphabet is base64url and quote-free.
        await connection.query(`ALTER ROLE ${role} PASSWORD '${secret}'`);
        await connection.query(`COMMENT ON ROLE ${role} IS '${MARKER}${rotationId}'`);
        await connection.query("COMMIT");
      } catch (error) {
        await connection.query("ROLLBACK").catch(() => undefined);
        throw error;
      } finally {
        await connection.end();
      }
    } finally {
      secret = "";
    }
  }
  async inspect(scope: DatabaseProviderScope, target: DatabaseRotationTarget, rotationId: string) {
    const connection = await (await this.connect(scope))("postgres");
    try {
      const result = await connection.query(
        "SELECT shobj_description(a.oid, 'pg_authid') AS marker, a.rolpassword AS verifier FROM pg_authid a WHERE a.rolname = $1",
        [target.roleName],
      );
      const row = result.rows[0];
      if (!row) return { outcome: "unknown" as const, verifier: null };
      return {
        outcome:
          row.marker === `${MARKER}${rotationId}` ? ("rotated" as const) : ("prior" as const),
        verifier: verifierOf(row.verifier),
      };
    } finally {
      await connection.end();
    }
  }
  async settle(
    _scope: DatabaseProviderScope,
    _target: DatabaseRotationTarget,
    rotationId: string,
    outcome: "committed" | "discarded",
  ) {
    if (outcome === "committed") await this.sink.commit(rotationId);
    else await this.sink.discard(rotationId);
  }
}
