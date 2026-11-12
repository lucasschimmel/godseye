import type { EffectOutcomeInput, ExecutionContext } from "@godseye/contracts";
import { schema } from "@godseye/store";
import { and, eq } from "drizzle-orm";
import { DomainError } from "./errors.js";
import { currentEpoch, runFor } from "./foundation-data.js";
import { immutableSnapshot } from "./infra-policy.js";
import { validatePreparation } from "./infra-preparation.js";
import type { ProviderResource, ProviderScope } from "./infra-provider.js";
import { protectiveQuarantine } from "./infra-quarantine.js";
import { type InfrastructureState, preparationFor, preparationManifest } from "./infra-state.js";
import {
  allocationFor,
  assertInspection,
  dispatchGate,
  gate,
  intendStep,
  markAllocation,
  recordResource,
  resourcesFor,
} from "./infra-steps.js";
import { fingerprint, write } from "./journal.js";

export async function executeInfrastructure(
  state: InfrastructureState,
  input: ExecutionContext,
): Promise<EffectOutcomeInput> {
  const context = immutableSnapshot(input),
    provider = state.provider;
  if (!provider?.qualified) return { status: "unknown", costMicros: 0 };
  try {
    const { manifest, preparation } = await gate(state, context, "preflight.intended");
    const scope = immutableSnapshot({
      allocationId: manifest.allocationId,
      projectId: context.projectId,
      environmentId: context.environmentId,
      manifestHash: preparation.hash,
      ownership: manifest.ownership,
      epoch: context.epoch,
    });
    const artifact = immutableSnapshot(await provider.preflight(manifest));
    await gate(state, context, "preflight.checked");
    if (
      !artifact.verified ||
      artifact.image !== manifest.image ||
      artifact.artifactDigest !== manifest.artifactDigest
    )
      throw new DomainError(
        "PROFILE_DRIFT",
        "Provider did not verify the exact pinned artifact",
        409,
      );
    const resources = {} as Record<"network" | "data" | "sandbox", ProviderResource>;
    await intendStep(state, context, "network", scope);
    await gate(state, context, "network.dispatch");
    resources.network = immutableSnapshot(await provider.createNetwork(scope, manifest));
    await recordResource(state, scope, "network", resources.network);
    await gate(state, context, "network.received");
    await intendStep(state, context, "firewall", scope);
    await gate(state, context, "firewall.dispatch");
    await provider.secureNetwork(scope, resources.network);
    await recordResource(state, scope, "firewall");
    await gate(state, context, "firewall.received");
    await intendStep(state, context, "data", scope);
    await gate(state, context, "data.dispatch");
    resources.data = immutableSnapshot(await provider.createData(scope, manifest));
    await recordResource(state, scope, "data", resources.data);
    await gate(state, context, "data.received");
    await intendStep(state, context, "sandbox", scope);
    await gate(state, context, "sandbox.dispatch");
    resources.sandbox = immutableSnapshot(
      await provider.createSandbox(scope, manifest, immutableSnapshot(resources), async () => {
        await gate(state, context, "sandbox.post-read.dispatch");
      }),
    );
    await recordResource(state, scope, "sandbox", resources.sandbox);
    await gate(state, context, "sandbox.received");
    const stopped = immutableSnapshot(
      await provider.inspect(scope, manifest, immutableSnapshot(resources)),
    );
    await gate(state, context, "stopped.inspected");
    assertInspection(stopped, manifest, scope, false);
    for (const kind of ["network", "data", "sandbox"] as const)
      if (stopped[kind]?.id !== resources[kind].id)
        throw new DomainError(
          "PROFILE_DRIFT",
          "Inspection changed an opaque provider resource mapping",
          409,
        );
    await write(state.store, async (tx) => {
      await dispatchGate(state, tx, context);
      await tx
        .update(schema.infrastructureSteps)
        .set({ evidence: fingerprint(stopped) })
        .where(
          and(
            eq(schema.infrastructureSteps.allocationId, scope.allocationId),
            eq(schema.infrastructureSteps.kind, "sandbox"),
          ),
        );
    });
    await intendStep(state, context, "start", scope);
    await gate(state, context, "start.dispatch");
    await provider.start(scope, immutableSnapshot(resources.sandbox));
    await recordResource(state, scope, "start");
    await gate(state, context, "start.received");
    const running = immutableSnapshot(
      await provider.inspect(scope, manifest, immutableSnapshot(resources)),
    );
    await gate(state, context, "running.inspected");
    assertInspection(running, manifest, scope, true);
    for (const kind of ["network", "data", "sandbox"] as const)
      if (running[kind]?.id !== resources[kind].id)
        throw new DomainError(
          "PROFILE_DRIFT",
          "Running inspection changed an opaque provider resource mapping",
          409,
        );
    await write(state.store, async (tx) => {
      await dispatchGate(state, tx, context);
      await tx
        .update(schema.infrastructureSteps)
        .set({ state: "inspected", evidence: fingerprint(running) })
        .where(
          and(
            eq(schema.infrastructureSteps.allocationId, manifest.allocationId),
            eq(schema.infrastructureSteps.kind, "sandbox"),
          ),
        );
    });
    return { status: "succeeded", costMicros: 0, evidenceRef: `infra:${preparation.hash}` };
  } catch (error) {
    const reason = error instanceof DomainError ? error.code : "PROVIDER_OUTCOME_UNCERTAIN";
    await protectiveQuarantine(state, context);
    await markAllocation(
      state,
      context,
      reason === "PROFILE_DRIFT" ? "quarantined" : "unknown",
      reason,
    );
    return { status: "unknown", costMicros: 0 };
  }
}
async function reconciliationGate(state: InfrastructureState, context: ExecutionContext) {
  const { run, operation } = await runFor(state.store.db, context.runId);
  if (
    operation.status !== "reconciling" ||
    run.fence !== context.fence ||
    !run.leaseExpiresAt ||
    run.leaseExpiresAt.getTime() <= state.now().getTime()
  )
    throw new DomainError("FENCED", "Reconciliation lease is expired or fenced", 409);
  return run;
}
/** Read-only reconciliation never starts, deletes, recreates or broadly prunes external resources. */
export async function reconcileInfrastructure(
  state: InfrastructureState,
  input: ExecutionContext,
): Promise<EffectOutcomeInput> {
  const context = immutableSnapshot(input),
    provider = state.provider;
  if (!provider?.qualified) return { status: "unknown", costMicros: 0 };
  try {
    await reconciliationGate(state, context);
    const allocation = await allocationFor(state.store.db, context),
      preparation = await preparationFor(state.store.db, allocation.preparationId),
      manifest = immutableSnapshot(preparationManifest(preparation));
    const scope: ProviderScope = immutableSnapshot({
      allocationId: allocation.id,
      projectId: context.projectId,
      environmentId: context.environmentId,
      manifestHash: preparation.hash,
      ownership: manifest.ownership,
      epoch: context.epoch,
    });
    const known = immutableSnapshot(await resourcesFor(state.store.db, allocation.id));
    const intentionsBeforeInspection = immutableSnapshot(
      await state.store.db
        .select()
        .from(schema.infrastructureSteps)
        .where(eq(schema.infrastructureSteps.allocationId, allocation.id)),
    );
    const inspection = immutableSnapshot(await provider.inspect(scope, manifest, known));
    await reconciliationGate(state, context);
    if (!inspection.evidence?.trim())
      throw new DomainError("PROFILE_DRIFT", "Reconciliation evidence is missing", 409);
    if (!inspection.network && !inspection.data && !inspection.sandbox && !inspection.running) {
      await write(state.store, async (tx) => {
        const { operation, run } = await runFor(tx, context.runId);
        if (
          operation.status !== "reconciling" ||
          run.fence !== context.fence ||
          !run.leaseExpiresAt ||
          run.leaseExpiresAt.getTime() <= state.now().getTime()
        )
          throw new DomainError("FENCED", "Absence reconciliation authority changed", 409);
        const steps = await tx
          .select()
          .from(schema.infrastructureSteps)
          .where(eq(schema.infrastructureSteps.allocationId, allocation.id));
        // A point-in-time 404 cannot close an admitted mutation whose acknowledgement is unresolved.
        if (
          [...intentionsBeforeInspection, ...steps].some(
            (step) =>
              step.state === "intended" &&
              ["network", "firewall", "data", "sandbox", "start"].includes(step.kind),
          )
        )
          throw new DomainError(
            "PROVIDER_EFFECT_UNRESOLVED",
            "Provider absence does not prove unresolved mutations cannot still complete",
            409,
          );
        await markAllocation(
          state,
          context,
          "released",
          "Exact provider absence confirmed with no unresolved mutation",
          tx,
        );
      });
      return { status: "failed", costMicros: 0, evidenceRef: `infra-absent:${allocation.id}` };
    }
    assertInspection(inspection, manifest, scope, true);
    for (const kind of ["network", "data", "sandbox"] as const)
      if (known[kind] && inspection[kind]?.id !== known[kind]?.id)
        throw new DomainError(
          "PROFILE_DRIFT",
          "Provider mapping changed during reconciliation",
          409,
        );
    await write(state.store, async (tx) => {
      await validatePreparation(state, tx, preparation.id, allocation.id);
      if ((await currentEpoch(tx, context.environmentId)) !== context.epoch)
        throw new DomainError("FENCED", "Activation epoch changed", 409);
      const { operation, run } = await runFor(tx, context.runId);
      if (
        operation.status !== "reconciling" ||
        run.fence !== context.fence ||
        !run.leaseExpiresAt ||
        run.leaseExpiresAt.getTime() <= state.now().getTime()
      )
        throw new DomainError("FENCED", "Reconciliation authority changed", 409);
      // Missing receipts may only be filled by exact scope AND complete effective configuration inspection.
      for (const kind of ["network", "data", "sandbox"] as const) {
        const resource = inspection[kind];
        if (resource)
          await tx
            .update(schema.infrastructureSteps)
            .set({ providerId: resource.id, state: "inspected", evidence: fingerprint(inspection) })
            .where(
              and(
                eq(schema.infrastructureSteps.allocationId, allocation.id),
                eq(schema.infrastructureSteps.kind, kind),
              ),
            );
      }
    });
    return { status: "succeeded", costMicros: 0, evidenceRef: `infra:${preparation.hash}` };
  } catch (error) {
    const reason = error instanceof DomainError ? error.code : "PROVIDER_OUTCOME_UNCERTAIN";
    await protectiveQuarantine(state, context);
    await markAllocation(
      state,
      context,
      reason === "PROFILE_DRIFT" ? "quarantined" : "unknown",
      reason,
    );
    return { status: "unknown", costMicros: 0 };
  }
}
