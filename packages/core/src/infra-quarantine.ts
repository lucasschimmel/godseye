import { randomUUID } from "node:crypto";
import type { ExecutionContext } from "@godseye/contracts";
import { schema } from "@godseye/store";
import { and, eq } from "drizzle-orm";
import { immutableSnapshot } from "./infra-policy.js";
import type { ProviderScope } from "./infra-provider.js";
import type { InfrastructureState } from "./infra-state.js";
import { allocationFor, executionActor, markAllocation, resourcesFor } from "./infra-steps.js";
import { appendAudit, write } from "./journal.js";

/** Revocation does not authorize new work; this narrow safety authority only stops an exact owned mapping. */
export async function protectiveQuarantine(state: InfrastructureState, input: ExecutionContext) {
  const context = immutableSnapshot(input),
    provider = state.provider;
  if (!provider) return;
  const intention = await write(state.store, async (tx) => {
    const allocation = await allocationFor(tx, context);
    const steps = await tx
      .select()
      .from(schema.infrastructureSteps)
      .where(eq(schema.infrastructureSteps.allocationId, allocation.id));
    const sandbox = steps.find((step) => step.kind === "sandbox"),
      started = steps.find((step) => step.kind === "start");
    if (!started || !sandbox?.providerId || !sandbox.evidence) return null;
    const resources = await resourcesFor(tx, allocation.id);
    if (!resources.sandbox) return null;
    const scope = immutableSnapshot(sandbox.scope as unknown as ProviderScope),
      resource = immutableSnapshot(resources.sandbox);
    const attemptId = randomUUID();
    await tx.insert(schema.infrastructureSteps).values({
      id: attemptId,
      allocationId: allocation.id,
      runId: context.runId,
      kind: `quarantine:${attemptId}`,
      state: "intended",
      scope: { ...scope },
      configurationHash: scope.manifestHash,
      providerId: resource.id,
      createdAt: state.now(),
    });
    await tx
      .update(schema.infrastructureAllocations)
      .set({ cleanupState: "pending", updatedAt: state.now() })
      .where(eq(schema.infrastructureAllocations.id, allocation.id));
    await appendAudit(
      tx,
      executionActor(context),
      context.projectId,
      "infrastructure.quarantine.intended",
      `Protective stop intent for exact mapped sandbox of allocation ${allocation.id}; data and reservations retained`,
    );
    return { scope, resource, attemptId };
  });
  if (!intention) return;
  let stopped = false,
    evidence = "PROTECTIVE_STOP_UNCERTAIN";
  try {
    const result = immutableSnapshot(
      await provider.quarantine(intention.scope, intention.resource),
    );
    stopped = result.stopped && Boolean(result.evidence?.trim()) && result.evidence.length <= 256;
    if (stopped) evidence = result.evidence;
  } catch {
    /* A safety stop failure is recorded durably below; capacity is never released. */
  }
  await write(state.store, async (tx) => {
    await tx
      .update(schema.infrastructureSteps)
      .set({ state: stopped ? "stopped" : "unknown", evidence })
      .where(
        and(
          eq(schema.infrastructureSteps.allocationId, intention.scope.allocationId),
          eq(schema.infrastructureSteps.id, intention.attemptId),
        ),
      );
    const steps = await tx
      .select()
      .from(schema.infrastructureSteps)
      .where(eq(schema.infrastructureSteps.allocationId, intention.scope.allocationId));
    const pendingStart = steps.some((step) => step.kind === "start" && step.state === "intended");
    await tx
      .update(schema.infrastructureAllocations)
      .set({
        cleanupState: stopped && !pendingStart ? "stopped" : "pending",
        updatedAt: state.now(),
      })
      .where(eq(schema.infrastructureAllocations.id, intention.scope.allocationId));
    await appendAudit(
      tx,
      executionActor(context),
      context.projectId,
      "infrastructure.quarantine.outcome",
      `Protective stop ${stopped ? "confirmed" : "uncertain"}; persistent data and resource reservations retained`,
    );
  });
}
export async function fenceInfrastructure(state: InfrastructureState, input: ExecutionContext) {
  const context = immutableSnapshot(input);
  await protectiveQuarantine(state, context);
  await markAllocation(state, context, "unknown", "SETTLEMENT_FENCED");
}
