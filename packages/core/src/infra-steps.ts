import { randomUUID } from "node:crypto";
import { CompiledApplicationManifest, type ExecutionContext } from "@godseye/contracts";
import { type DatabaseAccess, schema } from "@godseye/store";
import { and, eq } from "drizzle-orm";
import { DomainError } from "./errors.js";
import { foundationState, planFor } from "./foundation-data.js";
import { validApproval } from "./foundation-queue.js";
import type { CompiledApplication } from "./infra-policy.js";
import { validatePreparation } from "./infra-preparation.js";
import type { ProviderInspection, ProviderResource, ProviderScope } from "./infra-provider.js";
import { INFRA_DESTINATION, type InfrastructureState } from "./infra-state.js";
import { appendAudit, fingerprint, write } from "./journal.js";

export type InfraStepKind = "network" | "firewall" | "data" | "sandbox" | "start";
export const executionActor = (context: ExecutionContext) => ({
  id: context.workerId,
  kind: "service" as const,
  projectIds: [context.projectId],
});
export async function allocationFor(tx: DatabaseAccess, context: ExecutionContext) {
  const [row] = await tx
    .select()
    .from(schema.infrastructureAllocations)
    .where(eq(schema.infrastructureAllocations.runId, context.runId));
  if (
    !row ||
    row.projectId !== context.projectId ||
    row.environmentId !== context.environmentId ||
    context.command.kind !== "cell.lifecycle" ||
    context.command.manifestRef !== row.preparationId ||
    context.command.intent !== "provision"
  )
    throw new DomainError("FENCED", "Execution does not match its physical allocation", 409);
  return row;
}
export async function dispatchGate(
  state: InfrastructureState,
  tx: DatabaseAccess,
  context: ExecutionContext,
) {
  const allocation = await allocationFor(tx, context);
  const prepared = await validatePreparation(state, tx, allocation.preparationId, allocation.id);
  if (
    context.command.kind !== "cell.lifecycle" ||
    context.command.manifestHash !== prepared.preparation.hash
  )
    throw new DomainError(
      "PLAN_TAMPERED",
      "Execution command lost its preparation hash binding",
      409,
    );
  await state.foundation.assertDispatch(tx, context, {
    actorId: context.workerId,
    tool: "infrastructure.provision",
    destination: INFRA_DESTINATION,
    costMicros: 0,
  });
  await validApproval(
    tx,
    foundationState(state.store, { now: state.now }),
    await planFor(tx, executionActor(context), context.planId),
  );
  return { allocation, ...prepared };
}
export async function gate(state: InfrastructureState, context: ExecutionContext, action: string) {
  return write(state.store, async (tx) => {
    const result = await dispatchGate(state, tx, context);
    await appendAudit(
      tx,
      executionActor(context),
      context.projectId,
      `infrastructure.${action}`,
      `Durable dispatch fence for run ${context.runId}, epoch ${context.epoch}, fence ${context.fence}`,
    );
    return result;
  });
}
export function assertResource(resource: ProviderResource, scope: ProviderScope) {
  if (
    !resource ||
    !/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(resource.id) ||
    fingerprint(resource.scope) !== fingerprint(scope) ||
    resource.configurationHash !== scope.manifestHash
  )
    throw new DomainError(
      "PROFILE_DRIFT",
      "Provider identity, ownership or immutable configuration does not match",
      409,
    );
}
export function assertInspection(
  result: ProviderInspection,
  manifest: CompiledApplication,
  scope: ProviderScope,
  running: boolean,
) {
  if (
    !result?.evidence?.trim() ||
    result.evidence.length > 256 ||
    !result.quotaEnforced ||
    !result.firewallIpv4 ||
    !result.firewallIpv6 ||
    result.runtime !== "runsc" ||
    result.platform !== "systrap" ||
    result.running !== running ||
    !CompiledApplicationManifest.safeParse(result.manifest).success ||
    fingerprint(result.manifest) !== scope.manifestHash ||
    fingerprint(manifest) !== scope.manifestHash
  )
    throw new DomainError(
      "PROFILE_DRIFT",
      "Effective runtime, quota, both-family firewall or application profile differs from the immutable preparation",
      409,
    );
  for (const resource of [result.network, result.data, result.sandbox]) {
    if (!resource)
      throw new DomainError("PROFILE_DRIFT", "Effective allocation is incomplete", 409);
    assertResource(resource, scope);
  }
}
export async function intendStep(
  state: InfrastructureState,
  context: ExecutionContext,
  kind: InfraStepKind,
  scope: ProviderScope,
) {
  await write(state.store, async (tx) => {
    await dispatchGate(state, tx, context);
    const [existing] = await tx
      .select()
      .from(schema.infrastructureSteps)
      .where(
        and(
          eq(schema.infrastructureSteps.allocationId, scope.allocationId),
          eq(schema.infrastructureSteps.kind, kind),
        ),
      );
    if (existing)
      throw new DomainError(
        "RECONCILIATION_REQUIRED",
        "A durable step already exists; blind provider replay is prohibited",
        409,
      );
    await tx.insert(schema.infrastructureSteps).values({
      id: randomUUID(),
      allocationId: scope.allocationId,
      runId: context.runId,
      kind,
      state: "intended",
      scope: { ...scope },
      configurationHash: scope.manifestHash,
      createdAt: state.now(),
    });
    await tx
      .update(schema.infrastructureAllocations)
      .set({ state: "provisioning", updatedAt: state.now() })
      .where(eq(schema.infrastructureAllocations.id, scope.allocationId));
    await appendAudit(
      tx,
      executionActor(context),
      context.projectId,
      `infrastructure.${kind}.intended`,
      `Committed stable ${kind} intention for allocation ${scope.allocationId} before provider handoff`,
    );
  });
}
export async function recordResource(
  state: InfrastructureState,
  scope: ProviderScope,
  kind: InfraStepKind,
  resource?: ProviderResource,
) {
  if (resource) assertResource(resource, scope);
  await write(state.store, async (tx) => {
    await tx
      .update(schema.infrastructureSteps)
      .set({ state: "received", providerId: resource?.id ?? null })
      .where(
        and(
          eq(schema.infrastructureSteps.allocationId, scope.allocationId),
          eq(schema.infrastructureSteps.kind, kind),
        ),
      );
  });
}
export async function resourcesFor(tx: DatabaseAccess, allocationId: string) {
  const rows = await tx
    .select()
    .from(schema.infrastructureSteps)
    .where(eq(schema.infrastructureSteps.allocationId, allocationId));
  const resources: Partial<Record<"network" | "data" | "sandbox", ProviderResource>> = {};
  for (const row of rows)
    if ((row.kind === "network" || row.kind === "data" || row.kind === "sandbox") && row.providerId)
      resources[row.kind] = {
        id: row.providerId,
        scope: row.scope as unknown as ProviderScope,
        configurationHash: row.configurationHash,
      };
  return resources;
}
export async function markAllocation(
  state: InfrastructureState,
  context: ExecutionContext,
  status: "verified" | "unknown" | "quarantined" | "released",
  reason: string | null,
  tx?: DatabaseAccess,
) {
  const update = async (access: DatabaseAccess) => {
    const allocation = await allocationFor(access, context);
    await access
      .update(schema.infrastructureAllocations)
      .set({ state: status, reason, updatedAt: state.now() })
      .where(eq(schema.infrastructureAllocations.id, allocation.id));
    await appendAudit(
      access,
      executionActor(context),
      context.projectId,
      `infrastructure.${status}`,
      `Allocation ${allocation.id}: ${reason ?? status}`,
    );
  };
  return tx ? update(tx) : write(state.store, update);
}
