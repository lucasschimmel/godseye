import { randomUUID } from "node:crypto";
import { type DatabaseAccess, schema } from "@godseye/store";
import { and, eq } from "drizzle-orm";
import { type DeliveryState, deliveryActor } from "./delivery-state.js";
import { DomainError } from "./errors.js";
import { appendAudit } from "./journal.js";

/** Create an empty/synthetic cell; never copy production DBs, files, identities or references. */
export async function previewEnvironment(
  state: DeliveryState,
  tx: DatabaseAccess,
  policy: typeof schema.deliveryPolicies.$inferSelect,
  ci: typeof schema.ciRuns.$inferSelect,
) {
  if (!ci.pullRequestNumber) return policy.environmentId;
  const rows = await tx
    .select()
    .from(schema.deliveryPreviews)
    .where(eq(schema.deliveryPreviews.projectId, policy.projectId));
  const existing = rows.find(
    (row) =>
      row.policyId === policy.id &&
      row.pullRequestNumber === ci.pullRequestNumber &&
      row.state !== "retired",
  );
  if (existing) {
    if (
      existing.state === "cleanup-required" ||
      existing.state === "unknown" ||
      existing.expiresAt.getTime() <= state.now().getTime()
    )
      throw new DomainError("PREVIEW_CLOSED", "Preview is expired, closing or uncertain", 409);
    return existing.environmentId;
  }
  const envs = await tx
    .select()
    .from(schema.environments)
    .where(eq(schema.environments.projectId, policy.projectId));
  const retained = rows.filter((row) => row.state !== "retired");
  if (
    retained.filter((row) => row.policyId === policy.id).length >=
      policy.input.maxConcurrentPreviews ||
    envs.filter(
      (env) =>
        env.kind === "preview" &&
        !rows.some((row) => row.environmentId === env.id && row.state === "retired"),
    ).length >= 8
  )
    throw new DomainError(
      "PREVIEW_LIMIT",
      "Preview count limit retains active and uncertain cells",
      409,
    );
  const environmentId = randomUUID(),
    now = state.now(),
    expiresAt = new Date(
      Math.min(
        Date.parse(policy.input.expiresAt),
        now.getTime() + policy.input.previewTtlHours * 3600000,
      ),
    );
  await tx.insert(schema.environments).values({
    id: environmentId,
    projectId: policy.projectId,
    kind: "preview",
    recoveryHold: false,
    name: `pr-${ci.pullRequestNumber}-${environmentId.slice(0, 8)}`,
    revision: 0,
    expiresAt,
    memoryMiB: policy.input.limits.memoryMiB * 2,
    cpuMilliCores: policy.input.limits.cpuMilliCores * 2,
    diskGiB: policy.input.limits.storageGiB * 2 + Math.ceil(policy.input.maxArtifactMiB / 1024),
  });
  await tx.insert(schema.deliveryPreviews).values({
    id: randomUUID(),
    policyId: policy.id,
    projectId: policy.projectId,
    environmentId,
    pullRequestNumber: ci.pullRequestNumber,
    state: "prepared",
    url: null,
    expiresAt,
    updatedAt: now,
  });
  await appendAudit(
    tx,
    deliveryActor(policy.projectId),
    policy.projectId,
    "delivery.preview.prepared",
    `Prepared synthetic-only PR ${ci.pullRequestNumber} cell ${environmentId}; no runtime or public URL`,
  );
  return environmentId;
}
export async function previewFor(tx: DatabaseAccess, environmentId: string) {
  const [row] = await tx
    .select()
    .from(schema.deliveryPreviews)
    .where(eq(schema.deliveryPreviews.environmentId, environmentId));
  return row ?? null;
}
export async function markPreviewClosing(
  state: DeliveryState,
  tx: DatabaseAccess,
  environmentId: string,
) {
  const preview = await previewFor(tx, environmentId);
  if (!preview || preview.state === "retired") return;
  await tx
    .update(schema.deliveryPreviews)
    .set({ state: "cleanup-required", url: null, updatedAt: state.now() })
    .where(eq(schema.deliveryPreviews.id, preview.id));
  // Fences pending generation at the delivery gate; ordinary platform authority is also stopped.
  const [epoch] = await tx
    .select()
    .from(schema.activationEpochs)
    .where(eq(schema.activationEpochs.environmentId, environmentId));
  await tx
    .insert(schema.activationEpochs)
    .values({ environmentId, epoch: (epoch?.epoch ?? 1) + 1 })
    .onConflictDoUpdate({
      target: schema.activationEpochs.environmentId,
      set: { epoch: (epoch?.epoch ?? 1) + 1 },
    });
  await tx
    .update(schema.taskGrants)
    .set({ revokedAt: state.now() })
    .where(and(eq(schema.taskGrants.environmentId, environmentId)));
}
