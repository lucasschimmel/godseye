import {
  type DeclareInventoryInput,
  HEADROOM_RESOURCES,
  INFRASTRUCTURE_PRESSURE,
  InfrastructureHeadroom,
  type InfrastructureHeadroomView,
  type InfrastructureObservationInput,
} from "@godseye/contracts";
import { type DatabaseAccess, schema } from "@godseye/store";
import { eq } from "drizzle-orm";
import { admissionControlFor } from "./infra-admission.js";
import type { HeavyTaskPolicy } from "./infra-heavy.js";
import { heavyCounts, heavyFull } from "./infra-heavy.js";
import {
  type InfrastructureState,
  inventoryFor,
  observationStateOf,
  poolRequirements,
} from "./infra-state.js";
import { type Actor, assertOwner } from "./policy.js";

type Resource = InfrastructureHeadroomView["scopes"][number]["resources"][number];
type Pressure = Resource["pressure"];
type Capacity = {
  cpuMilliCores: number;
  memoryMiB: number;
  storageGiB: number;
  pids: number | null;
};
const SOURCES = {
  cpu: { key: "cpuMilliCores", unit: "milliCores" },
  memory: { key: "memoryMiB", unit: "MiB" },
  disk: { key: "storageGiB", unit: "GiB" },
  wal: { key: "storageGiB", unit: "GiB" },
  pids: { key: "pids", unit: "count" },
} as const;
const SEVERITY: Record<Pressure, number> = { ok: 0, unknown: 1, warn: 2, critical: 3 };
/** Unknown outranks ok: missing evidence can never make a scope look healthy. */
export const worstPressure = (values: Pressure[]): Pressure =>
  values.reduce<Pressure>(
    (worst, value) => (SEVERITY[value] > SEVERITY[worst] ? value : worst),
    "ok",
  );
export function classifyPressure(capacity: number, committed: number, reserve: number): Pressure {
  const utilization = capacity > 0 ? (committed + reserve) / capacity : 1;
  if (committed + reserve > capacity || utilization >= INFRASTRUCTURE_PRESSURE.criticalUtilization)
    return "critical";
  return utilization >= INFRASTRUCTURE_PRESSURE.warnUtilization ? "warn" : "ok";
}
function resourceRow(
  resource: Resource["resource"],
  committed: number,
  reserve: number | null,
  capacity: number | null,
  reason: string | null,
): Resource {
  const known = capacity !== null && reserve !== null;
  return {
    resource,
    unit: SOURCES[resource].unit,
    state: known ? "known" : "unknown",
    capacity,
    committed,
    protectedReserve: reserve,
    free: known ? capacity - reserve - committed : null,
    utilization: known ? (capacity > 0 ? (committed + reserve) / capacity : 1) : null,
    pressure: known ? classifyPressure(capacity, committed, reserve) : "unknown",
    reason: known ? null : (reason ?? "Capacity is not measured"),
  };
}
interface ScopeInput {
  committed: Capacity[];
  walCommitted: number;
  reserve: Capacity | null;
  capacity: Capacity | null;
  reason: string | null;
  wal: boolean;
}
function scopeResources(input: ScopeInput): Resource[] {
  const rows = HEADROOM_RESOURCES.filter((name) => input.wal || name !== "wal").map((name) => {
    const { key } = SOURCES[name];
    const committed =
      name === "wal"
        ? input.walCommitted
        : input.committed.reduce((sum, part) => sum + (part[key] ?? 0), 0);
    const capacity = input.capacity?.[key] ?? null;
    const reason =
      input.reason ??
      (input.capacity && capacity === null ? "Not measured by the collector" : null);
    return resourceRow(name, committed, input.reserve?.[key] ?? null, capacity, reason);
  });
  const disk = rows.find((row) => row.resource === "disk");
  // WAL shares the data volume: it reports its own commitment against the same capacity and pressure.
  return rows.map((row) =>
    row.resource === "wal" && disk ? { ...disk, resource: "wal", committed: row.committed } : row,
  );
}
function poolCapacity(desired: DeclareInventoryInput, observation: InfrastructureObservationInput) {
  const pick = (a: number, b: number | null) => (b === null ? null : Math.min(a, b));
  const own = desired.pool.capacity;
  return {
    cpuMilliCores: Math.min(own.cpuMilliCores, observation.capacity.cpuMilliCores),
    memoryMiB: Math.min(own.memoryMiB, observation.capacity.memoryMiB),
    storageGiB: Math.min(own.storageGiB, observation.capacity.storageGiB),
    pids: pick(own.pids, observation.capacity.pids),
  };
}
function evidenceReason(
  desired: DeclareInventoryInput | null,
  observation: InfrastructureObservationInput | null,
  observed: "unknown" | "stale" | "observed",
  needsProfessional: boolean,
) {
  if (!desired) return "Desired inventory is not declared";
  if (observed === "unknown") return "No trusted observation is available";
  if (observed === "stale") return "The observation is stale";
  if (needsProfessional && observation?.target !== "professional-vm")
    return "The observation is not from the professional VM";
  return null;
}
async function walCommitted(tx: DatabaseAccess) {
  let total = 0;
  for (const allocation of await tx.select().from(schema.databaseAllocations)) {
    if (allocation.state === "released") continue;
    const [preparation] = await tx
      .select()
      .from(schema.databasePreparations)
      .where(eq(schema.databasePreparations.id, allocation.preparationId));
    total += preparation?.profile.walGiB ?? 0;
  }
  return total;
}
export async function infrastructureHeadroom(
  state: InfrastructureState,
  policy: HeavyTaskPolicy,
  actor: Actor,
  tx: DatabaseAccess = state.store.db,
): Promise<InfrastructureHeadroomView> {
  assertOwner(actor);
  const inventory = await inventoryFor(tx);
  const { desired, observation } = inventory;
  const observed = observationStateOf(observation, state.now());
  const usable = observed === "observed" ? observation : null;
  const poolReason = evidenceReason(desired, usable, observed, true);
  const hostReason =
    evidenceReason(desired, usable, observed, false) ??
    (usable?.hostCapacity ? null : "Physical host capacity is not observed");
  const pool = scopeResources({
    committed: await poolRequirements(tx),
    walCommitted: await walCommitted(tx),
    reserve: desired?.pool.headroom ?? null,
    capacity: !poolReason && desired && usable ? poolCapacity(desired, usable) : null,
    reason: poolReason,
    wal: true,
  });
  const host = scopeResources({
    committed: desired?.guests.map((guest) => guest.capacity) ?? [],
    walCommitted: 0,
    reserve: desired?.host.headroom ?? null,
    capacity: hostReason ? null : (usable?.hostCapacity ?? null),
    reason: hostReason,
    wal: false,
  });
  const scopes = [
    { scope: "host" as const, name: desired?.host.name ?? "Physical host", resources: host },
    { scope: "pool" as const, name: "Professional pool", resources: pool },
  ].map((scope) => ({ ...scope, pressure: worstPressure(scope.resources.map((r) => r.pressure)) }));
  const counts = await heavyCounts(tx, policy);
  const full = heavyFull(policy, counts);
  return InfrastructureHeadroom.parse({
    generatedAt: state.now().toISOString(),
    observationState: observed,
    pressure: worstPressure(scopes.map((scope) => scope.pressure)),
    thresholds: {
      warn: INFRASTRUCTURE_PRESSURE.warnUtilization,
      critical: INFRASTRUCTURE_PRESSURE.criticalUtilization,
    },
    scopes,
    heavyQueue: {
      maxConcurrent: policy.maxConcurrent,
      maxQueued: policy.maxQueued,
      ...counts,
      full,
      reason: full
        ? `Heavy-task queue is full: ${counts.running} running and ${counts.queued} waiting`
        : null,
    },
    admission: await admissionControlFor(tx),
  });
}
