import type { ExecutionContext } from "@godseye/contracts";
import type { AccessBroker } from "./access.js";
import { DomainError } from "./errors.js";
import { immutableSnapshot } from "./infra-policy.js";
import type { RecoveryRepositoryMaterial } from "./recovery-pgbackrest-provider.js";
import type { RecoveryScope } from "./recovery-provider.js";
import { RECOVERY_DESTINATION } from "./recovery-state.js";

export interface RecoveryBrokerReferences {
  context: ExecutionContext;
  sourceAllocationId: string;
  repositoryId: string;
  proof: string;
  slotId: string;
}
/** Source-scoped READ authority and exact destination WRITE authority share one immutable recovery plan. */
export class BrokerRecoveryRepositoryMaterial implements RecoveryRepositoryMaterial {
  constructor(
    private readonly broker: AccessBroker,
    private readonly references: (scope: RecoveryScope) => Promise<RecoveryBrokerReferences>,
  ) {}
  async withMaterial(
    input: RecoveryScope,
    consume: (passphrase: string) => Promise<void>,
    gate: () => Promise<void>,
  ) {
    return this.deliver(input, consume, gate, false);
  }
  async withInspectionMaterial(
    input: RecoveryScope,
    consume: (passphrase: string) => Promise<void>,
    gate: () => Promise<void>,
  ) {
    return this.deliver(input, consume, gate, true);
  }
  private async deliver(
    input: RecoveryScope,
    consume: (passphrase: string) => Promise<void>,
    gate: () => Promise<void>,
    inspection: boolean,
  ) {
    const scope = immutableSnapshot(input);
    await gate();
    const binding = immutableSnapshot(await this.references(scope));
    await gate();
    const context = binding.context;
    if (
      context.projectId !== scope.projectId ||
      context.environmentId !== scope.sourceEnvironmentId ||
      context.epoch !== scope.epoch ||
      context.command.kind !== "database.recovery" ||
      context.command.intent !== scope.kind ||
      context.command.manifestRef !== scope.preparationId ||
      context.command.manifestHash !== scope.preparationHash ||
      binding.sourceAllocationId !== scope.sourceAllocationId ||
      binding.repositoryId !== scope.repositoryId ||
      (scope.kind === "restore" &&
        (scope.environmentId === scope.sourceEnvironmentId ||
          scope.allocationId === scope.sourceAllocationId))
    )
      throw new DomainError(
        "FORBIDDEN",
        "Recovery broker references differ from exact source and held destination scope",
        403,
      );
    let material = "";
    try {
      const handoff = inspection
        ? this.broker.consumeRecoveryInspection.bind(this.broker)
        : this.broker.consumeTask.bind(this.broker);
      await handoff(
        binding.proof,
        binding.slotId,
        context,
        { tool: `recovery.${scope.kind}`, destination: RECOVERY_DESTINATION, costMicros: 0 },
        (value) => {
          material = value;
        },
      );
      await gate();
      if (!material)
        throw new DomainError(
          "PROVIDER_UNAVAILABLE",
          "Recovery repository material is unavailable",
          503,
        );
      await consume(material);
      await gate();
    } finally {
      material = "";
    }
  }
}
