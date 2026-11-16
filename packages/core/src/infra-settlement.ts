import type { DatabaseAccess } from "@godseye/store";
import { schema } from "@godseye/store";
import { eq } from "drizzle-orm";
import { DomainError } from "./errors.js";
import { currentEpoch, runFor } from "./foundation-data.js";
import { contextFor } from "./foundation-queue.js";
import { validatePreparation } from "./infra-preparation.js";
import type { InfrastructureState } from "./infra-state.js";
import { dispatchGate, markAllocation } from "./infra-steps.js";

/** Readiness shares the Foundation terminal transaction, so no cancelled/stale run can leave a ready cell. */
export async function settleInfrastructure(
  state: InfrastructureState,
  tx: DatabaseAccess,
  runId: string,
  status: string,
) {
  const [allocation] = await tx
    .select()
    .from(schema.infrastructureAllocations)
    .where(eq(schema.infrastructureAllocations.runId, runId));
  if (!allocation || status !== "succeeded") return;
  const context = await contextFor(tx, runId),
    { operation } = await runFor(tx, runId);
  if (operation.status === "running") {
    try {
      await dispatchGate(state, tx, context);
    } catch (error) {
      if (error instanceof DomainError)
        throw new DomainError(
          "FENCED",
          "Infrastructure readiness authority changed before terminal settlement",
          409,
        );
      throw error;
    }
  } else if (operation.status === "reconciling") {
    await validatePreparation(state, tx, allocation.preparationId, allocation.id);
    if ((await currentEpoch(tx, allocation.environmentId)) !== context.epoch)
      throw new DomainError("FENCED", "Settlement activation epoch changed", 409);
  } else
    throw new DomainError(
      "FENCED",
      "Readiness requires current execution or reconciliation authority",
      409,
    );
  const steps = await tx
    .select()
    .from(schema.infrastructureSteps)
    .where(eq(schema.infrastructureSteps.allocationId, allocation.id));
  if (!steps.some((step) => step.kind === "sandbox" && step.state === "inspected" && step.evidence))
    throw new DomainError(
      "EVIDENCE_MISSING",
      "Complete running profile inspection is required for settlement",
      409,
    );
  await markAllocation(state, context, "verified", null, tx);
}
export async function markInfrastructureUncertain(
  state: InfrastructureState,
  tx: DatabaseAccess,
  runId: string,
) {
  const [allocation] = await tx
    .select()
    .from(schema.infrastructureAllocations)
    .where(eq(schema.infrastructureAllocations.runId, runId));
  if (!allocation || allocation.state === "released") return;
  const steps = await tx
    .select()
    .from(schema.infrastructureSteps)
    .where(eq(schema.infrastructureSteps.allocationId, allocation.id));
  await tx
    .update(schema.infrastructureAllocations)
    .set({
      state: allocation.state === "quarantined" ? "quarantined" : "unknown",
      cleanupState:
        allocation.cleanupState === "stopped"
          ? "stopped"
          : steps.some((step) => step.kind === "start")
            ? "pending"
            : "not_required",
      updatedAt: state.now(),
    })
    .where(eq(schema.infrastructureAllocations.id, allocation.id));
}
