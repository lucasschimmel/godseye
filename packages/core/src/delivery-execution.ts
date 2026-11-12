import { randomUUID } from "node:crypto";
import {
  DeliveryArtifact,
  type EffectOutcomeInput,
  type ExecutionContext,
} from "@godseye/contracts";
import { schema } from "@godseye/store";
import { and, eq } from "drizzle-orm";
import { validateDeliveryManifest } from "./delivery-admission.js";
import {
  assertBuildEvidence,
  assertDeploymentInspection,
  deliveryConfigurationHash,
} from "./delivery-evidence.js";
import { deliveryDispatchGuard, deliveryExecutionGate } from "./delivery-execution-gate.js";
import { previewFor } from "./delivery-preview.js";
import type { BuildEvidence, DeploymentInspection } from "./delivery-provider.js";
import {
  type DeliveryState,
  deliveryActor,
  deliveryPreparationFor,
  qualifyDelivery,
} from "./delivery-state.js";
import { DomainError } from "./errors.js";
import { currentEpoch } from "./foundation-data.js";
import { immutableSnapshot } from "./infra-policy.js";
import { appendAudit, fingerprint, write } from "./journal.js";

type Gate = Awaited<ReturnType<typeof deliveryExecutionGate>>;
async function intention(state: DeliveryState, context: ExecutionContext, step: string) {
  return write(state.store, async (tx) => {
    const gate = await deliveryExecutionGate(state, tx, context);
    const [existing] = await tx
      .select()
      .from(schema.deliverySteps)
      .where(
        and(eq(schema.deliverySteps.runId, context.runId), eq(schema.deliverySteps.step, step)),
      );
    if (existing)
      throw new DomainError(
        "RECONCILIATION_REQUIRED",
        "Existing delivery intention must be inspected before retry",
        409,
      );
    await tx.insert(schema.deliverySteps).values({
      id: randomUUID(),
      runId: context.runId,
      step,
      state: "intended",
      scopeHash: fingerprint(gate.scope),
      evidence: null,
      createdAt: state.now(),
    });
    await appendAudit(
      tx,
      deliveryActor(context.projectId),
      context.projectId,
      "delivery.intended",
      `Durable ${step} intention for exact delivery ${gate.delivery.id}`,
    );
    return gate;
  });
}
async function recordBuild(
  state: DeliveryState,
  context: ExecutionContext,
  result: BuildEvidence | null,
  readOnly: boolean,
) {
  await write(state.store, async (tx) => {
    const gate = await deliveryExecutionGate(state, tx, context, readOnly);
    assertBuildEvidence(result, gate.scope, gate.manifest);
    const [existing] = await tx
      .select()
      .from(schema.deliveryArtifacts)
      .where(eq(schema.deliveryArtifacts.preparationId, gate.preparation.id));
    const metadata = DeliveryArtifact.parse({
      id: existing?.id ?? randomUUID(),
      preparationId: gate.preparation.id,
      projectId: context.projectId,
      environmentId: context.environmentId,
      ciRunId: gate.manifest.ciRunId,
      commitSha: result.commitSha,
      digest: result.digest,
      sizeBytes: result.sizeBytes,
      recipeHash: result.recipeHash,
      checks: result.checks,
      scan: result.scan,
      provenanceHash: result.provenanceHash,
      createdAt: existing?.metadata.createdAt ?? state.now().toISOString(),
    });
    if (existing && fingerprint(existing.providerEvidence) !== fingerprint(result))
      throw new DomainError(
        "ARTIFACT_REJECTED",
        "Retained immutable artifact evidence changed",
        409,
      );
    if (!existing)
      await tx.insert(schema.deliveryArtifacts).values({
        id: metadata.id,
        preparationId: gate.preparation.id,
        projectId: context.projectId,
        environmentId: context.environmentId,
        metadata,
        providerEvidence: result as unknown as Record<string, unknown>,
      });
    await tx
      .update(schema.deliveryRuns)
      .set({ artifactId: metadata.id, evidence: fingerprint(result), updatedAt: state.now() })
      .where(eq(schema.deliveryRuns.id, gate.delivery.id));
    await tx
      .update(schema.deliverySteps)
      .set({ state: "observed", evidence: fingerprint(result) })
      .where(
        and(eq(schema.deliverySteps.runId, context.runId), eq(schema.deliverySteps.step, "build")),
      );
  });
}
async function artifactFor(state: DeliveryState, gate: Gate) {
  const [artifact] = await state.store.db
    .select()
    .from(schema.deliveryArtifacts)
    .where(
      eq(
        schema.deliveryArtifacts.id,
        gate.manifest.artifactId ?? "00000000-0000-4000-8000-000000000000",
      ),
    );
  if (
    !artifact ||
    artifact.projectId !== gate.manifest.projectId ||
    artifact.environmentId !== gate.manifest.environmentId ||
    artifact.metadata.digest !== gate.manifest.artifactDigest ||
    artifact.metadata.recipeHash !== fingerprint(gate.manifest.recipe)
  )
    throw new DomainError(
      "ARTIFACT_REJECTED",
      "Exact trusted deployment artifact is unavailable",
      409,
    );
  const original = await deliveryPreparationFor(state.store.db, artifact.preparationId);
  const evidence = immutableSnapshot(artifact.providerEvidence as unknown as BuildEvidence);
  assertBuildEvidence(evidence, evidence.scope, original.manifest);
  if (
    evidence.provenanceHash !== artifact.metadata.provenanceHash ||
    evidence.digest !== artifact.metadata.digest
  )
    throw new DomainError("ARTIFACT_REJECTED", "Immutable artifact provenance changed", 409);
  if (
    evidence.configurationHash !== deliveryConfigurationHash(gate.manifest) ||
    gate.manifest.requiredChecks.some(
      (name) => !evidence.checks.some((check) => check.name === name && check.passed === true),
    )
  )
    throw new DomainError(
      "ARTIFACT_REJECTED",
      "Retained artifact does not satisfy the current configuration and check policy",
      409,
    );
  return artifact.metadata;
}
function previewUrl(state: DeliveryState, gate: Gate, inspection: DeploymentInspection) {
  if (!inspection.url) return null;
  const domain = state.provider?.binding.previewDomain;
  if (!domain)
    throw new DomainError("DEPLOYMENT_DRIFT", "Preview hostname authority is unconfigured", 409);
  const url = new URL(inspection.url);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.port ||
    url.pathname !== "/" ||
    url.search ||
    url.hash ||
    url.hostname !== `${gate.manifest.environmentId}.${domain}`
  )
    throw new DomainError(
      "DEPLOYMENT_DRIFT",
      "Preview URL does not match the trusted owned endpoint",
      409,
    );
  return url.href;
}
async function recordRuntime(
  state: DeliveryState,
  context: ExecutionContext,
  result: DeploymentInspection | null,
  readOnly: boolean,
) {
  await write(state.store, async (tx) => {
    const gate = await deliveryExecutionGate(state, tx, context, readOnly);
    assertDeploymentInspection(
      result,
      gate.scope,
      gate.manifest,
      gate.manifest.intent === "cleanup" ? { absent: true } : { active: true },
    );
    if (readOnly && gate.manifest.intent !== "cleanup") {
      await validateDeliveryManifest(state, tx, gate.manifest, false, true);
      if ((await currentEpoch(tx, context.environmentId)) !== context.epoch)
        throw new DomainError(
          "FENCED",
          "Observed release belongs to a prior activation epoch",
          409,
        );
    }
    await tx
      .update(schema.deliveryRuns)
      .set({ evidence: fingerprint(result), updatedAt: state.now() })
      .where(eq(schema.deliveryRuns.id, gate.delivery.id));
    const preview = await previewFor(tx, context.environmentId);
    if (preview)
      await tx
        .update(schema.deliveryPreviews)
        .set({
          state: gate.manifest.intent === "cleanup" ? "retired" : "active",
          url: gate.manifest.intent === "cleanup" ? null : previewUrl(state, gate, result),
          updatedAt: state.now(),
        })
        .where(eq(schema.deliveryPreviews.id, preview.id));
    await tx
      .update(schema.deliverySteps)
      .set({ state: "observed", evidence: fingerprint(result) })
      .where(eq(schema.deliverySteps.runId, context.runId));
  });
}
async function verifyPreviousAbsent(state: DeliveryState, gate: Gate) {
  const previous = gate.manifest.previousScope;
  if (!previous || !state.provider) return;
  const old = await deliveryPreparationFor(state.store.db, previous.preparationId);
  const observed = immutableSnapshot(await state.provider.inspect(previous, old.manifest));
  assertDeploymentInspection(observed, previous, old.manifest, { absent: true });
}
async function executePhysical(state: DeliveryState, context: ExecutionContext) {
  const provider = state.provider;
  if (!provider)
    throw new DomainError("CAPABILITY_UNAVAILABLE", "Delivery provider is unconfigured", 503);
  const guard = () => deliveryDispatchGuard(state, context);
  await guard();
  let gate = await write(state.store, (tx) => deliveryExecutionGate(state, tx, context));
  if (gate.manifest.intent === "build") {
    gate = await intention(state, context, "build");
    await provider.build(gate.scope, gate.manifest, guard);
    await guard();
    const result = immutableSnapshot(await provider.inspectBuild(gate.scope, gate.manifest));
    await guard();
    await recordBuild(state, context, result, false);
    return;
  }
  if (gate.manifest.intent === "cleanup") {
    gate = await intention(state, context, "cleanup");
    await provider.cleanup(gate.scope, gate.manifest, guard);
    await guard();
    const result = immutableSnapshot(await provider.inspect(gate.scope, gate.manifest));
    await guard();
    await recordRuntime(state, context, result, false);
    return;
  }
  const artifact = await artifactFor(state, gate);
  gate = await intention(state, context, "stage");
  await provider.stage(gate.scope, gate.manifest, artifact, guard);
  await guard();
  await intention(state, context, "readiness");
  const ready = immutableSnapshot(await provider.readiness(gate.scope, gate.manifest));
  await guard();
  assertDeploymentInspection(ready, gate.scope, gate.manifest);
  await intention(state, context, "promote");
  await provider.promote(gate.scope, gate.manifest, gate.manifest.previousScope, guard);
  await guard();
  const current = immutableSnapshot(await provider.inspect(gate.scope, gate.manifest));
  await verifyPreviousAbsent(state, gate);
  await guard();
  await recordRuntime(state, context, current, false);
}
async function reconcilePhysical(state: DeliveryState, context: ExecutionContext) {
  if (!state.provider)
    throw new DomainError("CAPABILITY_UNAVAILABLE", "Delivery provider is unconfigured", 503);
  await qualifyDelivery(state);
  const gate = await write(state.store, (tx) => deliveryExecutionGate(state, tx, context, true));
  if (gate.manifest.intent === "build") {
    const result = immutableSnapshot(await state.provider.inspectBuild(gate.scope, gate.manifest));
    await recordBuild(state, context, result, true);
  } else {
    const result = immutableSnapshot(await state.provider.inspect(gate.scope, gate.manifest));
    if (gate.manifest.intent !== "cleanup") {
      await verifyPreviousAbsent(state, gate);
      // Reconciliation only observes an already active physical release. It never calls promote.
      await verifyDeliverySourceForReconcile(state, gate);
    }
    await recordRuntime(state, context, result, true);
  }
}
async function verifyDeliverySourceForReconcile(state: DeliveryState, gate: Gate) {
  const { verifyDeliverySource } = await import("./delivery-state.js");
  await verifyDeliverySource(state, gate.manifest);
}
/** No provider exception, missing receipt or stale authority permits blind resubmission. */
export async function executeDelivery(
  state: DeliveryState,
  input: ExecutionContext,
  readOnly = false,
): Promise<EffectOutcomeInput> {
  const context = immutableSnapshot(input);
  try {
    if (readOnly) await reconcilePhysical(state, context);
    else await executePhysical(state, context);
    return { status: "succeeded", costMicros: 0, evidenceRef: `delivery:${context.runId}` };
  } catch (error) {
    const steps = await state.store.db
      .select()
      .from(schema.deliverySteps)
      .where(eq(schema.deliverySteps.runId, context.runId));
    await write(state.store, async (tx) => {
      await tx
        .update(schema.deliveryRuns)
        .set({
          state: steps.length ? "unknown" : "released",
          reason: error instanceof DomainError ? error.code : "PROVIDER_OUTCOME_UNCERTAIN",
          updatedAt: state.now(),
        })
        .where(eq(schema.deliveryRuns.runId, context.runId));
    });
    return {
      status: steps.length ? "unknown" : "failed",
      costMicros: 0,
      ...(steps.length ? {} : { evidenceRef: `delivery-no-dispatch:${context.runId}` }),
    };
  }
}
