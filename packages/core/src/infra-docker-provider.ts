import { DomainError } from "./errors.js";
import { verifyDockerConfiguration } from "./infra-docker-inspection.js";
import {
  dockerOwnershipLabels,
  renderDockerNetwork,
  renderDockerSandbox,
} from "./infra-docker-policy.js";
import type { DockerEngineTransport } from "./infra-docker-transport.js";
import { type CompiledApplication, immutableSnapshot } from "./infra-policy.js";
import type {
  InfrastructureProvider,
  ProviderInspection,
  ProviderResource,
  ProviderScope,
} from "./infra-provider.js";
import { assertResource } from "./infra-steps.js";
import { fingerprint } from "./journal.js";

export interface EnforcementQualification {
  targetId: string;
  backend: string;
  version: string;
  evidence: string;
  expiresAt: string;
}
/** Trusted host helpers must exercise and inspect actual backend enforcement. */
export interface PersistentQuotaManager {
  qualification(): Promise<EnforcementQualification>;
  allocate(scope: ProviderScope, quotaGiB: number): Promise<{ id: string; volumeName: string }>;
  inspect(
    scope: ProviderScope,
    id: string,
  ): Promise<{
    targetId: string;
    enforced: boolean;
    quotaGiB: number;
    volumeName: string;
    evidence: string;
  } | null>;
  lookup(
    scope: ProviderScope,
    volumeName: string,
  ): Promise<{
    id: string;
    targetId: string;
    enforced: boolean;
    quotaGiB: number;
    volumeName: string;
    evidence: string;
  } | null>;
}
export interface DualStackFirewallManager {
  qualification(): Promise<
    EnforcementQualification & {
      ipv4HostDenied: true;
      ipv6HostDenied: true;
      ipv4ForwardDenied: true;
      ipv6ForwardDenied: true;
    }
  >;
  enforce(scope: ProviderScope, networkId: string): Promise<void>;
  inspect(
    scope: ProviderScope,
    networkId: string,
  ): Promise<{
    ipv4HostDenied: boolean;
    targetId: string;
    ipv6HostDenied: boolean;
    ipv4ForwardDenied: boolean;
    ipv6ForwardDenied: boolean;
    evidence: string;
  }>;
}
export interface ImmutableArtifactVerifier {
  verify(
    image: string,
    digest: string,
  ): Promise<{ imageId: string; imageVolumes: string[]; evidence: string }>;
}
export interface RuntimeConfigurationVerifier {
  inspect(): Promise<
    EnforcementQualification & {
      runtime: "runsc";
      platform: "systrap";
      defaultSeccompDigest: string;
      limitsEnforced: true;
    }
  >;
}
export interface DockerProviderDependencies {
  quota: PersistentQuotaManager;
  firewall: DualStackFirewallManager;
  artifacts: ImmutableArtifactVerifier;
  runtime: RuntimeConfigurationVerifier;
}
const unavailable = () =>
  new DomainError(
    "CAPABILITY_UNAVAILABLE",
    "Docker requires qualified persistent quota, both-family host/forwarding firewall, runtime and artifact helpers",
    503,
  );
function proofExpires(proof: EnforcementQualification, now: number) {
  const expires = Date.parse(proof.expiresAt);
  if (
    !proof.backend?.trim() ||
    !proof.version?.trim() ||
    !proof.evidence?.trim() ||
    proof.evidence.length > 256 ||
    !Number.isFinite(expires) ||
    expires <= now ||
    expires > now + 300_000
  )
    throw unavailable();
  return expires;
}
/** No helper or provider is installed/qualified by an environment boolean or browser request. */
export class DockerInfrastructureProvider implements InfrastructureProvider {
  readonly id = "docker.local";
  readonly targetId: string;
  readonly version: string;
  private qualificationExpires = 0;
  constructor(
    readonly transport: DockerEngineTransport,
    private readonly dependencies?: DockerProviderDependencies,
    private readonly now: () => Date = () => new Date(),
    target?: { targetId: string; version: string },
  ) {
    this.targetId = target?.targetId ?? "unconfigured";
    this.version = target?.version ?? "unconfigured";
  }
  get qualified() {
    return Boolean(this.dependencies) && this.qualificationExpires > this.now().getTime();
  }
  /** Private bootstrap only: callbacks are independently implemented host enforcement probes. */
  async qualify() {
    this.qualificationExpires = 0;
    if (!this.dependencies) throw unavailable();
    if (!/^[a-f0-9-]{36}$/.test(this.targetId)) throw unavailable();
    const runtime = immutableSnapshot(await this.dependencies.runtime.inspect());
    const quota = immutableSnapshot(await this.dependencies.quota.qualification());
    const firewall = immutableSnapshot(await this.dependencies.firewall.qualification());
    if (
      runtime.targetId !== this.targetId ||
      quota.targetId !== this.targetId ||
      firewall.targetId !== this.targetId ||
      runtime.version !== this.version ||
      runtime.runtime !== "runsc" ||
      runtime.platform !== "systrap" ||
      !runtime.limitsEnforced ||
      !/^sha256:[a-f0-9]{64}$/.test(runtime.defaultSeccompDigest) ||
      !firewall.ipv4HostDenied ||
      !firewall.ipv6HostDenied ||
      !firewall.ipv4ForwardDenied ||
      !firewall.ipv6ForwardDenied
    )
      throw unavailable();
    const now = this.now().getTime();
    this.qualificationExpires = Math.min(
      proofExpires(runtime, now),
      proofExpires(quota, now),
      proofExpires(firewall, now),
    );
  }
  private helpers() {
    if (!this.qualified || !this.dependencies) throw unavailable();
    return this.dependencies;
  }
  private resource(scope: ProviderScope, id: string): ProviderResource {
    return immutableSnapshot({ id, scope, configurationHash: scope.manifestHash });
  }
  private check(scope: ProviderScope, manifest: CompiledApplication) {
    this.helpers();
    const binding = manifest.providerBinding;
    if (
      !binding ||
      binding.providerId !== this.id ||
      binding.targetId !== this.targetId ||
      binding.version !== this.version ||
      binding.policyVersion !== manifest.policyVersion
    )
      throw unavailable();
    if (
      fingerprint(manifest) !== scope.manifestHash ||
      manifest.ownership !== scope.ownership ||
      manifest.projectId !== scope.projectId ||
      manifest.environmentId !== scope.environmentId ||
      manifest.allocationId !== scope.allocationId
    )
      throw new DomainError("PROFILE_DRIFT", "Provider scope differs from compiled policy", 409);
  }
  async preflight(input: CompiledApplication) {
    const manifest = immutableSnapshot(input),
      helpers = this.helpers();
    const proof = immutableSnapshot(
      await helpers.artifacts.verify(manifest.image, manifest.artifactDigest),
    );
    this.helpers();
    if (
      !/^sha256:[a-f0-9]{64}$/.test(proof.imageId) ||
      !proof.evidence?.trim() ||
      !Array.isArray(proof.imageVolumes) ||
      proof.imageVolumes.some((volume) => volume !== "/data")
    )
      throw unavailable();
    return { image: manifest.image, artifactDigest: manifest.artifactDigest, verified: true };
  }
  async createNetwork(scopeInput: ProviderScope, input: CompiledApplication) {
    const scope = immutableSnapshot(scopeInput),
      manifest = immutableSnapshot(input);
    this.check(scope, manifest);
    const id = await this.transport.createNetwork(renderDockerNetwork(scope, manifest));
    this.helpers();
    return this.resource(scope, id);
  }
  async secureNetwork(scopeInput: ProviderScope, input: ProviderResource) {
    const scope = immutableSnapshot(scopeInput),
      network = immutableSnapshot(input);
    this.helpers();
    assertResource(network, scope);
    await this.helpers().firewall.enforce(scope, network.id);
    this.helpers();
  }
  async createData(scopeInput: ProviderScope, input: CompiledApplication) {
    const scope = immutableSnapshot(scopeInput),
      manifest = immutableSnapshot(input);
    this.check(scope, manifest);
    const allocation = immutableSnapshot(
      await this.helpers().quota.allocate(scope, manifest.limits.dataGiB),
    );
    this.helpers();
    if (allocation.volumeName !== manifest.names.data)
      throw new DomainError(
        "PROFILE_DRIFT",
        "Quota helper returned a foreign persistent volume",
        409,
      );
    return this.resource(scope, allocation.id);
  }
  async createSandbox(
    scopeInput: ProviderScope,
    input: CompiledApplication,
    inputResources: { network: ProviderResource; data: ProviderResource },
    assertDispatch?: () => Promise<void>,
  ) {
    const scope = immutableSnapshot(scopeInput),
      manifest = immutableSnapshot(input),
      resources = immutableSnapshot(inputResources);
    this.check(scope, manifest);
    assertResource(resources.network, scope);
    assertResource(resources.data, scope);
    const quota = immutableSnapshot(await this.helpers().quota.inspect(scope, resources.data.id));
    this.check(scope, manifest);
    if (
      !quota?.enforced ||
      quota.targetId !== this.targetId ||
      quota.quotaGiB !== manifest.limits.dataGiB ||
      quota.volumeName !== manifest.names.data ||
      !quota.evidence.trim()
    )
      throw unavailable();
    if (!assertDispatch) throw unavailable();
    await assertDispatch();
    this.check(scope, manifest);
    const id = await this.transport.createSandbox(
      manifest.names.sandbox,
      renderDockerSandbox(scope, manifest, resources.network.id, quota.volumeName),
    );
    this.helpers();
    return this.resource(scope, id);
  }
  async inspect(
    scopeInput: ProviderScope,
    input: CompiledApplication,
    inputResources: Partial<Record<"network" | "data" | "sandbox", ProviderResource>>,
  ): Promise<ProviderInspection> {
    const scope = immutableSnapshot(scopeInput),
      manifest = immutableSnapshot(input),
      resources = immutableSnapshot(inputResources);
    this.check(scope, manifest);
    for (const resource of Object.values(resources)) assertResource(resource, scope);
    const helpers = this.helpers();
    const network = immutableSnapshot(
      await (resources.network
        ? this.transport.inspectNetwork(resources.network.id)
        : this.transport.findNetworkByName(manifest.names.network)),
    );
    const data = immutableSnapshot(
      await (resources.data
        ? helpers.quota
            .inspect(scope, resources.data.id)
            .then((found) => found && { ...found, id: resources.data?.id ?? "" })
        : helpers.quota.lookup(scope, manifest.names.data)),
    );
    const sandbox = immutableSnapshot(
      await (resources.sandbox
        ? this.transport.inspectSandbox(resources.sandbox.id)
        : this.transport.findSandboxByName(manifest.names.sandbox)),
    );
    this.check(scope, manifest);
    if (!network && !data && !sandbox)
      return {
        network: null,
        data: null,
        sandbox: null,
        manifest: null,
        running: false,
        quotaEnforced: false,
        firewallIpv4: false,
        firewallIpv6: false,
        runtime: "runsc",
        platform: "systrap",
        evidence: `absence:${scope.manifestHash}`,
      };
    if (!network || !data || !sandbox)
      throw new DomainError("PROFILE_DRIFT", "Provider allocation is incomplete", 409);
    const firewall = immutableSnapshot(await helpers.firewall.inspect(scope, network.Id));
    const runtime = immutableSnapshot(await helpers.runtime.inspect());
    const artifact = immutableSnapshot(
      await helpers.artifacts.verify(manifest.image, manifest.artifactDigest),
    );
    this.check(scope, manifest);
    proofExpires(runtime, this.now().getTime());
    verifyDockerConfiguration(
      { network, sandbox, data, firewall, runtime, artifact },
      scope,
      manifest,
      network.Id,
    );
    return {
      network: this.resource(scope, network.Id),
      data: this.resource(scope, data.id),
      sandbox: this.resource(scope, sandbox.Id),
      manifest,
      running: sandbox.State.Running,
      quotaEnforced: true,
      firewallIpv4: true,
      firewallIpv6: true,
      runtime: "runsc",
      platform: "systrap",
      evidence: `docker-inspect:${fingerprint({ network, sandbox, data, firewall, runtime, artifact })}`,
    };
  }
  async start(scopeInput: ProviderScope, input: ProviderResource) {
    const scope = immutableSnapshot(scopeInput),
      sandbox = immutableSnapshot(input);
    this.helpers();
    assertResource(sandbox, scope);
    await this.transport.startSandbox(sandbox.id);
    this.helpers();
  }
  async quarantine(scopeInput: ProviderScope, input: ProviderResource) {
    const scope = immutableSnapshot(scopeInput),
      sandbox = immutableSnapshot(input);
    this.helpers();
    assertResource(sandbox, scope);
    const actual = immutableSnapshot(await this.transport.inspectSandbox(sandbox.id));
    if (!actual) return { stopped: true, evidence: `sandbox-absent:${sandbox.id}` };
    if (
      actual.Id !== sandbox.id ||
      fingerprint(actual.Config.Labels) !== fingerprint(dockerOwnershipLabels(scope)) ||
      actual.Name !== `/gse-${scope.allocationId}-app` ||
      !actual.Config.Image.includes("@sha256:")
    )
      throw new DomainError(
        "PROFILE_DRIFT",
        "Protective stop refused a foreign or unidentified sandbox",
        409,
      );
    await this.transport.stopSandbox(sandbox.id);
    const stopped = await this.transport.inspectSandbox(sandbox.id);
    return {
      stopped: stopped === null || !stopped.State.Running,
      evidence: `protective-stop:${sandbox.id}`,
    };
  }
}
