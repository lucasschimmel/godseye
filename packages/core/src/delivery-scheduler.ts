import { schema } from "@godseye/store";
import { eq } from "drizzle-orm";
import { admitDelivery } from "./delivery-admission.js";
import { prepareDelivery } from "./delivery-preparation.js";
import { markPreviewClosing, previewFor } from "./delivery-preview.js";
import {
  type DeliveryState,
  deliveryActor,
  deliveryPreparationView,
  freshDeliveryOwner,
  validateDeliveryPolicy,
} from "./delivery-state.js";
import { DomainError } from "./errors.js";
import { fingerprint, write } from "./journal.js";
import { type Actor, assertOwner } from "./policy.js";

export async function synchronizeDelivery(
  state: DeliveryState,
  actor: Actor,
  policyId: string,
  key: string,
  delegated = false,
) {
  if (!delegated) freshDeliveryOwner(state, actor);
  const policy = await validateDeliveryPolicy(state, state.store.db, policyId);
  const ciRuns = await state.store.db
    .select()
    .from(schema.ciRuns)
    .where(eq(schema.ciRuns.projectId, policy.projectId));
  const preparations = await state.store.db
    .select()
    .from(schema.deliveryPreparations)
    .where(eq(schema.deliveryPreparations.policyId, policy.id));
  const prepared: string[] = [];
  let blocked = 0;
  for (const ci of ciRuns.slice(-1000)) {
    if (ci.status !== "pending_verification" && ci.eventAction !== "closed") continue;
    const intent = ci.eventAction === "closed" ? "cleanup" : "build";
    const existing = preparations.find((row) => row.ciRunId === ci.id && row.intent === intent);
    if (existing) {
      prepared.push(existing.id);
      continue;
    }
    try {
      const row = await prepareDelivery(
        state,
        actor,
        { policyId, ciRunId: ci.id, intent },
        `delivery:sync:${fingerprint({ actorId: actor.id, key, policyId, ciRunId: ci.id, intent })}`,
        delegated,
      );
      prepared.push(row.id);
      if (intent === "cleanup")
        await write(state.store, (tx) => markPreviewClosing(state, tx, row.environmentId));
    } catch (error) {
      if (!(error instanceof DomainError)) throw error;
      blocked++;
      if (["STALE_HEAD", "SOURCE_REJECTED"].includes(error.code))
        await write(state.store, async (tx) => {
          await tx
            .update(schema.ciRuns)
            .set({ status: "superseded", errorCode: error.code, updatedAt: state.now() })
            .where(eq(schema.ciRuns.id, ci.id));
        });
    }
  }
  return { prepared, blocked };
}
export async function cleanupExpiredDelivery(
  state: DeliveryState,
  actor: Actor,
  key: string,
  delegated = false,
) {
  if (!delegated) {
    assertOwner(actor);
    freshDeliveryOwner(state, actor);
  }
  const previews = await state.store.db.select().from(schema.deliveryPreviews);
  const preparations = await state.store.db.select().from(schema.deliveryPreparations);
  const prepared: string[] = [];
  let blocked = 0;
  for (const preview of previews) {
    if (preview.state === "retired" || preview.expiresAt.getTime() > state.now().getTime())
      continue;
    const previous = preparations.find((row) => row.environmentId === preview.environmentId);
    if (!previous) continue;
    try {
      await write(state.store, async (tx) => {
        const current = await previewFor(tx, preview.environmentId);
        if (current?.state !== "cleanup-required")
          await markPreviewClosing(state, tx, preview.environmentId);
      });
      const existing = preparations.find(
        (row) =>
          row.environmentId === preview.environmentId &&
          row.intent === "cleanup" &&
          row.manifest.cleanupReason === "ttl",
      );
      const result = existing
        ? deliveryPreparationView(existing)
        : await prepareDelivery(
            state,
            delegated ? deliveryActor(preview.projectId) : actor,
            { policyId: preview.policyId, ciRunId: previous.ciRunId, intent: "cleanup" },
            `delivery:cleanup:${fingerprint({ actorId: actor.id, key, previewId: preview.id })}`,
            delegated,
          );
      prepared.push(result.id);
    } catch (error) {
      if (!(error instanceof DomainError)) throw error;
      blocked++;
    }
  }
  return { prepared, blocked };
}
/** Standing policy creates durable plans; Foundation remains the sole physical consumer. */
export async function deliverySchedulerTick(state: DeliveryState) {
  await cleanupExpiredDelivery(
    state,
    { id: "delivery-cleaner", kind: "service", projectIds: [] },
    "delivery:expired-previews",
    true,
  );
  if (!state.provider) return false;
  const policies = await state.store.db.select().from(schema.deliveryPolicies);
  for (const policy of policies) {
    if (
      !state.sourceProvider ||
      !policy.input.autoDeploy ||
      policy.revokedAt ||
      Date.parse(policy.input.expiresAt) <= state.now().getTime()
    )
      continue;
    try {
      await synchronizeDelivery(
        state,
        deliveryActor(policy.projectId),
        policy.id,
        `delivery:sync:${policy.id}`,
        true,
      );
    } catch (error) {
      if (!(error instanceof DomainError)) throw error;
    }
  }
  let preparations = await state.store.db.select().from(schema.deliveryPreparations);
  const artifacts = await state.store.db.select().from(schema.deliveryArtifacts);
  const runs = await state.store.db.select().from(schema.deliveryRuns);
  for (const artifact of artifacts) {
    if (!state.sourceProvider) break;
    const build = preparations.find((row) => row.id === artifact.preparationId);
    const policy = policies.find((row) => row.id === build?.policyId);
    if (
      !build ||
      !policy?.input.autoDeploy ||
      !runs.some((row) => row.preparationId === build.id && row.state === "built") ||
      preparations.some((row) => row.intent === "release" && row.artifactId === artifact.id)
    )
      continue;
    try {
      await prepareDelivery(
        state,
        deliveryActor(build.projectId),
        {
          policyId: build.policyId,
          ciRunId: build.ciRunId,
          intent: "release",
          artifactId: artifact.id,
        },
        `delivery:release:${artifact.id}`,
        true,
      );
    } catch (error) {
      if (!(error instanceof DomainError)) throw error;
    }
  }
  preparations = await state.store.db.select().from(schema.deliveryPreparations);
  let admitted = false;
  for (const row of preparations) {
    const policy = policies.find((item) => item.id === row.policyId);
    if (
      (!state.sourceProvider && row.intent !== "cleanup") ||
      runs.some((run) => run.preparationId === row.id) ||
      row.intent === "rollback" ||
      (!policy?.input.autoDeploy && row.intent !== "cleanup")
    )
      continue;
    try {
      await admitDelivery(
        state,
        deliveryActor(row.projectId),
        { preparationId: row.id, expectedHash: row.hash },
        `delivery:auto:${row.id}`,
        true,
      );
      admitted = true;
    } catch (error) {
      if (!(error instanceof DomainError)) throw error;
    }
  }
  return admitted;
}
