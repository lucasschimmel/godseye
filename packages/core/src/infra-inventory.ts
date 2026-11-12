import {
  DeclareInventory,
  type DeclareInventoryInput,
  InfrastructureObservation,
  InfrastructureOverview,
  type InfrastructureOverviewView,
  InfrastructureRevision,
} from "@godseye/contracts";
import { type DatabaseAccess, schema } from "@godseye/store";
import { eq } from "drizzle-orm";
import { DomainError, parseInput } from "./errors.js";
import { foundationState, recordRequest, requestFor } from "./foundation-data.js";
import { immutableSnapshot } from "./infra-policy.js";
import {
  assertInfrastructureFresh,
  type InfrastructureState,
  inventoryFor,
  observationReasons,
  validateDesired,
} from "./infra-state.js";
import { appendAudit, write } from "./journal.js";
import { type Actor, assertOwner } from "./policy.js";

export async function infrastructureOverview(
  state: InfrastructureState,
  actor: Actor,
  tx: DatabaseAccess = state.store.db,
): Promise<InfrastructureOverviewView> {
  assertOwner(actor);
  const inventory = await inventoryFor(tx);
  const preparations = await tx.select().from(schema.infrastructurePreparations);
  const allocations = await tx.select().from(schema.infrastructureAllocations);
  const reasons = observationReasons(inventory.observation, state.now());
  if (!inventory.desired)
    reasons.push("Declare the physical host, guest commitments and professional pool first");
  if (!state.provider?.qualified)
    reasons.push("No independently qualified local infrastructure provider is registered");
  return InfrastructureOverview.parse({
    desired: inventory.desired,
    revision: inventory.revision,
    observation: inventory.observation,
    observationRevision: inventory.observationRevision,
    observationState: !inventory.observation
      ? "unknown"
      : Date.parse(inventory.observation.expiresAt) <= state.now().getTime()
        ? "stale"
        : "observed",
    executionAvailable: reasons.length === 0,
    executionReasons: reasons,
    preparations: preparations.map(({ expectedProjectRevision: _, ...row }) => ({
      ...row,
      createdAt: row.createdAt.toISOString(),
    })),
    allocations: allocations.map((row) => ({ ...row, updatedAt: row.updatedAt.toISOString() })),
  });
}
async function replay(tx: DatabaseAccess, key: string) {
  const [row] = await tx
    .select()
    .from(schema.infrastructureReceipts)
    .where(eq(schema.infrastructureReceipts.key, key));
  if (!row) throw new DomainError("JOURNAL_INCONSISTENT", "Infrastructure receipt is missing", 500);
  return InfrastructureOverview.parse(row.response);
}
async function receipt(
  state: InfrastructureState,
  tx: DatabaseAccess,
  actor: Actor,
  key: string,
  digest: string,
  kind: string,
) {
  const response = await infrastructureOverview(state, actor, tx);
  await tx.insert(schema.infrastructureReceipts).values({ key, response });
  await recordRequest(
    tx,
    foundationState(state.store, { now: state.now }),
    key,
    digest,
    String(response.revision),
    kind,
  );
  return response;
}
export async function declareInfrastructure(
  state: InfrastructureState,
  actorInput: Actor,
  input: DeclareInventoryInput,
  key: string,
) {
  const actor = immutableSnapshot(actorInput),
    data = parseInput(DeclareInventory, input);
  assertInfrastructureFresh(state, actor);
  validateDesired(data);
  return write(state.store, async (tx) => {
    const request = await requestFor(tx, actor, key, "infrastructure.declare", data);
    if (request.existing) return replay(tx, key);
    assertInfrastructureFresh(state, actor);
    const inventory = await inventoryFor(tx);
    if (inventory.revision !== data.expectedRevision)
      throw new DomainError("REVISION_CONFLICT", "Desired inventory has changed", 409);
    await tx
      .update(schema.infrastructureInventory)
      .set({ desired: data, revision: inventory.revision + 1 })
      .where(eq(schema.infrastructureInventory.id, 1));
    await appendAudit(
      tx,
      actor,
      null,
      "infrastructure.declared",
      "Updated desired topology; no observed capacity or qualification was changed",
    );
    return receipt(state, tx, actor, key, request.digest, "infrastructure.declare");
  });
}
export async function refreshInfrastructure(
  state: InfrastructureState,
  actorInput: Actor,
  input: { expectedRevision: number },
  key: string,
) {
  const actor = immutableSnapshot(actorInput),
    data = parseInput(InfrastructureRevision, input);
  assertInfrastructureFresh(state, actor);
  const prior = await write(state.store, async (tx) => {
    const request = await requestFor(tx, actor, key, "infrastructure.refresh", data);
    return request.existing ? replay(tx, key) : null;
  });
  if (prior) return prior;
  const observation = parseInput(InfrastructureObservation, await state.collector.collect());
  assertInfrastructureFresh(state, actor);
  return write(state.store, async (tx) => {
    const request = await requestFor(tx, actor, key, "infrastructure.refresh", data);
    if (request.existing) return replay(tx, key);
    const inventory = await inventoryFor(tx);
    if (inventory.observationRevision !== data.expectedRevision)
      throw new DomainError("REVISION_CONFLICT", "Collector observations have changed", 409);
    await tx
      .update(schema.infrastructureInventory)
      .set({ observation, observationRevision: inventory.observationRevision + 1 })
      .where(eq(schema.infrastructureInventory.id, 1));
    await appendAudit(
      tx,
      actor,
      null,
      "infrastructure.observed",
      `Collected sanitized ${observation.target} metadata from ${observation.source}`,
    );
    return receipt(state, tx, actor, key, request.digest, "infrastructure.refresh");
  });
}
