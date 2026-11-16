import { RedeployDelivery, type RedeployDeliveryInput } from "@godseye/contracts";
import { schema } from "@godseye/store";
import { and, eq, isNull } from "drizzle-orm";
import { prepareDelivery } from "./delivery-preparation.js";
import {
  type DeliveryState,
  deliveryPreparationFor,
  deliveryPreparationView,
  freshDeliveryOwner,
} from "./delivery-state.js";
import { DomainError, parseInput } from "./errors.js";
import { environmentFor } from "./foundation-data.js";
import { immutableSnapshot } from "./infra-policy.js";
import type { Actor } from "./policy.js";

const REDEPLOYABLE_KINDS = ["development", "production"];

/**
 * Re-releases the CURRENT release of an environment: same artifact and digest, never a new build.
 * The request only names the environment and the revision the owner was looking at; the artifact, policy
 * and CI event are resolved here from the delivery journal, then handed to the ordinary `release`
 * preparation so every existing gate (source head, required checks, scan, migration, provider binding)
 * still applies. The result is a prepared release that the owner admits through the usual admission step.
 */
export async function redeployDelivery(
  state: DeliveryState,
  actorInput: Actor,
  input: RedeployDeliveryInput,
  key: string,
) {
  const actor = immutableSnapshot(actorInput),
    data = parseInput(RedeployDelivery, input);
  freshDeliveryOwner(state, actor);
  const db = state.store.db;
  const [receipt] = await db
    .select()
    .from(schema.foundationRequests)
    .where(eq(schema.foundationRequests.key, key));
  if (receipt) {
    // Replay: the same key returns the preparation it already created, even if the release moved on since.
    if (receipt.kind !== "delivery.prepare")
      throw new DomainError("IDEMPOTENCY_CONFLICT", "This key identifies a different request", 409);
    const existing = await deliveryPreparationFor(db, receipt.resourceId);
    if (existing.row.environmentId !== data.environmentId || existing.row.intent !== "release")
      throw new DomainError("IDEMPOTENCY_CONFLICT", "This key identifies a different request", 409);
    return deliveryPreparationView(existing.row);
  }
  const [row] = await db
    .select()
    .from(schema.environments)
    .where(eq(schema.environments.id, data.environmentId));
  if (!row) throw new DomainError("NOT_FOUND", "Environment not found", 404);
  const environment = await environmentFor(
    db,
    actor,
    row.projectId,
    row.id,
    false,
    false,
    state.now(),
  );
  if (environment.revision !== data.expectedEnvironmentRevision)
    throw new DomainError("REVISION_CONFLICT", "Environment changed", 409);
  if (!REDEPLOYABLE_KINDS.includes(environment.kind))
    throw new DomainError("FORBIDDEN", "Only standard environments can be redeployed", 403);
  if (!state.provider)
    throw new DomainError(
      "CAPABILITY_UNAVAILABLE",
      "Delivery execution is unconfigured; a redeploy could not be admitted",
      503,
    );
  const [target] = await db
    .select()
    .from(schema.deliveryTargets)
    .where(eq(schema.deliveryTargets.environmentId, environment.id));
  const [active] = target?.activeDeploymentId
    ? await db
        .select()
        .from(schema.deliveryRuns)
        .where(eq(schema.deliveryRuns.id, target.activeDeploymentId))
    : [];
  if (!active || active.state !== "active" || !active.artifactId)
    throw new DomainError("NO_CURRENT_RELEASE", "This environment has no current release", 409);
  const [artifact] = await db
    .select()
    .from(schema.deliveryArtifacts)
    .where(eq(schema.deliveryArtifacts.id, active.artifactId));
  if (!artifact)
    throw new DomainError("JOURNAL_INCONSISTENT", "Current release artifact is missing", 500);
  const policies = await db
    .select()
    .from(schema.deliveryPolicies)
    .where(
      and(
        eq(schema.deliveryPolicies.environmentId, environment.id),
        isNull(schema.deliveryPolicies.revokedAt),
      ),
    );
  const policy = policies
    .filter((item) => Date.parse(item.input.expiresAt) > state.now().getTime())
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
  if (!policy)
    throw new DomainError(
      "POLICY_REQUIRED",
      "A current delivery policy is required to redeploy",
      409,
    );
  return prepareDelivery(
    state,
    actor,
    {
      policyId: policy.id,
      ciRunId: artifact.metadata.ciRunId,
      intent: "release",
      artifactId: artifact.id,
    },
    key,
    false,
    true,
  );
}
