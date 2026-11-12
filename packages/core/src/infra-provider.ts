import type { InfrastructureObservationInput } from "@godseye/contracts";
import type { CompiledApplication } from "./infra-policy.js";

/** Private server configuration. There is deliberately no HTTP registration endpoint. */
export interface InfrastructureCollector {
  collect(): Promise<InfrastructureObservationInput>;
}
export interface ProviderScope {
  allocationId: string;
  projectId: string;
  environmentId: string;
  manifestHash: string;
  ownership: string;
  epoch: number;
}
export interface ProviderResource {
  id: string;
  scope: ProviderScope;
  configurationHash: string;
}
export interface ProviderInspection {
  network: ProviderResource | null;
  data: ProviderResource | null;
  sandbox: ProviderResource | null;
  manifest: CompiledApplication | null;
  running: boolean;
  quotaEnforced: boolean;
  firewallIpv4: boolean;
  firewallIpv6: boolean;
  runtime: "runsc";
  platform: "systrap";
  evidence: string;
}
export interface InfrastructureProvider {
  readonly id: string;
  readonly targetId: string;
  readonly version: string;
  /** Actual independently qualified endpoint/version; constructor injection is trusted, never an owner declaration. */
  readonly qualified: boolean;
  preflight(
    manifest: CompiledApplication,
  ): Promise<{ image: string; artifactDigest: string; verified: boolean }>;
  createNetwork(scope: ProviderScope, manifest: CompiledApplication): Promise<ProviderResource>;
  secureNetwork(scope: ProviderScope, network: ProviderResource): Promise<void>;
  createData(scope: ProviderScope, manifest: CompiledApplication): Promise<ProviderResource>;
  createSandbox(
    scope: ProviderScope,
    manifest: CompiledApplication,
    resources: { network: ProviderResource; data: ProviderResource },
    assertDispatch?: () => Promise<void>,
  ): Promise<ProviderResource>;
  inspect(
    scope: ProviderScope,
    manifest: CompiledApplication,
    resources: Partial<Record<"network" | "data" | "sandbox", ProviderResource>>,
  ): Promise<ProviderInspection>;
  start(scope: ProviderScope, sandbox: ProviderResource): Promise<void>;
  quarantine(
    scope: ProviderScope,
    sandbox: ProviderResource,
  ): Promise<{ stopped: boolean; evidence: string }>;
}
