import { randomUUID } from "node:crypto";
import { AdmitDelivery, type AdmitDeliveryInput } from "@godseye/contracts";
import { type DatabaseAccess, schema } from "@godseye/store";
import { eq } from "drizzle-orm";
import { deliveryDelegatedAuthority } from "./delivery-authority.js";
import { deliveryTargetFor } from "./delivery-capacity.js";
import { previewFor } from "./delivery-preview.js";
import type { DeliveryManifest } from "./delivery-provider.js";
import {
  DELIVERY_ADAPTER_ID,
  DELIVERY_DESTINATION,
  type DeliveryState,
  deliveryActor,
  deliveryPreparationFor,
  deliveryRunView,
  freshDeliveryOwner,
  qualifyDelivery,
  validateDeliveryPolicy,
  verifyDeliverySource,
} from "./delivery-state.js";
import { DomainError, parseInput } from "./errors.js";
import {
  currentEpoch,
  environmentFor,
  foundationState,
  recordRequest,
  requestFor,
} from "./foundation-data.js";
import { immutableSnapshot } from "./infra-policy.js";
import {
  inventoryFor,
  observationReasons,
  validateEnvironmentCapacity,
  validatePoolCapacity,
} from "./infra-state.js";
import { appendAudit, fingerprint, write } from "./journal.js";
import type { Actor } from "./policy.js";

export async function validateDeliveryManifest(
  state: DeliveryState,
  tx: DatabaseAccess,
  manifest: DeliveryManifest,
  reserve = false,
  allowUncertainPreview = false,
) {
  const policy = await validateDeliveryPolicy(
    state,
    tx,
    manifest.policyId,
    manifest.intent === "cleanup",
  );
  const env = await environmentFor(
    tx,
    deliveryActor(manifest.projectId),
    manifest.projectId,
    manifest.environmentId,
    false,
    manifest.intent === "cleanup" || allowUncertainPreview,
    state.now(),
  );
  if (
    policy.hash !== manifest.policyHash ||
    fingerprint(state.provider?.binding ?? null) !== fingerprint(manifest.binding) ||
    env.revision !== manifest.environmentRevision
  )
    throw new DomainError(
      "FENCED",
      "Delivery authority, provider or environment revision changed",
      409,
    );
  const preview = await previewFor(tx, env.id);
  if (
    manifest.intent !== "cleanup" &&
    ((env.expiresAt && env.expiresAt.getTime() <= state.now().getTime()) ||
      (preview &&
        (["cleanup-required", "retired"].includes(preview.state) ||
          (preview.state === "unknown" && !allowUncertainPreview))))
  )
    throw new DomainError("PREVIEW_CLOSED", "Preview cannot receive deployment authority", 409);
  if (
    manifest.syntheticDataOnly !== (preview !== null) ||
    (preview && preview.policyId !== policy.id)
  )
    throw new DomainError("FORBIDDEN", "Preview lineage differs from delivery authority", 403);
  if (manifest.intent === "cleanup") {
    if (
      !preview ||
      env.kind !== "preview" ||
      !manifest.cleanupReason ||
      (manifest.cleanupReason === "ttl" && preview.expiresAt.getTime() > state.now().getTime())
    )
      throw new DomainError(
        "FORBIDDEN",
        "Cleanup lacks exact expired or closed preview authority",
        403,
      );
    return;
  }
  const proof = state.qualification;
  if (!proof || Date.parse(proof.expiresAt) <= state.now().getTime())
    throw new DomainError("CAPABILITY_UNAVAILABLE", "Delivery capability observation expired", 503);
  if (reserve) {
    const inventory = await inventoryFor(tx);
    if (
      !inventory.desired ||
      !inventory.observation ||
      observationReasons(inventory.observation, state.now()).length ||
      inventory.observation.providerBinding?.targetId !== state.provider?.binding.targetId
    )
      throw new DomainError(
        "CAPABILITY_UNAVAILABLE",
        "Qualified professional capacity and exact delivery target are required",
        503,
      );
    await validatePoolCapacity(tx, inventory.desired, inventory.observation, manifest.limits);
    await validateEnvironmentCapacity(tx, env.id, manifest.limits);
  }
}
export async function admitDelivery(
  state: DeliveryState,
  actorInput: Actor,
  input: AdmitDeliveryInput,
  key: string,
  delegated = false,
) {
  const actor = immutableSnapshot(actorInput),
    data = parseInput(AdmitDelivery, input);
  if (!delegated) freshDeliveryOwner(state, actor);
  const { row, manifest } = await deliveryPreparationFor(state.store.db, data.preparationId);
  if (row.hash !== data.expectedHash)
    throw new DomainError("PLAN_TAMPERED", "Exact delivery preparation hash is required", 409);
  await qualifyDelivery(state);
  if (manifest.intent !== "cleanup") await verifyDeliverySource(state, manifest);
  else if (manifest.cleanupReason === "closed") {
    const source = await verifyDeliverySource(state, manifest, false);
    if (source.pullRequestOpen)
      throw new DomainError("PREVIEW_OPEN", "Pull request reopened before cleanup", 409);
  }
  const prefix = `delivery:${fingerprint({ actorId: actor.id, key, data })}`;
  const plan = await state.foundation.createPlan(
    actor,
    {
      projectId: row.projectId,
      environmentId: row.environmentId,
      targetId: row.id,
      expectedRevision: manifest.projectRevision,
      adapterId: DELIVERY_ADAPTER_ID,
      command: {
        kind: "delivery.lifecycle",
        intent: row.intent,
        manifestRef: row.id,
        manifestHash: row.hash,
      },
      maxCostMicros: 0,
      tools: [`delivery.${row.intent}`],
      destinations: [DELIVERY_DESTINATION],
    },
    `${prefix}:plan`,
  );
  await write(state.store, async (tx) => {
    const receipt = await requestFor(tx, actor, key, "delivery.admit", data);
    if (receipt.existing) return;
    await validateDeliveryManifest(state, tx, manifest);
    await tx.insert(schema.deliveryCommands).values({
      planId: plan.id,
      preparationId: row.id,
      epoch: await currentEpoch(tx, row.environmentId),
      authority: delegated ? "policy" : "owner",
    });
    await recordRequest(
      tx,
      foundationState(state.store, { now: state.now }),
      key,
      receipt.digest,
      row.id,
      "delivery.admit",
      false,
    );
  });
  if (!delegated) {
    freshDeliveryOwner(state, actor);
    await state.foundation.approve(actor, plan.id, plan.hash, `${prefix}:approve`);
  }
  const queued = await state.foundation.enqueue(actor, plan.id, `${prefix}:enqueue`);
  const [run] = await state.store.db
    .select()
    .from(schema.deliveryRuns)
    .where(eq(schema.deliveryRuns.runId, queued.id));
  if (!run) throw new DomainError("JOURNAL_INCONSISTENT", "Delivery reservation is missing", 500);
  return deliveryRunView(run);
}
export async function reserveDelivery(
  state: DeliveryState,
  tx: DatabaseAccess,
  plan: typeof schema.executionPlans.$inferSelect,
  runId: string,
  actor: Actor,
) {
  if (plan.adapterId !== DELIVERY_ADAPTER_ID) {
    if (plan.command.kind === "delivery.lifecycle")
      throw new DomainError("FORBIDDEN", "Delivery requires its private admission adapter", 403);
    return;
  }
  if (plan.command.kind !== "delivery.lifecycle")
    throw new DomainError(
      "FORBIDDEN",
      "Delivery adapter only accepts compiled delivery commands",
      403,
    );
  const [authorization] = await tx
    .select()
    .from(schema.deliveryCommands)
    .where(eq(schema.deliveryCommands.planId, plan.id));
  const { row, manifest } = await deliveryPreparationFor(tx, plan.command.manifestRef);
  if (
    !authorization ||
    authorization.preparationId !== row.id ||
    authorization.epoch !== (await currentEpoch(tx, row.environmentId)) ||
    plan.command.manifestHash !== row.hash ||
    plan.command.intent !== row.intent ||
    plan.projectId !== row.projectId ||
    plan.environmentId !== row.environmentId ||
    plan.targetId !== row.id ||
    plan.expectedRevision !== manifest.projectRevision ||
    plan.maxCostMicros !== 0 ||
    fingerprint(plan.tools) !== fingerprint([`delivery.${row.intent}`]) ||
    fingerprint(plan.destinations) !== fingerprint([DELIVERY_DESTINATION])
  )
    throw new DomainError(
      "FORBIDDEN",
      "Generic Foundation admission cannot broaden delivery authority",
      403,
    );
  if (authorization.authority === "owner") freshDeliveryOwner(state, actor);
  else if (!(await deliveryDelegatedAuthority(state, tx, plan, "enqueue", actor)))
    throw new DomainError("POLICY_REVOKED", "Standing authority is no longer valid", 409);
  await validateDeliveryManifest(state, tx, manifest, true);
  const target = await deliveryTargetFor(tx, row.environmentId);
  if (target.pendingRunId || target.generation !== manifest.expectedTargetGeneration)
    throw new DomainError(
      "DELIVERY_BUSY",
      "Target retains another delivery or a newer generation",
      409,
    );
  const generation = target.generation + 1;
  await tx
    .insert(schema.deliveryTargets)
    .values({ ...target, generation, pendingRunId: runId })
    .onConflictDoUpdate({
      target: schema.deliveryTargets.environmentId,
      set: { generation, pendingRunId: runId },
    });
  await tx.insert(schema.deliveryRuns).values({
    id: randomUUID(),
    preparationId: row.id,
    runId,
    projectId: row.projectId,
    environmentId: row.environmentId,
    intent: row.intent,
    state: "reserved",
    artifactId: row.artifactId,
    previousDeploymentId: target.activeDeploymentId,
    generation,
    reason: null,
    evidence: null,
    updatedAt: state.now(),
  });
  await appendAudit(
    tx,
    actor,
    row.projectId,
    "delivery.reserved",
    `Reserved exact target generation ${generation}; prior traffic and uncertainty remain retained`,
  );
}
