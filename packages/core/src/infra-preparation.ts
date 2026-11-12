import { randomUUID } from "node:crypto";
import {
  AdmitInfrastructure,
  type AdmitInfrastructureInput,
  InfrastructureAllocation,
  InfrastructurePreparation,
  PrepareInfrastructure,
  type PrepareInfrastructureInput,
} from "@godseye/contracts";
import { type DatabaseAccess, schema } from "@godseye/store";
import { eq } from "drizzle-orm";
import { DomainError, parseInput } from "./errors.js";
import { environmentFor, foundationState, recordRequest, requestFor } from "./foundation-data.js";
import { allocatePrivateSubnet, subnetsOverlap } from "./infra-network.js";
import {
  compileApplication,
  INFRASTRUCTURE_POLICY_VERSION,
  immutableSnapshot,
} from "./infra-policy.js";
import {
  assertInfrastructureFresh,
  INFRA_ADAPTER_ID,
  INFRA_DESTINATION,
  type InfrastructureState,
  inventoryFor,
  observationReasons,
  preparationFor,
  preparationManifest,
  validateCapacity,
  validateEnvironmentCapacity,
} from "./infra-state.js";
import { appendAudit, fingerprint, write } from "./journal.js";
import { type Actor, assertProjectAccess } from "./policy.js";

export const preparationView = (row: typeof schema.infrastructurePreparations.$inferSelect) => {
  const { expectedProjectRevision: _, ...rest } = row;
  return InfrastructurePreparation.parse({ ...rest, createdAt: row.createdAt.toISOString() });
};
export const allocationView = (row: typeof schema.infrastructureAllocations.$inferSelect) =>
  InfrastructureAllocation.parse({ ...row, updatedAt: row.updatedAt.toISOString() });
export async function prepareInfrastructure(
  state: InfrastructureState,
  actorInput: Actor,
  input: PrepareInfrastructureInput,
  key: string,
) {
  const actor = immutableSnapshot(actorInput),
    data = parseInput(PrepareInfrastructure, input);
  assertInfrastructureFresh(state, actor);
  return write(state.store, async (tx) => {
    await environmentFor(tx, actor, data.projectId, data.environmentId);
    const request = await requestFor(tx, actor, key, "infrastructure.prepare", data);
    if (request.existing)
      return preparationView(await preparationFor(tx, request.existing.resourceId));
    const [project] = await tx
      .select()
      .from(schema.projects)
      .where(eq(schema.projects.id, data.projectId));
    if (!project || project.revision !== data.expectedProjectRevision)
      throw new DomainError("REVISION_CONFLICT", "Project has changed", 409);
    const inventory = await inventoryFor(tx);
    if (!inventory.desired)
      throw new DomainError(
        "INVENTORY_REQUIRED",
        "Declare desired topology before preparing a workload",
        409,
      );
    const existing = await tx.select().from(schema.infrastructurePreparations);
    const manifests = existing.map(preparationManifest);
    const allocationId = randomUUID(),
      id = randomUUID();
    const manifest = compileApplication(data.workload, {
      allocationId,
      projectId: data.projectId,
      environmentId: data.environmentId,
      providerBinding: inventory.observation?.providerBinding ?? null,
      ipv4Subnet: allocatePrivateSubnet(
        inventory.desired.pool.ipv4Pool,
        manifests.map((item) => item.network.ipv4Subnet),
      ),
      ipv6Subnet: allocatePrivateSubnet(
        inventory.desired.pool.ipv6Pool,
        manifests.map((item) => item.network.ipv6Subnet),
      ),
    });
    const row = {
      id,
      allocationId,
      projectId: data.projectId,
      environmentId: data.environmentId,
      expectedProjectRevision: data.expectedProjectRevision,
      hash: fingerprint(manifest),
      inventoryRevision: inventory.revision,
      observationRevision: inventory.observationRevision,
      policyVersion: INFRASTRUCTURE_POLICY_VERSION,
      manifest: manifest as unknown as Record<string, unknown>,
      createdAt: state.now(),
    };
    await tx.insert(schema.infrastructurePreparations).values(row);
    await tx.insert(schema.resources).values({
      id,
      projectId: data.projectId,
      environmentId: data.environmentId,
      kind: "manifest",
      name: `Infrastructure preparation ${row.hash.slice(0, 12)}`,
      createdAt: state.now(),
    });
    await recordRequest(
      tx,
      foundationState(state.store, { now: state.now }),
      key,
      request.digest,
      id,
      "infrastructure.prepare",
    );
    await appendAudit(
      tx,
      actor,
      data.projectId,
      "infrastructure.prepared",
      `Compiled immutable application profile ${row.hash}; no provider effect or capacity reservation`,
    );
    return preparationView(row);
  });
}
export async function validatePreparation(
  state: InfrastructureState,
  tx: DatabaseAccess,
  id: string,
  allocationId?: string,
) {
  const preparation = await preparationFor(tx, id),
    manifest = preparationManifest(preparation);
  const inventory = await inventoryFor(tx);
  if (
    !state.provider?.qualified ||
    observationReasons(inventory.observation, state.now()).length ||
    !inventory.desired ||
    !inventory.observation
  )
    throw new DomainError(
      "CAPABILITY_UNAVAILABLE",
      "Fresh professional-VM runtime, artifact, quota and both-family firewall qualification are required",
      503,
    );
  if (
    inventory.revision !== preparation.inventoryRevision ||
    inventory.observationRevision !== preparation.observationRevision
  )
    throw new DomainError(
      "OBSERVATION_CHANGED",
      "Inventory or collector revision changed after preparation",
      409,
    );
  const binding = inventory.observation.providerBinding;
  if (
    !binding ||
    binding.providerId !== state.provider.id ||
    binding.targetId !== state.provider.targetId ||
    binding.version !== state.provider.version ||
    binding.policyVersion !== INFRASTRUCTURE_POLICY_VERSION ||
    fingerprint(binding) !== fingerprint(manifest.providerBinding)
  )
    throw new DomainError(
      "CAPABILITY_UNAVAILABLE",
      "Observation is not bound to this exact provider, target and runtime generation",
      503,
    );
  if (
    manifest.allocationId !== preparation.allocationId ||
    manifest.projectId !== preparation.projectId ||
    manifest.environmentId !== preparation.environmentId
  )
    throw new DomainError(
      "PLAN_TAMPERED",
      "Compiled scope does not match its immutable preparation",
      409,
    );
  const [project] = await tx
    .select()
    .from(schema.projects)
    .where(eq(schema.projects.id, preparation.projectId));
  if (project?.revision !== preparation.expectedProjectRevision)
    throw new DomainError("REVISION_CONFLICT", "Project has changed after preparation", 409);
  await validateCapacity(tx, inventory.desired, inventory.observation, manifest, allocationId);
  await validateEnvironmentCapacity(
    tx,
    preparation.environmentId,
    {
      cpuMilliCores: manifest.limits.cpuMilliCores,
      memoryMiB: manifest.limits.memoryMiB + manifest.limits.temporaryMiB,
      storageGiB: manifest.limits.dataGiB,
      pids: manifest.limits.pids,
    },
    allocationId,
  );
  return { preparation, manifest };
}
/** Called only inside FoundationEngine enqueue: all CPU/storage/address reservations roll back with its run. */
export async function reserveInfrastructure(
  state: InfrastructureState,
  tx: DatabaseAccess,
  plan: typeof schema.executionPlans.$inferSelect,
  runId: string,
  actor: Actor,
) {
  if (plan.adapterId !== INFRA_ADAPTER_ID) return;
  assertInfrastructureFresh(state, actor);
  if (plan.command.kind !== "cell.lifecycle" || plan.command.intent !== "provision")
    throw new DomainError(
      "INVALID_COMMAND",
      "This adapter only provisions compiled application cells",
      422,
    );
  const { preparation, manifest } = await validatePreparation(state, tx, plan.command.manifestRef);
  if (plan.command.manifestHash !== preparation.hash)
    throw new DomainError(
      "PLAN_TAMPERED",
      "Execution command must bind the exact compiled preparation hash",
      409,
    );
  if (
    plan.projectId !== preparation.projectId ||
    plan.environmentId !== preparation.environmentId ||
    plan.targetId !== preparation.id
  )
    throw new DomainError("FORBIDDEN", "Execution plan does not match its preparation", 403);
  const rows = await tx.select().from(schema.infrastructureAllocations);
  if (
    rows.some((row) => row.environmentId === preparation.environmentId && row.state !== "released")
  )
    throw new DomainError(
      "ENVIRONMENT_ALLOCATED",
      "This environment retains an active or uncertain physical allocation",
      409,
    );
  for (const row of rows)
    if (
      row.state !== "released" &&
      (subnetsOverlap(row.ipv4Subnet, manifest.network.ipv4Subnet) ||
        subnetsOverlap(row.ipv6Subnet, manifest.network.ipv6Subnet))
    )
      throw new DomainError(
        "ADDRESS_COLLISION",
        "Cell network overlaps an existing reservation",
        409,
      );
  await tx.insert(schema.infrastructureAllocations).values({
    id: preparation.allocationId,
    preparationId: preparation.id,
    projectId: preparation.projectId,
    environmentId: preparation.environmentId,
    runId,
    state: "reserved",
    ipv4Subnet: manifest.network.ipv4Subnet,
    ipv6Subnet: manifest.network.ipv6Subnet,
    updatedAt: state.now(),
  });
  await appendAudit(
    tx,
    { id: "infrastructure-admission", kind: "service", projectIds: [preparation.projectId] },
    preparation.projectId,
    "infrastructure.reserved",
    `Atomically reserved professional-pool resources and private networks for allocation ${preparation.allocationId}`,
  );
}
export async function admitInfrastructure(
  state: InfrastructureState,
  actorInput: Actor,
  input: AdmitInfrastructureInput,
  key: string,
) {
  const actor = immutableSnapshot(actorInput),
    data = parseInput(AdmitInfrastructure, input);
  assertInfrastructureFresh(state, actor);
  const preparation = await preparationFor(state.store.db, data.preparationId);
  assertProjectAccess(actor, preparation.projectId);
  if (preparation.hash !== data.expectedHash)
    throw new DomainError("PLAN_TAMPERED", "Approval must name the exact preparation hash", 409);
  await write(state.store, async (tx) => {
    const request = await requestFor(tx, actor, key, "infrastructure.admit", data);
    if (!request.existing)
      await recordRequest(
        tx,
        foundationState(state.store, { now: state.now }),
        key,
        request.digest,
        preparation.id,
        "infrastructure.admit",
        false,
      );
  });
  const plan = await state.foundation.createPlan(
    actor,
    {
      projectId: preparation.projectId,
      environmentId: preparation.environmentId,
      targetId: preparation.id,
      expectedRevision: preparation.expectedProjectRevision,
      adapterId: INFRA_ADAPTER_ID,
      command: {
        kind: "cell.lifecycle",
        intent: "provision",
        manifestRef: preparation.id,
        manifestHash: preparation.hash,
      },
      maxCostMicros: 0,
      tools: ["infrastructure.provision"],
      destinations: [INFRA_DESTINATION],
    },
    `infra:${fingerprint({ key, data })}:plan`,
  );
  assertInfrastructureFresh(state, actor);
  await state.foundation.approve(
    actor,
    plan.id,
    plan.hash,
    `infra:${fingerprint({ key, data })}:approve`,
  );
  await state.foundation.enqueue(actor, plan.id, `infra:${fingerprint({ key, data })}:enqueue`);
  const [allocation] = await state.store.db
    .select()
    .from(schema.infrastructureAllocations)
    .where(eq(schema.infrastructureAllocations.id, preparation.allocationId));
  if (!allocation)
    throw new DomainError("JOURNAL_INCONSISTENT", "Admission reservation is missing", 500);
  return allocationView(allocation);
}
export async function releaseQueuedInfrastructure(
  state: InfrastructureState,
  tx: DatabaseAccess,
  runId: string,
) {
  const [allocation] = await tx
    .select()
    .from(schema.infrastructureAllocations)
    .where(eq(schema.infrastructureAllocations.runId, runId));
  if (!allocation) return;
  const steps = await tx
    .select()
    .from(schema.infrastructureSteps)
    .where(eq(schema.infrastructureSteps.allocationId, allocation.id));
  if (steps.length)
    throw new DomainError(
      "JOURNAL_INCONSISTENT",
      "Queued allocation unexpectedly has provider intentions",
      500,
    );
  await tx
    .update(schema.infrastructureAllocations)
    .set({
      state: "released",
      reason: "Queued authority ended before any provider intention",
      updatedAt: state.now(),
    })
    .where(eq(schema.infrastructureAllocations.id, allocation.id));
}
