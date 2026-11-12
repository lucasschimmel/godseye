import {
  DeliveryPolicy,
  DeliveryPreparation,
  DeliveryRun,
  type ExecutionContext,
} from "@godseye/contracts";
import { type DatabaseAccess, type Store, schema } from "@godseye/store";
import { eq } from "drizzle-orm";
import { DeliveryQualificationObservation, GithubSourceObservation } from "./delivery-evidence.js";
import type {
  DeliveryManifest,
  DeliveryProvider,
  DeliveryQualification,
  DeliveryScope,
  GithubSourceEvidence,
  GithubSourceProvider,
} from "./delivery-provider.js";
import { DomainError } from "./errors.js";
import { assertFresh, environmentFor, foundationState } from "./foundation-data.js";
import type { FoundationEngine } from "./foundations.js";
import { immutableSnapshot } from "./infra-policy.js";
import { fingerprint } from "./journal.js";
import type { Actor } from "./policy.js";

export const DELIVERY_ADAPTER_ID = "local.delivery";
export const DELIVERY_DESTINATION = "delivery.private";
export const DELIVERY_SCHEDULER_ID = "delivery-scheduler";
export interface DeliveryState {
  store: Store;
  now: () => Date;
  foundation: FoundationEngine;
  sourceProvider?: GithubSourceProvider;
  provider?: DeliveryProvider;
  qualification?: DeliveryQualification | null;
}
export const deliveryActor = (projectId: string): Actor => ({
  id: DELIVERY_SCHEDULER_ID,
  kind: "service",
  projectIds: [projectId],
});
export const freshDeliveryOwner = (state: DeliveryState, actor: Actor) =>
  assertFresh(actor, foundationState(state.store, { now: state.now }));
export const policyView = (row: typeof schema.deliveryPolicies.$inferSelect) =>
  DeliveryPolicy.parse({
    ...row.input,
    id: row.id,
    repository: row.repository,
    hash: row.hash,
    revision: row.revision,
    revokedAt: row.revokedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  });
export const deliveryPreparationView = (row: typeof schema.deliveryPreparations.$inferSelect) =>
  DeliveryPreparation.parse({
    id: row.id,
    policyId: row.policyId,
    projectId: row.projectId,
    environmentId: row.environmentId,
    ciRunId: row.ciRunId,
    intent: row.intent,
    commitSha: row.commitSha,
    artifactId: row.artifactId,
    deploymentId: row.deploymentId,
    migration: (row.manifest as { migration?: unknown }).migration ?? null,
    hash: row.hash,
    createdAt: row.createdAt.toISOString(),
  });
export const deliveryRunView = (row: typeof schema.deliveryRuns.$inferSelect) =>
  DeliveryRun.parse({
    id: row.id,
    preparationId: row.preparationId,
    runId: row.runId,
    projectId: row.projectId,
    environmentId: row.environmentId,
    intent: row.intent,
    state: row.state,
    artifactId: row.artifactId,
    previousDeploymentId: row.previousDeploymentId,
    reason: row.reason,
    updatedAt: row.updatedAt.toISOString(),
  });
export async function deliveryPolicyFor(tx: DatabaseAccess, id: string) {
  const [row] = await tx
    .select()
    .from(schema.deliveryPolicies)
    .where(eq(schema.deliveryPolicies.id, id));
  if (!row) throw new DomainError("NOT_FOUND", "Delivery policy not found", 404);
  if (fingerprint({ input: row.input, repository: row.repository }) !== row.hash)
    throw new DomainError("PLAN_TAMPERED", "Delivery policy differs from its immutable scope", 409);
  return row;
}
export async function validateDeliveryPolicy(
  state: DeliveryState,
  tx: DatabaseAccess,
  id: string,
  cleanup = false,
) {
  const row = await deliveryPolicyFor(tx, id);
  const env = await environmentFor(
    tx,
    deliveryActor(row.projectId),
    row.projectId,
    row.environmentId,
  );
  const [project] = await tx
    .select()
    .from(schema.projects)
    .where(eq(schema.projects.id, row.projectId));
  if (!cleanup && (row.revokedAt || Date.parse(row.input.expiresAt) <= state.now().getTime()))
    throw new DomainError("POLICY_REVOKED", "Delivery policy is revoked or expired", 409);
  if (
    !cleanup &&
    (!project ||
      project.status === "suspended" ||
      project.revision !== row.input.expectedProjectRevision ||
      env.revision !== row.input.expectedEnvironmentRevision ||
      fingerprint(project.repository) !== fingerprint(row.repository))
  )
    throw new DomainError("POLICY_STALE", "Project, environment or source binding changed", 409);
  return row;
}
export async function deliveryPreparationFor(tx: DatabaseAccess, id: string) {
  const [row] = await tx
    .select()
    .from(schema.deliveryPreparations)
    .where(eq(schema.deliveryPreparations.id, id));
  if (!row) throw new DomainError("NOT_FOUND", "Delivery preparation not found", 404);
  if (fingerprint(row.manifest) !== row.hash)
    throw new DomainError("PLAN_TAMPERED", "Delivery manifest digest differs", 409);
  const manifest = immutableSnapshot(row.manifest as unknown as DeliveryManifest);
  if (
    manifest.preparationId !== row.id ||
    manifest.projectId !== row.projectId ||
    manifest.environmentId !== row.environmentId ||
    manifest.policyId !== row.policyId ||
    manifest.ciRunId !== row.ciRunId ||
    manifest.source.commitSha !== row.commitSha ||
    manifest.intent !== row.intent ||
    manifest.artifactId !== row.artifactId ||
    manifest.deploymentId !== row.deploymentId
  )
    throw new DomainError("PLAN_TAMPERED", "Delivery manifest scope differs", 409);
  return { row, manifest };
}
export async function qualifyDelivery(state: DeliveryState) {
  const proof = state.provider ? structuredClone(await state.provider.qualification()) : null;
  const binding = state.provider?.binding;
  const now = state.now().getTime();
  if (
    !DeliveryQualificationObservation.safeParse(proof).success ||
    !proof ||
    !binding ||
    fingerprint(binding) !==
      fingerprint({
        providerId: proof.providerId,
        targetId: proof.targetId,
        version: proof.version,
        generation: proof.generation,
        ...(proof.previewDomain ? { previewDomain: proof.previewDomain } : {}),
      }) ||
    proof.isolatedBuild !== true ||
    proof.scopedCheckout !== true ||
    proof.immutableArtifacts !== true ||
    proof.trustedChecks !== true ||
    proof.privateRuntime !== true ||
    proof.hardQuotas !== true ||
    proof.firewallIpv4 !== true ||
    proof.firewallIpv6 !== true ||
    !proof.evidence.trim() ||
    !Number.isFinite(Date.parse(proof.observedAt)) ||
    Date.parse(proof.observedAt) > now ||
    !Number.isFinite(Date.parse(proof.expiresAt)) ||
    Date.parse(proof.expiresAt) <= now ||
    Date.parse(proof.expiresAt) - Date.parse(proof.observedAt) > 300000
  )
    throw new DomainError(
      "CAPABILITY_UNAVAILABLE",
      "Fresh independently qualified delivery provider is required",
      503,
    );
  state.qualification = proof;
  return proof;
}
export function validateSourceEvidence(
  state: DeliveryState,
  manifest: DeliveryManifest,
  result: GithubSourceEvidence,
  requireOpen = true,
) {
  if (!GithubSourceObservation.safeParse(result).success)
    throw new DomainError(
      "SOURCE_REJECTED",
      "Source observation does not match its strict runtime contract",
      409,
    );
  const age = state.now().getTime() - Date.parse(result.observedAt);
  if (
    result.installationId !== manifest.repository.installationId ||
    result.repositoryId !== manifest.repository.repositoryId ||
    result.fullName.toLowerCase() !== manifest.repository.fullName.toLowerCase() ||
    result.branch !== manifest.source.branch ||
    result.pullRequestNumber !== manifest.source.pullRequestNumber ||
    result.sameRepository !== true ||
    result.installationActive !== true ||
    typeof result.pullRequestOpen !== "boolean" ||
    !Number.isFinite(age) ||
    age < 0 ||
    age > 30000 ||
    (requireOpen && manifest.source.pullRequestNumber !== null && result.pullRequestOpen !== true)
  )
    throw new DomainError(
      "SOURCE_REJECTED",
      "Current source does not match the admitted repository and origin",
      409,
    );
  if (requireOpen && result.commitSha !== manifest.source.commitSha)
    throw new DomainError("STALE_HEAD", "Source head changed; this release is superseded", 409);
}
export async function verifyDeliverySource(
  state: DeliveryState,
  manifest: DeliveryManifest,
  requireOpen = true,
) {
  if (!state.sourceProvider)
    throw new DomainError("SOURCE_UNAVAILABLE", "GitHub source provider is not configured", 503);
  const result = structuredClone(
    await state.sourceProvider.resolve(manifest.repository, {
      branch: manifest.source.branch,
      pullRequestNumber: manifest.source.pullRequestNumber,
    }),
  );
  validateSourceEvidence(state, manifest, result, requireOpen);
  return result;
}
export function deliveryScope(
  context: ExecutionContext,
  manifest: DeliveryManifest,
  hash: string,
  generation: number,
): DeliveryScope {
  return {
    projectId: context.projectId,
    environmentId: context.environmentId,
    preparationId: manifest.preparationId,
    runId: context.runId,
    manifestHash: hash,
    epoch: context.epoch,
    generation,
    ownership: manifest.ownership,
  };
}
