import {
  DATABASE_ROLES,
  RotationOverview,
  type RotationOverviewView,
  RotationRecord,
  type RotationRoleView,
} from "@godseye/contracts";
import { type Store, schema } from "@godseye/store";
import type { DatabaseRotationProvider } from "./database-rotation-provider.js";

type Rotation = typeof schema.databaseRotations.$inferSelect;
type Execution = RotationOverviewView["execution"];

/** Fresh qualification is required for mutation; a failing provider degrades only `execution`. */
export async function rotationQualified(provider: DatabaseRotationProvider, now: Date) {
  try {
    const proof = await provider.qualification();
    return (
      !!proof &&
      proof.providerId === provider.binding.providerId &&
      proof.targetId === provider.binding.targetId &&
      proof.generation === provider.binding.generation &&
      !!proof.evidence?.trim() &&
      Date.parse(proof.observedAt) <= now.getTime() &&
      Date.parse(proof.expiresAt) > now.getTime()
    );
  } catch {
    return false;
  }
}
export const rotationView = (row: Rotation) =>
  RotationRecord.parse({
    id: row.id,
    projectId: row.projectId,
    environmentId: row.environmentId,
    allocationId: row.allocationId,
    role: row.role,
    slotId: row.slotId,
    state: row.state,
    reason: row.reason,
    generation: row.generation,
    attempts: row.attempts,
    previousVerifier: row.previousVerifier,
    nextVerifier: row.nextVerifier,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    settledAt: row.settledAt?.toISOString() ?? null,
  });
const stateOf = (row: Rotation | undefined): RotationRoleView["state"] =>
  !row
    ? "never-rotated"
    : row.state === "intended" || row.state === "applying"
      ? "in-progress"
      : (row.state as "succeeded" | "failed" | "unknown");

async function slotView(store: Store, slotId: string | null) {
  if (!slotId) return null;
  const [slot] = (await store.db.select().from(schema.accessSlots)).filter(
    (item) => item.id === slotId,
  );
  if (!slot) return null;
  const operations = (await store.db.select().from(schema.accessOperations))
    .filter((item) => item.slotId === slotId)
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  const last = operations[0];
  return {
    id: slot.id,
    name: slot.name,
    state: slot.state as "empty" | "staged" | "active" | "unknown",
    activeVersion: slot.activeVersion,
    stagedVersion: slot.stagedVersion,
    lastOperation: last
      ? {
          id: last.id,
          kind: last.kind as "stage" | "activate",
          state: last.state as "pending" | "unknown" | "succeeded" | "failed",
          createdAt: last.createdAt.toISOString(),
        }
      : null,
  };
}
/** Database allocations x roles joined with durable rotation intents and linked access slots. */
export async function rotationOverview(
  store: Store,
  options: { now: () => Date; provider?: DatabaseRotationProvider },
): Promise<RotationOverviewView> {
  const execution: Execution = !options.provider
    ? "unconfigured"
    : (await rotationQualified(options.provider, options.now()))
      ? "qualified"
      : "unavailable";
  const rotations = (await store.db.select().from(schema.databaseRotations)).sort(
    (a, b) => a.createdAt.getTime() - b.createdAt.getTime(),
  );
  const allocations = (await store.db.select().from(schema.databaseAllocations)).filter(
    (item) => item.state !== "released",
  );
  const roles: RotationRoleView[] = [];
  for (const allocation of allocations) {
    for (const role of DATABASE_ROLES) {
      const own = rotations.filter(
        (item) => item.allocationId === allocation.id && item.role === role,
      );
      const latest = own.at(-1);
      const settled = own.filter((item) => item.state === "succeeded").at(-1);
      const linked = [...own].reverse().find((item) => item.slotId)?.slotId ?? null;
      roles.push({
        projectId: allocation.projectId,
        environmentId: allocation.environmentId,
        allocationId: allocation.id,
        role,
        state: stateOf(latest),
        lastRotationId: latest?.id ?? null,
        lastRotatedAt: settled?.settledAt?.toISOString() ?? null,
        slot: await slotView(store, linked),
      });
    }
  }
  return RotationOverview.parse({ execution, roles, rotations: rotations.map(rotationView) });
}
