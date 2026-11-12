import { DEFAULT_SCAN_THRESHOLD, MigrationBinding, ScannerEvidence } from "@godseye/contracts";
import { z } from "zod";
import type {
  BuildEvidence,
  DeliveryManifest,
  DeliveryScope,
  DeploymentInspection,
} from "./delivery-provider.js";
import { assertScanGate } from "./delivery-scan.js";
import { DomainError } from "./errors.js";
import { fingerprint } from "./journal.js";

const Hash = z.string().regex(/^[a-f0-9]{64}$/);
const Id = z.string().uuid();
export const GithubSourceObservation = z
  .object({
    installationId: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    repositoryId: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    fullName: z.string().regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/),
    branch: z.string().min(1).max(200),
    commitSha: z.string().regex(/^(?!0{40}$)[a-f0-9]{40}$/),
    pullRequestNumber: z.number().int().positive().nullable(),
    pullRequestOpen: z.boolean(),
    sameRepository: z.boolean(),
    installationActive: z.boolean(),
    observedAt: z.string().datetime(),
  })
  .strict();
export const DeliveryScopeEvidence = z
  .object({
    projectId: Id,
    environmentId: Id,
    preparationId: Id,
    runId: Id,
    manifestHash: Hash,
    epoch: z.number().int().positive(),
    generation: z.number().int().positive(),
    ownership: Hash,
  })
  .strict();
export const UsageObservation = z
  .object({
    cpuMilliSeconds: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
    peakMemoryMiB: z.number().int().min(0).max(1048576),
    diskMiB: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
    durationMs: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  })
  .strict();
export const BuildObservation = z
  .object({
    scope: DeliveryScopeEvidence,
    digest: z.string().regex(/^sha256:[a-f0-9]{64}$/),
    sizeBytes: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    commitSha: z.string().regex(/^[a-f0-9]{40}$/),
    repositoryId: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    installationId: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    recipeHash: Hash,
    checks: z
      .array(
        z
          .object({ name: z.string().regex(/^[a-z][a-z0-9.-]{0,63}$/), passed: z.boolean() })
          .strict(),
      )
      .max(32),
    scan: z.enum(["passed", "failed"]),
    builderId: z.string().regex(/^[A-Za-z0-9._:-]{1,128}$/),
    provenanceHash: Hash,
    configurationHash: Hash,
    schemaCompatibility: z.enum(["compatible", "incompatible"]),
    scanner: ScannerEvidence,
    migration: MigrationBinding,
    usage: UsageObservation.optional(),
    evidence: z.string().trim().min(1).max(256),
  })
  .strict();
export const DeploymentObservation = z
  .object({
    scope: DeliveryScopeEvidence,
    digest: z
      .string()
      .regex(/^sha256:[a-f0-9]{64}$/)
      .nullable(),
    present: z.boolean(),
    ready: z.boolean(),
    active: z.boolean(),
    privateRuntime: z.boolean(),
    syntheticDataOnly: z.boolean(),
    url: z.string().max(512).nullable().optional(),
    usage: UsageObservation.optional(),
    evidence: z.string().trim().min(1).max(256),
  })
  .strict();
export const DeliveryQualificationObservation = z
  .object({
    providerId: z.string().regex(/^[a-z][a-z0-9.-]{1,63}$/),
    targetId: Id,
    version: z.string().min(1).max(100),
    generation: z.number().int().positive(),
    previewDomain: z
      .string()
      .regex(/^[a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?$/)
      .optional(),
    isolatedBuild: z.boolean(),
    scopedCheckout: z.boolean(),
    immutableArtifacts: z.boolean(),
    trustedChecks: z.boolean(),
    privateRuntime: z.boolean(),
    hardQuotas: z.boolean(),
    firewallIpv4: z.boolean(),
    firewallIpv6: z.boolean(),
    evidence: z.string().trim().min(1).max(256),
    observedAt: z.string().datetime(),
    expiresAt: z.string().datetime(),
  })
  .strict();
export const deliveryConfigurationHash = (manifest: DeliveryManifest) =>
  fingerprint({ recipe: manifest.recipe, limits: manifest.limits });
export function deliveryProvenanceHash(
  result: Omit<BuildEvidence, "provenanceHash" | "evidence" | "usage">,
) {
  const {
    scope,
    digest,
    sizeBytes,
    commitSha,
    repositoryId,
    installationId,
    recipeHash,
    checks,
    scan,
    builderId,
    configurationHash,
    schemaCompatibility,
    scanner,
    migration,
  } = result;
  return fingerprint({
    scope,
    digest,
    sizeBytes,
    commitSha,
    repositoryId,
    installationId,
    recipeHash,
    checks,
    scan,
    builderId,
    configurationHash,
    schemaCompatibility,
    scanner,
    migration,
  });
}
export function assertBuildEvidence(
  result: BuildEvidence | null,
  scope: DeliveryScope,
  manifest: DeliveryManifest,
): asserts result is BuildEvidence {
  if (
    !BuildObservation.safeParse(result).success ||
    !result ||
    fingerprint(result.scope) !== fingerprint(scope) ||
    result.sizeBytes > manifest.maxArtifactMiB * 1048576 ||
    result.commitSha !== manifest.source.commitSha ||
    result.repositoryId !== manifest.repository.repositoryId ||
    result.installationId !== manifest.repository.installationId ||
    result.recipeHash !== fingerprint(manifest.recipe) ||
    result.configurationHash !== deliveryConfigurationHash(manifest) ||
    (result.schemaCompatibility === "incompatible") !==
      (result.migration.class === "destructive") ||
    result.scanner.artifactDigest !== result.digest ||
    result.scan !== "passed" ||
    new Set(result.checks.map((check) => check.name)).size !== result.checks.length ||
    result.checks.some((check) => check.passed !== true) ||
    manifest.requiredChecks.some(
      (name) => !result.checks.some((check) => check.name === name && check.passed === true),
    ) ||
    result.provenanceHash !== deliveryProvenanceHash(result)
  )
    throw new DomainError(
      "ARTIFACT_REJECTED",
      "Trusted immutable artifact, checks and provenance are incomplete",
      409,
    );
  assertScanGate(result.scanner, manifest.scanThreshold ?? DEFAULT_SCAN_THRESHOLD);
}
export function assertDeploymentInspection(
  result: DeploymentInspection | null,
  scope: DeliveryScope,
  manifest: DeliveryManifest,
  options: { active?: boolean; absent?: boolean } = {},
): asserts result is DeploymentInspection {
  if (
    !DeploymentObservation.safeParse(result).success ||
    !result ||
    fingerprint(result.scope) !== fingerprint(scope) ||
    result.digest !== manifest.artifactDigest ||
    result.privateRuntime !== true ||
    result.syntheticDataOnly !== manifest.syntheticDataOnly ||
    (options.absent
      ? result.present !== false || result.active !== false
      : result.present !== true ||
        result.ready !== true ||
        (options.active !== undefined && result.active !== options.active))
  )
    throw new DomainError(
      "DEPLOYMENT_DRIFT",
      "Owned deployment inspection does not match the exact artifact and scope",
      409,
    );
}
