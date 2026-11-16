import type { DatabaseRole } from "@godseye/contracts";
import type { CompiledDatabaseProfile } from "./database-policy.js";
import {
  bootstrapPostgres,
  type DatabaseMaterial,
  inspectPostgres,
  type PostgresConnectionFactory,
} from "./database-postgres.js";
import { immutableSnapshot } from "./infra-policy.js";
import { fingerprint } from "./journal.js";

export interface DatabaseProviderBinding {
  providerId: string;
  targetId: string;
  version: string;
  generation: string;
}
export interface DatabaseQualification extends DatabaseProviderBinding {
  observedAt: string;
  expiresAt: string;
  independentInstances: true;
  persistentQuota: true;
  privateNetwork: true;
  tlsIdentity: true;
  evidence: string;
}
export interface DatabaseProviderScope {
  allocationId: string;
  projectId: string;
  environmentId: string;
  preparationHash: string;
  generation: number;
  epoch: number;
}
export interface DatabasePhysicalInspection {
  scope: DatabaseProviderScope;
  providerRef: string;
  systemIdentifier: string;
  configurationHash: string;
  running: boolean;
  dataVolume: string;
  walVolume: string;
  independentInstance: boolean;
  quotaEnforced: boolean;
  privateNetwork: boolean;
  policyVerified: boolean;
  evidence: string;
}
/** Private injection only. An owner declaration or a `qualified` boolean confers no authority. */
export interface DatabaseProvider {
  readonly binding: DatabaseProviderBinding;
  qualification(): Promise<DatabaseQualification | null>;
  provision(
    scope: DatabaseProviderScope,
    profile: CompiledDatabaseProfile,
    assertDispatch: () => Promise<void>,
  ): Promise<void>;
  suspend(
    scope: DatabaseProviderScope,
    providerRef: string,
    assertDispatch: () => Promise<void>,
  ): Promise<void>;
  resume(
    scope: DatabaseProviderScope,
    providerRef: string,
    assertDispatch: () => Promise<void>,
  ): Promise<void>;
  inspect(
    scope: DatabaseProviderScope,
    profile: CompiledDatabaseProfile,
    providerRef: string | null,
  ): Promise<DatabasePhysicalInspection | null>;
}
/** Broker slots/references remain metadata; delivery stays inside this private callback. */
export interface DatabaseMaterialDelivery {
  withMaterial(
    scope: DatabaseProviderScope,
    roles: readonly DatabaseRole[],
    consume: (material: DatabaseMaterial) => Promise<void>,
    assertDispatch: () => Promise<void>,
  ): Promise<void>;
}
export interface PostgresInstanceTransport {
  create(scope: DatabaseProviderScope, profile: CompiledDatabaseProfile): Promise<void>;
  start(scope: DatabaseProviderScope, providerRef: string | null): Promise<void>;
  stop(scope: DatabaseProviderScope, providerRef: string): Promise<void>;
  connect(scope: DatabaseProviderScope): Promise<PostgresConnectionFactory>;
  inspect(
    scope: DatabaseProviderScope,
    providerRef: string | null,
  ): Promise<Omit<DatabasePhysicalInspection, "policyVerified"> | null>;
}
/** Concrete policy/bootstrap/catalog adapter reused by the native lab and future isolated transport. */
export class ManagedPostgresProvider implements DatabaseProvider {
  readonly binding: DatabaseProviderBinding;
  private readonly verified = new Map<
    string,
    { systemIdentifier: string; configurationHash: string }
  >();
  constructor(
    binding: DatabaseProviderBinding,
    private readonly transport: PostgresInstanceTransport,
    private readonly material: DatabaseMaterialDelivery,
    private readonly qualify: () => Promise<DatabaseQualification | null>,
  ) {
    this.binding = immutableSnapshot(binding);
  }
  qualification() {
    return this.qualify();
  }
  async provision(
    scope: DatabaseProviderScope,
    profile: CompiledDatabaseProfile,
    assertDispatch: () => Promise<void>,
  ) {
    await assertDispatch();
    await this.transport.create(scope, profile);
    await assertDispatch();
    await this.transport.start(scope, null);
    await assertDispatch();
    const connect = await this.transport.connect(scope);
    await this.material.withMaterial(
      scope,
      ["migration", "api", "worker", "auth", "reader", "backup", "workflow", "workflowMigration"],
      async (values) => {
        await assertDispatch();
        await bootstrapPostgres(profile, connect, values, assertDispatch);
      },
      assertDispatch,
    );
    await assertDispatch();
  }
  async suspend(
    scope: DatabaseProviderScope,
    providerRef: string,
    assertDispatch: () => Promise<void>,
  ) {
    await assertDispatch();
    await this.transport.stop(scope, providerRef);
    await assertDispatch();
  }
  async resume(
    scope: DatabaseProviderScope,
    providerRef: string,
    assertDispatch: () => Promise<void>,
  ) {
    await assertDispatch();
    await this.transport.start(scope, providerRef);
    await assertDispatch();
  }
  async inspect(
    scope: DatabaseProviderScope,
    profile: CompiledDatabaseProfile,
    providerRef: string | null,
  ): Promise<DatabasePhysicalInspection | null> {
    const physical = immutableSnapshot(await this.transport.inspect(scope, providerRef));
    if (!physical) return null;
    let policyVerified = false;
    if (physical.running) {
      const result = await inspectPostgres(profile, await this.transport.connect(scope));
      if (result.systemIdentifier !== physical.systemIdentifier)
        throw new Error("Database physical and catalog identities differ");
      this.verified.set(scope.allocationId, {
        systemIdentifier: result.systemIdentifier,
        configurationHash: profile.configurationHash,
      });
      policyVerified = result.policyVerified;
    } else {
      const prior = this.verified.get(scope.allocationId);
      policyVerified =
        prior?.systemIdentifier === physical.systemIdentifier &&
        prior.configurationHash === profile.configurationHash;
    }
    return { ...physical, policyVerified, evidence: fingerprint({ physical, policyVerified }) };
  }
}
