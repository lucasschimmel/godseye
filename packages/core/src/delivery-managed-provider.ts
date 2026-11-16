import type { DeliveryArtifactView } from "@godseye/contracts";
import type {
  DeliveryManifest,
  DeliveryProvider,
  DeliveryProviderBinding,
  DeliveryQualification,
  DeliveryScope,
} from "./delivery-provider.js";
import { DomainError } from "./errors.js";
import { immutableSnapshot } from "./infra-policy.js";

export {
  assertBuildEvidence,
  assertDeploymentInspection,
  deliveryConfigurationHash,
  deliveryProvenanceHash,
} from "./delivery-evidence.js";

import { assertBuildEvidence, assertDeploymentInspection } from "./delivery-evidence.js";
/** Private implementation seam for Jenkins/build guests and Coolify/runtime adapters. Never exposed over owner HTTP. */
export interface ManagedDeliveryTransport
  extends Omit<DeliveryProvider, "binding" | "qualification"> {}
export class ManagedDeliveryProvider implements DeliveryProvider {
  readonly binding: DeliveryProviderBinding;
  constructor(
    binding: DeliveryProviderBinding,
    private readonly transport: ManagedDeliveryTransport,
    private readonly attest: () => Promise<DeliveryQualification | null> = async () => null,
  ) {
    this.binding = immutableSnapshot(binding);
  }
  qualification() {
    return this.attest();
  }
  async build(
    scopeInput: DeliveryScope,
    manifestInput: DeliveryManifest,
    guard: () => Promise<void>,
  ) {
    const scope = immutableSnapshot(scopeInput),
      manifest = immutableSnapshot(manifestInput);
    await guard();
    const result = immutableSnapshot(await this.transport.build(scope, manifest, guard));
    await guard();
    assertBuildEvidence(result, scope, manifest);
    return result;
  }
  async inspectBuild(scopeInput: DeliveryScope, manifestInput: DeliveryManifest) {
    const scope = immutableSnapshot(scopeInput),
      manifest = immutableSnapshot(manifestInput);
    const result = immutableSnapshot(await this.transport.inspectBuild(scope, manifest));
    if (result) assertBuildEvidence(result, scope, manifest);
    return result;
  }
  async stage(
    scopeInput: DeliveryScope,
    manifestInput: DeliveryManifest,
    artifactInput: DeliveryArtifactView,
    guard: () => Promise<void>,
  ) {
    const scope = immutableSnapshot(scopeInput),
      manifest = immutableSnapshot(manifestInput),
      artifact = immutableSnapshot(artifactInput);
    if (
      artifact.digest !== manifest.artifactDigest ||
      artifact.projectId !== scope.projectId ||
      artifact.environmentId !== scope.environmentId
    )
      throw new DomainError("FORBIDDEN", "Staging artifact differs from the admitted cell", 403);
    await guard();
    await this.transport.stage(scope, manifest, artifact, guard);
    await guard();
  }
  readiness(scope: DeliveryScope, manifest: DeliveryManifest) {
    return this.transport.readiness(immutableSnapshot(scope), immutableSnapshot(manifest));
  }
  async promote(
    scopeInput: DeliveryScope,
    manifestInput: DeliveryManifest,
    previousInput: DeliveryScope | null,
    guard: () => Promise<void>,
  ) {
    const scope = immutableSnapshot(scopeInput),
      manifest = immutableSnapshot(manifestInput);
    const previous = immutableSnapshot(previousInput);
    const result = immutableSnapshot(await this.transport.readiness(scope, manifest));
    assertDeploymentInspection(result, scope, manifest);
    await guard();
    await this.transport.promote(scope, manifest, previous, guard);
    await guard();
  }
  inspect(scope: DeliveryScope, manifest: DeliveryManifest) {
    return this.transport.inspect(immutableSnapshot(scope), immutableSnapshot(manifest));
  }
  async cleanup(
    scopeInput: DeliveryScope,
    manifestInput: DeliveryManifest,
    guard: () => Promise<void>,
  ) {
    const scope = immutableSnapshot(scopeInput),
      manifest = immutableSnapshot(manifestInput);
    if (!manifest.syntheticDataOnly || manifest.intent !== "cleanup")
      throw new DomainError(
        "FORBIDDEN",
        "Cleanup only removes owned ephemeral preview runtime and ingress",
        403,
      );
    await guard();
    await this.transport.cleanup(scope, manifest, guard);
    await guard();
  }
}
