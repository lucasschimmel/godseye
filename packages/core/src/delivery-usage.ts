import { DeliveryMigrationLock, DeliveryUsage } from "@godseye/contracts";
import type { DatabaseAccess } from "@godseye/store";
import { schema } from "@godseye/store";
import type { DeliveryResourceUsage } from "./delivery-provider.js";

/** Records provider-reported local usage. costMicros is always zero: nothing is billed locally. */
export async function recordDeliveryUsage(
  tx: DatabaseAccess,
  run: { runId: string; projectId: string; environmentId: string; intent: string },
  usage: DeliveryResourceUsage | undefined,
  now: Date,
) {
  if (!usage) return;
  const values = {
    runId: run.runId,
    projectId: run.projectId,
    environmentId: run.environmentId,
    intent: run.intent as "build" | "release" | "rollback" | "cleanup",
    cpuMilliSeconds: usage.cpuMilliSeconds,
    peakMemoryMiB: usage.peakMemoryMiB,
    diskMiB: usage.diskMiB,
    durationMs: usage.durationMs,
    recordedAt: now,
  };
  await tx
    .insert(schema.deliveryUsage)
    .values(values)
    .onConflictDoUpdate({ target: schema.deliveryUsage.runId, set: values });
}
export const deliveryUsageView = (row: typeof schema.deliveryUsage.$inferSelect) =>
  DeliveryUsage.parse({
    runId: row.runId,
    projectId: row.projectId,
    environmentId: row.environmentId,
    intent: row.intent,
    cpuMilliSeconds: row.cpuMilliSeconds,
    peakMemoryMiB: row.peakMemoryMiB,
    diskMiB: row.diskMiB,
    durationMs: row.durationMs,
    costMicros: 0,
    billing: "local-unbilled",
    recordedAt: row.recordedAt.toISOString(),
  });
export const deliveryLockView = (row: typeof schema.deliveryMigrationLocks.$inferSelect) =>
  DeliveryMigrationLock.parse({
    environmentId: row.environmentId,
    runId: row.runId,
    preparationId: row.preparationId,
    migration: { class: row.migrationClass, hash: row.migrationHash },
    fence: row.fence,
    state: row.state,
    updatedAt: row.updatedAt.toISOString(),
  });
