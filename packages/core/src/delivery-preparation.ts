import { randomUUID } from "node:crypto";
import {
  DEFAULT_SCAN_THRESHOLD,
  DELIVERY_POLICY_VERSION,
  type MigrationBindingView,
  PrepareDelivery,
  type PrepareDeliveryInput,
} from "@godseye/contracts";
import { schema } from "@godseye/store";
import { eq } from "drizzle-orm";
import { BuildObservation, deliveryConfigurationHash } from "./delivery-evidence.js";
import { assertRollbackMigrationCompatible } from "./delivery-migration.js";
import { previewEnvironment, previewFor } from "./delivery-preview.js";
import type { DeliveryManifest } from "./delivery-provider.js";
import { assertScanGate } from "./delivery-scan.js";
import {
  DELIVERY_SCHEDULER_ID,
  type DeliveryState,
  deliveryPreparationFor,
  deliveryPreparationView,
  freshDeliveryOwner,
  validateDeliveryPolicy,
  verifyDeliverySource,
} from "./delivery-state.js";
import { DomainError, parseInput } from "./errors.js";
import { environmentFor, foundationState, recordRequest, requestFor } from "./foundation-data.js";
import { immutableSnapshot } from "./infra-policy.js";
import { appendAudit, fingerprint, write } from "./journal.js";
import type { Actor } from "./policy.js";

export async function prepareDelivery(
  state: DeliveryState,
  actorInput: Actor,
  input: PrepareDeliveryInput,
  key: string,
  delegated = false,
) {
  const actor = immutableSnapshot(actorInput),
    data = parseInput(PrepareDelivery, input);
  if (!delegated) freshDeliveryOwner(state, actor);
  const policy = await validateDeliveryPolicy(
    state,
    state.store.db,
    data.policyId,
    data.intent === "cleanup",
  );
  if (
    delegated &&
    (actor.id !== DELIVERY_SCHEDULER_ID ||
      actor.kind !== "service" ||
      !actor.projectIds.includes(policy.projectId) ||
      (!policy.input.autoDeploy && data.intent !== "cleanup") ||
      data.intent === "rollback")
  )
    throw new DomainError(
      "FORBIDDEN",
      "Standing authority cannot perform this delivery action",
      403,
    );
  const [ci] = await state.store.db
    .select()
    .from(schema.ciRuns)
    .where(eq(schema.ciRuns.id, data.ciRunId));
  if (
    !ci ||
    ci.projectId !== policy.projectId ||
    !ci.repositorySnapshot ||
    fingerprint(ci.repositorySnapshot) !== fingerprint(policy.repository)
  )
    throw new DomainError(
      "SOURCE_REJECTED",
      "CI event is outside the exact retained source binding",
      409,
    );
  const id = randomUUID();
  const preliminary: DeliveryManifest = {
    policyVersion: DELIVERY_POLICY_VERSION,
    preparationId: id,
    policyId: policy.id,
    policyHash: policy.hash,
    projectId: policy.projectId,
    environmentId: policy.environmentId,
    projectRevision: policy.input.expectedProjectRevision,
    environmentRevision: policy.input.expectedEnvironmentRevision,
    ciRunId: ci.id,
    repository: policy.repository,
    source: { branch: ci.branch, pullRequestNumber: ci.pullRequestNumber, commitSha: ci.commitSha },
    intent: data.intent,
    artifactId: data.artifactId ?? null,
    artifactDigest: null,
    deploymentId: data.deploymentId ?? null,
    recipe: policy.input.recipe,
    requiredChecks: policy.input.requiredChecks,
    maxArtifactMiB: policy.input.maxArtifactMiB,
    limits: policy.input.limits,
    binding: state.provider?.binding ? structuredClone(state.provider.binding) : null,
    syntheticDataOnly: ci.pullRequestNumber !== null,
    ownership: "",
    expectedTargetGeneration: 0,
    cleanupReason: null,
    previousScope: null,
    scanThreshold: policy.input.scanThreshold ?? DEFAULT_SCAN_THRESHOLD,
    migration: null,
  };
  let cleanupReason: "ttl" | "closed" | null = null;
  if (data.intent === "cleanup") {
    const previews = await state.store.db
      .select()
      .from(schema.deliveryPreviews)
      .where(eq(schema.deliveryPreviews.policyId, policy.id));
    const preview = previews.find(
      (row) => row.pullRequestNumber === ci.pullRequestNumber && row.state !== "retired",
    );
    if (!preview)
      throw new DomainError("FORBIDDEN", "Only an owned ephemeral preview can be stopped", 403);
    if (preview.expiresAt.getTime() <= state.now().getTime()) cleanupReason = "ttl";
    else {
      const current = await verifyDeliverySource(state, preliminary, false);
      if (current.pullRequestOpen)
        throw new DomainError("PREVIEW_OPEN", "Current GitHub pull request remains open", 409);
      cleanupReason = "closed";
    }
  } else await verifyDeliverySource(state, preliminary);
  return write(state.store, async (tx) => {
    const receipt = await requestFor(tx, actor, key, "delivery.prepare", data);
    if (receipt.existing)
      return deliveryPreparationView(
        (await deliveryPreparationFor(tx, receipt.existing.resourceId)).row,
      );
    const currentPolicy = await validateDeliveryPolicy(
      state,
      tx,
      policy.id,
      data.intent === "cleanup",
    );
    let environmentId = policy.environmentId;
    if (ci.pullRequestNumber !== null) {
      if (data.intent === "cleanup") {
        const previews = await tx
          .select()
          .from(schema.deliveryPreviews)
          .where(eq(schema.deliveryPreviews.policyId, policy.id));
        const preview = previews.find(
          (row) => row.pullRequestNumber === ci.pullRequestNumber && row.state !== "retired",
        );
        if (!preview)
          throw new DomainError(
            "PREVIEW_CLOSED",
            "Preview no longer retains runtime authority",
            409,
          );
        environmentId = preview.environmentId;
      } else environmentId = await previewEnvironment(state, tx, currentPolicy, ci);
    }
    const environment = await environmentFor(
      tx,
      actor,
      policy.projectId,
      environmentId,
      false,
      data.intent === "cleanup",
      state.now(),
    );
    const preview = await previewFor(tx, environmentId);
    if (
      data.intent !== "cleanup" &&
      ((environment.expiresAt && environment.expiresAt.getTime() <= state.now().getTime()) ||
        (preview && ["cleanup-required", "unknown", "retired"].includes(preview.state)))
    )
      throw new DomainError("PREVIEW_CLOSED", "Preview is expired, closing or uncertain", 409);
    const [target] = await tx
      .select()
      .from(schema.deliveryTargets)
      .where(eq(schema.deliveryTargets.environmentId, environmentId));
    let artifactId = data.artifactId ?? null,
      artifactDigest: string | null = null,
      deploymentId = data.deploymentId ?? null,
      migration: MigrationBindingView | null = null;
    if (data.intent === "rollback") {
      if (!deploymentId)
        throw new DomainError(
          "ARTIFACT_REQUIRED",
          "Rollback requires an eligible prior deployment",
          422,
        );
      const [prior] = await tx
        .select()
        .from(schema.deliveryRuns)
        .where(eq(schema.deliveryRuns.id, deploymentId));
      if (
        !prior ||
        prior.projectId !== policy.projectId ||
        prior.environmentId !== environmentId ||
        !prior.artifactId ||
        !prior.evidence ||
        !["active", "retired"].includes(prior.state)
      )
        throw new DomainError(
          "ROLLBACK_REJECTED",
          "Prior release is not an inspected compatible deployment",
          409,
        );
      await assertRollbackMigrationCompatible(tx, prior);
      artifactId = prior.artifactId;
    }
    if (["release", "rollback"].includes(data.intent)) {
      if (!artifactId)
        throw new DomainError(
          "ARTIFACT_REQUIRED",
          "Release requires a trusted built artifact",
          422,
        );
      const [artifact] = await tx
        .select()
        .from(schema.deliveryArtifacts)
        .where(eq(schema.deliveryArtifacts.id, artifactId));
      if (
        !artifact ||
        artifact.projectId !== policy.projectId ||
        artifact.environmentId !== environmentId ||
        artifact.metadata.recipeHash !== fingerprint(policy.input.recipe) ||
        (data.intent === "release" && artifact.metadata.ciRunId !== ci.id)
      )
        throw new DomainError(
          "ARTIFACT_REJECTED",
          "Artifact belongs to another source, recipe or cell",
          409,
        );
      const evidence = BuildObservation.safeParse(artifact.providerEvidence);
      if (
        !evidence.success ||
        evidence.data.configurationHash !== deliveryConfigurationHash(preliminary) ||
        policy.input.requiredChecks.some(
          (name) =>
            !evidence.data.checks.some((check) => check.name === name && check.passed === true),
        )
      )
        throw new DomainError(
          "ARTIFACT_REJECTED",
          "Artifact does not satisfy the current configuration and required checks",
          409,
        );
      assertScanGate(evidence.data.scanner, preliminary.scanThreshold ?? DEFAULT_SCAN_THRESHOLD);
      if (data.intent === "release") migration = evidence.data.migration;
      artifactDigest = artifact.metadata.digest;
    }
    if (data.intent === "cleanup") {
      if (!preview || environment.kind !== "preview")
        throw new DomainError(
          "FORBIDDEN",
          "Standard and recovery environments cannot be cleaned up",
          403,
        );
      deploymentId = target?.activeDeploymentId ?? null;
      if (deploymentId) {
        const [active] = await tx
          .select()
          .from(schema.deliveryRuns)
          .where(eq(schema.deliveryRuns.id, deploymentId));
        artifactId = active?.artifactId ?? null;
        const [artifact] = artifactId
          ? await tx
              .select()
              .from(schema.deliveryArtifacts)
              .where(eq(schema.deliveryArtifacts.id, artifactId))
          : [];
        artifactDigest = artifact?.metadata.digest ?? null;
      }
    }
    if (data.intent === "build" && (artifactId || deploymentId))
      throw new DomainError(
        "INVALID_INPUT",
        "Build cannot accept artifact or deployment references",
        422,
      );
    let previousScope: DeliveryManifest["previousScope"] = null;
    let retainedBinding = preliminary.binding;
    if (target?.activeDeploymentId) {
      const [active] = await tx
        .select()
        .from(schema.deliveryRuns)
        .where(eq(schema.deliveryRuns.id, target.activeDeploymentId));
      const [execution] = active
        ? await tx
            .select()
            .from(schema.executionRuns)
            .where(eq(schema.executionRuns.id, active.runId))
        : [];
      const prior = active ? await deliveryPreparationFor(tx, active.preparationId) : null;
      if (!active || !execution || !prior)
        throw new DomainError("JOURNAL_INCONSISTENT", "Active delivery mapping is incomplete", 500);
      if (data.intent === "cleanup") retainedBinding = prior.manifest.binding;
      else if (fingerprint(prior.manifest.binding) !== fingerprint(preliminary.binding))
        throw new DomainError(
          "CAPABILITY_UNAVAILABLE",
          "Provider changes require explicit migration of the retained active runtime",
          503,
        );
      previousScope = {
        projectId: active.projectId,
        environmentId: active.environmentId,
        preparationId: active.preparationId,
        runId: active.runId,
        manifestHash: prior.row.hash,
        epoch: execution.epoch,
        generation: active.generation,
        ownership: prior.manifest.ownership,
      };
    }
    if (data.intent === "cleanup" && !previousScope) {
      const preparations = await tx
        .select()
        .from(schema.deliveryPreparations)
        .where(eq(schema.deliveryPreparations.environmentId, environmentId));
      const original = preparations.find(
        (item) => item.policyId === policy.id && item.intent !== "cleanup",
      );
      if (original)
        retainedBinding = (await deliveryPreparationFor(tx, original.id)).manifest.binding;
    }
    const [currentProject] = await tx
      .select()
      .from(schema.projects)
      .where(eq(schema.projects.id, policy.projectId));
    const manifest: DeliveryManifest = immutableSnapshot({
      ...preliminary,
      environmentId,
      projectRevision:
        data.intent === "cleanup"
          ? (currentProject?.revision ?? preliminary.projectRevision)
          : preliminary.projectRevision,
      environmentRevision: environment.revision,
      artifactId,
      artifactDigest,
      deploymentId,
      previousScope,
      binding: retainedBinding,
      expectedTargetGeneration: target?.generation ?? 0,
      cleanupReason,
      migration,
      ownership: fingerprint({ projectId: policy.projectId, environmentId, policyId: policy.id }),
    });
    const row = {
      id,
      policyId: policy.id,
      projectId: policy.projectId,
      environmentId,
      ciRunId: ci.id,
      intent: data.intent,
      commitSha: ci.commitSha,
      artifactId,
      deploymentId,
      manifest: manifest as unknown as Record<string, unknown>,
      hash: fingerprint(manifest),
      createdAt: state.now(),
    };
    await tx.insert(schema.deliveryPreparations).values(row);
    await tx.insert(schema.resources).values({
      id,
      projectId: policy.projectId,
      environmentId,
      kind: "manifest",
      name: `Delivery ${data.intent} ${row.hash.slice(0, 12)}`,
      createdAt: state.now(),
    });
    await recordRequest(
      tx,
      foundationState(state.store, { now: state.now }),
      key,
      receipt.digest,
      id,
      "delivery.prepare",
    );
    await appendAudit(
      tx,
      actor,
      policy.projectId,
      "delivery.prepared",
      `Prepared exact ${data.intent} for source ${ci.commitSha.slice(0, 12)}; no provider mutation`,
    );
    return deliveryPreparationView(row);
  });
}
