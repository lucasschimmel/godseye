import type {
  DeliveryArtifactView,
  DeliveryLimits,
  DeliveryPolicyView,
  DeliveryRecipe,
  RepositoryConfigurationInput,
} from "@godseye/contracts";
import type { z } from "zod";

export interface GithubSourceQuery {
  branch: string;
  pullRequestNumber: number | null;
}
export interface GithubSourceEvidence {
  installationId: number;
  repositoryId: number;
  fullName: string;
  branch: string;
  commitSha: string;
  pullRequestNumber: number | null;
  pullRequestOpen: boolean;
  sameRepository: boolean;
  installationActive: boolean;
  observedAt: string;
}
export interface GithubSourceProvider {
  resolve(
    binding: RepositoryConfigurationInput,
    query: GithubSourceQuery,
  ): Promise<GithubSourceEvidence>;
}
export interface DeliveryProviderBinding {
  providerId: string;
  targetId: string;
  version: string;
  generation: number;
  previewDomain?: string;
}
export interface DeliveryQualification extends DeliveryProviderBinding {
  isolatedBuild: boolean;
  scopedCheckout: boolean;
  immutableArtifacts: boolean;
  trustedChecks: boolean;
  privateRuntime: boolean;
  hardQuotas: boolean;
  firewallIpv4: boolean;
  firewallIpv6: boolean;
  evidence: string;
  observedAt: string;
  expiresAt: string;
}
export interface DeliveryManifest {
  policyVersion: "delivery-v1";
  preparationId: string;
  policyId: string;
  policyHash: string;
  projectId: string;
  environmentId: string;
  projectRevision: number;
  environmentRevision: number;
  ciRunId: string;
  repository: RepositoryConfigurationInput;
  source: GithubSourceQuery & { commitSha: string };
  intent: "build" | "release" | "rollback" | "cleanup";
  artifactId: string | null;
  artifactDigest: string | null;
  deploymentId: string | null;
  recipe: z.infer<typeof DeliveryRecipe>;
  requiredChecks: string[];
  maxArtifactMiB: number;
  limits: z.infer<typeof DeliveryLimits>;
  binding: DeliveryProviderBinding | null;
  syntheticDataOnly: boolean;
  ownership: string;
  expectedTargetGeneration: number;
  cleanupReason: "ttl" | "closed" | null;
  previousScope: DeliveryScope | null;
}
export interface DeliveryScope {
  projectId: string;
  environmentId: string;
  preparationId: string;
  runId: string;
  manifestHash: string;
  epoch: number;
  generation: number;
  ownership: string;
}
export interface BuildEvidence {
  scope: DeliveryScope;
  digest: string;
  sizeBytes: number;
  commitSha: string;
  repositoryId: number;
  installationId: number;
  recipeHash: string;
  checks: { name: string; passed: boolean }[];
  scan: "passed" | "failed";
  builderId: string;
  provenanceHash: string;
  configurationHash: string;
  schemaCompatibility: "compatible" | "incompatible";
  evidence: string;
}
export interface DeploymentInspection {
  scope: DeliveryScope;
  digest: string | null;
  present: boolean;
  ready: boolean;
  active: boolean;
  privateRuntime: boolean;
  syntheticDataOnly: boolean;
  url?: string | null;
  evidence: string;
}
export interface DeliveryProvider {
  readonly binding: DeliveryProviderBinding;
  qualification(): Promise<DeliveryQualification | null>;
  build(
    scope: DeliveryScope,
    manifest: DeliveryManifest,
    guard: () => Promise<void>,
  ): Promise<BuildEvidence>;
  inspectBuild(scope: DeliveryScope, manifest: DeliveryManifest): Promise<BuildEvidence | null>;
  stage(
    scope: DeliveryScope,
    manifest: DeliveryManifest,
    artifact: DeliveryArtifactView,
    guard: () => Promise<void>,
  ): Promise<void>;
  readiness(scope: DeliveryScope, manifest: DeliveryManifest): Promise<DeploymentInspection | null>;
  promote(
    scope: DeliveryScope,
    manifest: DeliveryManifest,
    previous: DeliveryScope | null,
    guard: () => Promise<void>,
  ): Promise<void>;
  inspect(scope: DeliveryScope, manifest: DeliveryManifest): Promise<DeploymentInspection | null>;
  cleanup(
    scope: DeliveryScope,
    manifest: DeliveryManifest,
    guard: () => Promise<void>,
  ): Promise<void>;
}
export type DeliveryPolicyRecord = DeliveryPolicyView;
