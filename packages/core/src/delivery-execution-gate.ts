import type { ExecutionContext } from "@godseye/contracts";
import { type DatabaseAccess, schema } from "@godseye/store";
import { eq } from "drizzle-orm";
import { validateDeliveryManifest } from "./delivery-admission.js";
import { deliveryDelegatedAuthority } from "./delivery-authority.js";
import { deliveryTargetFor } from "./delivery-capacity.js";
import {
  DELIVERY_DESTINATION,
  type DeliveryState,
  deliveryActor,
  deliveryPreparationFor,
  deliveryScope,
  qualifyDelivery,
  verifyDeliverySource,
} from "./delivery-state.js";
import { DomainError } from "./errors.js";
import { currentEpoch, foundationState, planFor, runFor } from "./foundation-data.js";
import { contextFor, validApproval } from "./foundation-queue.js";
import { fingerprint, write } from "./journal.js";

export async function deliveryExecutionGate(
  state: DeliveryState,
  tx: DatabaseAccess,
  context: ExecutionContext,
  readOnly = false,
) {
  const { run, operation } = await runFor(tx, context.runId);
  if (
    fingerprint(await contextFor(tx, context.runId)) !== fingerprint(context) ||
    !run.leaseExpiresAt ||
    run.leaseExpiresAt.getTime() <= state.now().getTime() ||
    (!readOnly && run.epoch !== (await currentEpoch(tx, run.environmentId))) ||
    operation.status !== (readOnly ? "reconciling" : "running")
  )
    throw new DomainError(
      "FENCED",
      "Delivery worker context or lease no longer owns this execution",
      409,
    );
  const [delivery] = await tx
    .select()
    .from(schema.deliveryRuns)
    .where(eq(schema.deliveryRuns.runId, context.runId));
  const command = context.command;
  if (!delivery || command.kind !== "delivery.lifecycle")
    throw new DomainError("FENCED", "Delivery mapping is missing", 409);
  const { row, manifest } = await deliveryPreparationFor(tx, delivery.preparationId);
  const [authorization] = await tx
    .select()
    .from(schema.deliveryCommands)
    .where(eq(schema.deliveryCommands.planId, context.planId));
  const target = await deliveryTargetFor(tx, context.environmentId);
  if (
    !authorization ||
    authorization.preparationId !== row.id ||
    authorization.epoch !== context.epoch ||
    command.manifestRef !== row.id ||
    command.manifestHash !== row.hash ||
    command.intent !== row.intent ||
    delivery.environmentId !== context.environmentId ||
    delivery.projectId !== context.projectId ||
    target.pendingRunId !== context.runId ||
    target.generation !== delivery.generation ||
    fingerprint(state.provider?.binding ?? null) !== fingerprint(manifest.binding)
  )
    throw new DomainError("FENCED", "Delivery command, provider or target generation changed", 409);
  if (!readOnly) {
    await validateDeliveryManifest(state, tx, manifest);
    await state.foundation.assertDispatch(tx, context, {
      actorId: context.workerId,
      tool: `delivery.${row.intent}`,
      destination: DELIVERY_DESTINATION,
      costMicros: 0,
    });
    await validApproval(
      tx,
      foundationState(state.store, {
        now: state.now,
        delegatedAuthority: (access, plan, phase, actor) =>
          deliveryDelegatedAuthority(state, access, plan, phase, actor),
      }),
      await planFor(tx, deliveryActor(row.projectId), context.planId),
    );
  }
  return {
    delivery,
    preparation: row,
    manifest,
    target,
    scope: deliveryScope(context, manifest, row.hash, delivery.generation),
  };
}
export async function deliveryDispatchGuard(state: DeliveryState, context: ExecutionContext) {
  await qualifyDelivery(state);
  const current = await write(state.store, (tx) => deliveryExecutionGate(state, tx, context));
  if (current.manifest.intent !== "cleanup") await verifyDeliverySource(state, current.manifest);
  else if (current.manifest.cleanupReason === "closed") {
    const source = await verifyDeliverySource(state, current.manifest, false);
    if (source.pullRequestOpen)
      throw new DomainError(
        "PREVIEW_OPEN",
        "Current pull request reopened before protective cleanup",
        409,
      );
  }
  await write(state.store, (tx) => deliveryExecutionGate(state, tx, context));
}
