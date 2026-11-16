import { type DatabaseAccess, schema } from "@godseye/store";
import { eq } from "drizzle-orm";
import { validateDeliveryManifest } from "./delivery-admission.js";
import { deliveryExecutionGate } from "./delivery-execution-gate.js";
import { markMigrationUncertain, releaseMigrationLock } from "./delivery-migration.js";
import { type DeliveryState, deliveryPreparationFor } from "./delivery-state.js";
import { DomainError } from "./errors.js";
import { currentEpoch, runFor } from "./foundation-data.js";
import { contextFor } from "./foundation-queue.js";
import { fingerprint } from "./journal.js";

export async function settleDelivery(
  state: DeliveryState,
  tx: DatabaseAccess,
  runId: string,
  status: string,
) {
  const [row] = await tx
    .select()
    .from(schema.deliveryRuns)
    .where(eq(schema.deliveryRuns.runId, runId));
  if (!row) return;
  const { manifest } = await deliveryPreparationFor(tx, row.preparationId);
  const success = status === "succeeded" && !!row.evidence;
  if (success) {
    try {
      const context = await contextFor(tx, runId);
      const { operation } = await runFor(tx, runId);
      const readOnly = operation.status === "reconciling";
      const gate = await deliveryExecutionGate(state, tx, context, readOnly);
      if (readOnly) {
        await validateDeliveryManifest(state, tx, manifest, false, true);
        if (
          manifest.intent !== "build" &&
          manifest.intent !== "cleanup" &&
          context.epoch !== (await currentEpoch(tx, row.environmentId))
        )
          throw new DomainError(
            "FENCED",
            "Delivery activation epoch changed before terminal settlement",
            409,
          );
      }
      const steps = await tx
        .select()
        .from(schema.deliverySteps)
        .where(eq(schema.deliverySteps.runId, runId));
      const required =
        row.intent === "build"
          ? ["build"]
          : row.intent === "cleanup"
            ? ["cleanup"]
            : ["stage", "readiness", "promote"];
      if (
        required.some(
          (step) =>
            !steps.some(
              (item) =>
                item.step === step &&
                item.state === "observed" &&
                item.scopeHash === fingerprint(gate.scope) &&
                !!item.evidence,
            ),
        )
      )
        throw new DomainError(
          "EVIDENCE_MISSING",
          "Terminal delivery requires every exact observed step",
          409,
        );
    } catch (error) {
      if (error instanceof DomainError)
        throw new DomainError(
          "FENCED",
          "Delivery authority changed before terminal settlement",
          409,
        );
      throw error;
    }
  }
  const failedWithoutEffect = status === "failed" && row.state === "released";
  const next = success
    ? row.intent === "build"
      ? "built"
      : row.intent === "cleanup"
        ? "retired"
        : "active"
    : failedWithoutEffect
      ? "released"
      : "unknown";
  await tx
    .update(schema.deliveryRuns)
    .set({ state: next, updatedAt: state.now() })
    .where(eq(schema.deliveryRuns.id, row.id));
  if (success || failedWithoutEffect) await releaseMigrationLock(tx, runId, state.now());
  else await markMigrationUncertain(tx, runId, state.now());
  if (success || failedWithoutEffect) {
    await tx
      .update(schema.deliveryTargets)
      .set({
        pendingRunId: null,
        ...(success && row.intent !== "build"
          ? { activeDeploymentId: row.intent === "cleanup" ? null : row.id }
          : {}),
      })
      .where(eq(schema.deliveryTargets.environmentId, row.environmentId));
    if (success && row.previousDeploymentId && row.intent !== "build")
      await tx
        .update(schema.deliveryRuns)
        .set({ state: "retired", updatedAt: state.now() })
        .where(eq(schema.deliveryRuns.id, row.previousDeploymentId));
  }
  if (row.intent === "build")
    await tx
      .update(schema.ciRuns)
      .set({
        status: success
          ? "succeeded"
          : failedWithoutEffect
            ? row.reason === "STALE_HEAD"
              ? "superseded"
              : "failed"
            : "running",
        errorCode: success ? null : row.reason,
        updatedAt: state.now(),
      })
      .where(eq(schema.ciRuns.id, manifest.ciRunId));
}
export async function releaseQueuedDelivery(
  state: DeliveryState,
  tx: DatabaseAccess,
  runId: string,
) {
  const [row] = await tx
    .select()
    .from(schema.deliveryRuns)
    .where(eq(schema.deliveryRuns.runId, runId));
  if (!row) return;
  const steps = await tx
    .select()
    .from(schema.deliverySteps)
    .where(eq(schema.deliverySteps.runId, runId));
  if (steps.length)
    throw new DomainError(
      "RECONCILIATION_REQUIRED",
      "Delivery intention retains capacity and target lock",
      409,
    );
  await tx
    .update(schema.deliveryRuns)
    .set({ state: "released", updatedAt: state.now() })
    .where(eq(schema.deliveryRuns.id, row.id));
  await releaseMigrationLock(tx, runId, state.now());
  await tx
    .update(schema.deliveryTargets)
    .set({ pendingRunId: null })
    .where(eq(schema.deliveryTargets.environmentId, row.environmentId));
}
export async function uncertainDelivery(state: DeliveryState, tx: DatabaseAccess, runId: string) {
  const [row] = await tx
    .select()
    .from(schema.deliveryRuns)
    .where(eq(schema.deliveryRuns.runId, runId));
  await tx
    .update(schema.deliveryRuns)
    .set({ state: "unknown", reason: "RECONCILIATION_REQUIRED", updatedAt: state.now() })
    .where(eq(schema.deliveryRuns.runId, runId));
  await markMigrationUncertain(tx, runId, state.now());
  if (row && row.intent !== "build")
    await tx
      .update(schema.deliveryPreviews)
      .set({ state: "unknown", url: null, updatedAt: state.now() })
      .where(eq(schema.deliveryPreviews.environmentId, row.environmentId));
}
