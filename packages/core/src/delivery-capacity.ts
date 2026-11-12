import type { InfrastructureCapacityInput } from "@godseye/contracts";
import { type DatabaseAccess, schema } from "@godseye/store";
import { eq } from "drizzle-orm";
import type { DeliveryManifest } from "./delivery-provider.js";
import { DomainError } from "./errors.js";

/** Both the old active release and unconfirmed replacement occupy capacity; artifacts remain charged. */
export async function deliveryCommitments(
  tx: DatabaseAccess,
  existingId?: string,
  environmentId?: string,
): Promise<InfrastructureCapacityInput[]> {
  const rows = await tx.select().from(schema.deliveryRuns);
  const preparations = await tx.select().from(schema.deliveryPreparations);
  const result: InfrastructureCapacityInput[] = [];
  for (const row of rows) {
    if (
      row.id === existingId ||
      row.runId === existingId ||
      (environmentId && row.environmentId !== environmentId) ||
      ["built", "released", "retired"].includes(row.state) ||
      row.intent === "cleanup"
    )
      continue;
    const prep = preparations.find((item) => item.id === row.preparationId);
    if (!prep)
      throw new DomainError(
        "JOURNAL_INCONSISTENT",
        "Delivery reservation has no immutable manifest",
        500,
      );
    const manifest = prep.manifest as unknown as DeliveryManifest;
    result.push({ ...manifest.limits });
  }
  const artifacts = await tx.select().from(schema.deliveryArtifacts);
  const unique = new Map<string, number>();
  for (const artifact of artifacts) {
    if (environmentId && artifact.environmentId !== environmentId) continue;
    unique.set(
      `${artifact.environmentId}:${artifact.metadata.digest}`,
      artifact.metadata.sizeBytes,
    );
  }
  const bytes = [...unique.values()].reduce((total, size) => total + size, 0);
  if (bytes)
    result.push({
      cpuMilliCores: 0,
      memoryMiB: 0,
      storageGiB: Math.ceil(bytes / 1073741824),
      pids: 0,
    });
  return result;
}
export async function deliveryTargetFor(tx: DatabaseAccess, environmentId: string) {
  const [row] = await tx
    .select()
    .from(schema.deliveryTargets)
    .where(eq(schema.deliveryTargets.environmentId, environmentId));
  return row ?? { environmentId, activeDeploymentId: null, pendingRunId: null, generation: 0 };
}
