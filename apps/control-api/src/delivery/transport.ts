import type { DeliveryArtifactView } from "@godseye/contracts";
import type { DeliveryManifest, DeliveryScope, ManagedDeliveryTransport } from "@godseye/core";
import type { JenkinsBuildBackend } from "./build-backend.js";
import type { DockerRuntime } from "./docker-runtime.js";

/** Jenkins builds, Docker/runsc runs; Caddy swaps traffic. Wrapped by ManagedDeliveryProvider. */
export class DockerJenkinsTransport implements ManagedDeliveryTransport {
  constructor(
    private readonly builds: JenkinsBuildBackend,
    private readonly runtime: DockerRuntime,
  ) {}
  build(scope: DeliveryScope, manifest: DeliveryManifest, guard: () => Promise<void>) {
    return this.builds.build(scope, manifest, guard);
  }
  inspectBuild(scope: DeliveryScope, manifest: DeliveryManifest) {
    return this.builds.inspectBuild(scope, manifest);
  }
  async stage(
    scope: DeliveryScope,
    manifest: DeliveryManifest,
    artifact: DeliveryArtifactView,
    guard: () => Promise<void>,
  ) {
    await guard();
    await this.runtime.stage(scope, manifest, artifact);
  }
  readiness(scope: DeliveryScope, manifest: DeliveryManifest) {
    return this.runtime.inspect(scope, manifest);
  }
  async promote(
    scope: DeliveryScope,
    manifest: DeliveryManifest,
    previous: DeliveryScope | null,
    guard: () => Promise<void>,
  ) {
    await guard();
    await this.runtime.promote(scope, manifest, previous);
  }
  inspect(scope: DeliveryScope, manifest: DeliveryManifest) {
    return this.runtime.inspect(scope, manifest);
  }
  async cleanup(scope: DeliveryScope, _manifest: DeliveryManifest, guard: () => Promise<void>) {
    await guard();
    await this.runtime.cleanup(scope);
  }
}
