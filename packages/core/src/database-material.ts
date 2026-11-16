import { DATABASE_ROLES, type DatabaseRole, type ExecutionContext } from "@godseye/contracts";
import type { AccessBroker } from "./access.js";
import type { DatabaseMaterial } from "./database-postgres.js";
import type { DatabaseMaterialDelivery, DatabaseProviderScope } from "./database-provider.js";
import { DomainError } from "./errors.js";
import { immutableSnapshot } from "./infra-policy.js";

export interface DatabaseBrokerReferences {
  context: ExecutionContext;
  roles: Record<DatabaseRole, { proof: string; slotId: string }>;
}
/** Resolving private proofs is server-owned; control records contain slot/identity references only. */
export class BrokerDatabaseMaterialDelivery implements DatabaseMaterialDelivery {
  constructor(
    private readonly broker: AccessBroker,
    private readonly references: (
      scope: DatabaseProviderScope,
    ) => Promise<DatabaseBrokerReferences>,
  ) {}
  async withMaterial(
    scope: DatabaseProviderScope,
    roles: readonly DatabaseRole[],
    consume: (material: DatabaseMaterial) => Promise<void>,
    assertDispatch: () => Promise<void>,
  ) {
    const binding = immutableSnapshot(await this.references(immutableSnapshot(scope)));
    const context = binding.context;
    if (
      context.projectId !== scope.projectId ||
      context.environmentId !== scope.environmentId ||
      context.epoch !== scope.epoch ||
      context.command.kind !== "database.lifecycle" ||
      context.command.intent !== "provision" ||
      context.command.manifestHash !== scope.preparationHash ||
      roles.length !== DATABASE_ROLES.length ||
      new Set(roles).size !== DATABASE_ROLES.length
    )
      throw new DomainError(
        "FORBIDDEN",
        "Database broker references differ from the exact bootstrap scope",
        403,
      );
    const material = {} as DatabaseMaterial;
    try {
      for (const role of roles) {
        await assertDispatch();
        const reference = binding.roles[role];
        await this.broker.consumeTask(
          reference.proof,
          reference.slotId,
          context,
          { tool: "database.provision", destination: "database.private", costMicros: 0 },
          (value) => {
            material[role] = value;
          },
        );
      }
      await assertDispatch();
      await consume(material);
    } finally {
      for (const role of roles) material[role] = "";
    }
  }
}
