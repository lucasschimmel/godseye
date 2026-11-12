import type { CreateExecutionPlanInput } from "@godseye/contracts";
import { type DatabaseAccess, schema } from "@godseye/store";
import { eq } from "drizzle-orm";
import { previewFor } from "./delivery-preview.js";
import {
  DELIVERY_ADAPTER_ID,
  DELIVERY_DESTINATION,
  DELIVERY_SCHEDULER_ID,
  type DeliveryState,
  deliveryActor,
  deliveryPreparationFor,
  validateDeliveryPolicy,
} from "./delivery-state.js";
import { DomainError } from "./errors.js";
import { environmentFor } from "./foundation-data.js";
import { fingerprint } from "./journal.js";
import type { Actor } from "./policy.js";

export async function deliveryDelegatedAuthority(
  state: DeliveryState,
  tx: DatabaseAccess,
  plan: CreateExecutionPlanInput,
  phase: "create" | "enqueue" | "approval",
  actor?: Actor,
) {
  if (plan.adapterId !== DELIVERY_ADAPTER_ID || plan.command.kind !== "delivery.lifecycle")
    return false;
  if (
    actor &&
    (actor.id !== DELIVERY_SCHEDULER_ID ||
      actor.kind !== "service" ||
      actor.projectIds.length !== 1 ||
      actor.projectIds[0] !== plan.projectId)
  )
    return false;
  try {
    const { row, manifest } = await deliveryPreparationFor(tx, plan.command.manifestRef);
    const policy = await validateDeliveryPolicy(state, tx, row.policyId, row.intent === "cleanup");
    if (row.intent === "rollback" || (!policy.input.autoDeploy && row.intent !== "cleanup"))
      return false;
    await environmentFor(
      tx,
      deliveryActor(row.projectId),
      row.projectId,
      row.environmentId,
      false,
      row.intent === "cleanup",
      state.now(),
    );
    if (
      plan.projectId !== row.projectId ||
      plan.environmentId !== row.environmentId ||
      plan.targetId !== row.id ||
      plan.expectedRevision !== manifest.projectRevision ||
      plan.command.intent !== row.intent ||
      plan.command.manifestHash !== row.hash ||
      plan.maxCostMicros !== 0 ||
      fingerprint(plan.tools) !== fingerprint([`delivery.${row.intent}`]) ||
      fingerprint(plan.destinations) !== fingerprint([DELIVERY_DESTINATION]) ||
      policy.hash !== manifest.policyHash
    )
      return false;
    if (row.intent === "cleanup") {
      const preview = await previewFor(tx, row.environmentId);
      if (
        !preview ||
        preview.policyId !== policy.id ||
        !manifest.syntheticDataOnly ||
        !manifest.cleanupReason
      )
        return false;
    }
    if (phase !== "create") {
      const commands = await tx
        .select()
        .from(schema.deliveryCommands)
        .where(eq(schema.deliveryCommands.preparationId, row.id));
      const plans = await tx
        .select()
        .from(schema.executionPlans)
        .where(
          eq(
            schema.executionPlans.id,
            commands.find((command) => command.authority === "policy")?.planId ??
              "00000000-0000-4000-8000-000000000000",
          ),
        );
      const digest = fingerprint({
        projectId: plan.projectId,
        environmentId: plan.environmentId,
        targetId: plan.targetId,
        expectedRevision: plan.expectedRevision,
        adapterId: plan.adapterId,
        command: plan.command,
        maxCostMicros: plan.maxCostMicros,
        tools: plan.tools,
        destinations: plan.destinations,
      });
      if (!plans.some((candidate) => candidate.hash === digest)) return false;
    }
    return true;
  } catch (error) {
    if (!(error instanceof DomainError)) throw error;
    return false;
  }
}
