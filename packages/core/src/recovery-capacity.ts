import { type DatabaseAccess, schema } from "@godseye/store";
import { databasePreparationFor } from "./database-state.js";
import { databaseCapacity } from "./infra-state.js";
import { type RecoveryPreparationRow, recoveryPreparationFor } from "./recovery-state.js";

/** Conservative physical reservations survive failures and lost acknowledgments. Source ledger remains separate. */
export async function recoveryCommitments(
  tx: DatabaseAccess,
  existingId?: string,
  candidate?: RecoveryPreparationRow,
) {
  const rows = await tx.select().from(schema.recoveryRuns);
  const reservations = [];
  const repositories = new Map<string, { storageGiB: number }>();
  const retained: { preparation: RecoveryPreparationRow; state: string }[] = [];
  for (const run of rows) {
    if (run.state === "released" || run.id === existingId) continue;
    retained.push({
      preparation: await recoveryPreparationFor(tx, run.preparationId),
      state: run.state,
    });
  }
  if (candidate) retained.push({ preparation: candidate, state: "reserved" });
  for (const { preparation, state } of retained) {
    const allocations = await tx.select().from(schema.databaseAllocations);
    const source = allocations.find((row) => row.id === preparation.sourceAllocationId);
    if (!source) throw new Error("Retained recovery source reservation is missing");
    const original = await databasePreparationFor(tx, source.preparationId);
    const target =
      preparation.kind === "restore"
        ? databaseCapacity(original.profile)
        : {
            cpuMilliCores: 0,
            memoryMiB: 0,
            storageGiB: 0,
            pids: 0,
          };
    const repository = repositories.get(preparation.repositoryId);
    repositories.set(preparation.repositoryId, {
      storageGiB: Math.max(
        repository?.storageGiB ?? 0,
        preparation.policy.repositoryGiB + preparation.policy.archiveHeadroomGiB,
      ),
    });
    reservations.push({
      ...target,
      storageGiB:
        target.storageGiB +
        (["reserved", "unknown"].includes(state) ? preparation.policy.stagingGiB : 0),
    });
  }
  for (const repository of repositories.values())
    reservations.push({ cpuMilliCores: 0, memoryMiB: 0, pids: 0, ...repository });
  return reservations;
}
export async function recoveryAdditionalCapacity(
  tx: DatabaseAccess,
  row: RecoveryPreparationRow,
  existingId?: string,
) {
  const prior = await recoveryCommitments(tx, existingId),
    next = await recoveryCommitments(tx, existingId, row);
  const total = (items: typeof prior, key: "cpuMilliCores" | "memoryMiB" | "storageGiB" | "pids") =>
    items.reduce((sum, item) => sum + item[key], 0);
  return {
    cpuMilliCores: total(next, "cpuMilliCores") - total(prior, "cpuMilliCores"),
    memoryMiB: total(next, "memoryMiB") - total(prior, "memoryMiB"),
    storageGiB: total(next, "storageGiB") - total(prior, "storageGiB"),
    pids: total(next, "pids") - total(prior, "pids"),
  };
}
