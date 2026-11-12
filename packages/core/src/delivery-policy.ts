import { randomUUID } from "node:crypto";
import { CreateDeliveryPolicy, type CreateDeliveryPolicyInput } from "@godseye/contracts";
import { schema } from "@godseye/store";
import { eq } from "drizzle-orm";
import {
  type DeliveryState,
  deliveryPolicyFor,
  freshDeliveryOwner,
  policyView,
} from "./delivery-state.js";
import { DomainError, parseInput } from "./errors.js";
import { environmentFor, foundationState, recordRequest, requestFor } from "./foundation-data.js";
import { immutableSnapshot } from "./infra-policy.js";
import { appendAudit, fingerprint, write } from "./journal.js";
import type { Actor } from "./policy.js";

export async function createDeliveryPolicy(
  state: DeliveryState,
  actorInput: Actor,
  input: CreateDeliveryPolicyInput,
  key: string,
) {
  const actor = immutableSnapshot(actorInput),
    data = parseInput(CreateDeliveryPolicy, input);
  freshDeliveryOwner(state, actor);
  return write(state.store, async (tx) => {
    const receipt = await requestFor(tx, actor, key, "delivery.policy.create", data);
    if (receipt.existing)
      return policyView(await deliveryPolicyFor(tx, receipt.existing.resourceId));
    const env = await environmentFor(tx, actor, data.projectId, data.environmentId);
    const [project] = await tx
      .select()
      .from(schema.projects)
      .where(eq(schema.projects.id, data.projectId));
    if (!project?.repository)
      throw new DomainError("SOURCE_REQUIRED", "Bind a GitHub repository first", 409);
    if (
      project.revision !== data.expectedProjectRevision ||
      env.revision !== data.expectedEnvironmentRevision
    )
      throw new DomainError("REVISION_CONFLICT", "Project or environment changed", 409);
    if (env.kind !== "development" && env.kind !== "production")
      throw new DomainError(
        "FORBIDDEN",
        "Standing policies target standard environments only",
        403,
      );
    const expiry = Date.parse(data.expiresAt),
      now = state.now();
    if (expiry <= now.getTime() || expiry > now.getTime() + 30 * 86400000)
      throw new DomainError(
        "INVALID_EXPIRY",
        "Standing delivery policy must expire within thirty days",
        422,
      );
    if (new Set(data.requiredChecks).size !== data.requiredChecks.length)
      throw new DomainError("INVALID_CHECKS", "Required checks must be unique", 422);
    const row = {
      id: randomUUID(),
      projectId: data.projectId,
      environmentId: data.environmentId,
      input: data,
      repository: project.repository,
      hash: fingerprint({ input: data, repository: project.repository }),
      revision: 0,
      revokedAt: null,
      createdAt: now,
    };
    await tx.insert(schema.deliveryPolicies).values(row);
    await recordRequest(
      tx,
      foundationState(state.store, { now: state.now }),
      key,
      receipt.digest,
      row.id,
      "delivery.policy.create",
    );
    await appendAudit(
      tx,
      actor,
      data.projectId,
      "delivery.policy.created",
      `Created bounded exact-source delivery authority ${row.id}; no external connection or deployment`,
    );
    return policyView(row);
  });
}
export async function revokeDeliveryPolicy(
  state: DeliveryState,
  actor: Actor,
  id: string,
  expectedRevision: number,
  key: string,
) {
  freshDeliveryOwner(state, actor);
  return write(state.store, async (tx) => {
    const receipt = await requestFor(tx, actor, key, "delivery.policy.revoke", {
      id,
      expectedRevision,
    });
    const row = await deliveryPolicyFor(tx, id);
    if (receipt.existing) return policyView(row);
    if (row.revision !== expectedRevision)
      throw new DomainError("REVISION_CONFLICT", "Policy has changed", 409);
    const update = { revokedAt: state.now(), revision: row.revision + 1 };
    await tx.update(schema.deliveryPolicies).set(update).where(eq(schema.deliveryPolicies.id, id));
    await recordRequest(
      tx,
      foundationState(state.store, { now: state.now }),
      key,
      receipt.digest,
      id,
      "delivery.policy.revoke",
    );
    await appendAudit(
      tx,
      actor,
      row.projectId,
      "delivery.policy.revoked",
      `Revoked standing delivery authority ${id}; retained resources require reconciliation`,
    );
    return policyView({ ...row, ...update });
  });
}
