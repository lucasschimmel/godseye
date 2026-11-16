import type {
  DeclareInventoryInput,
  InfrastructureCapacityInput,
  InfrastructureObservationInput,
} from "@godseye/contracts";
import { type DatabaseAccess, type Store, schema } from "@godseye/store";
import { eq } from "drizzle-orm";
import { deliveryCommitments } from "./delivery-capacity.js";
import { DomainError } from "./errors.js";
import { assertFresh, foundationState } from "./foundation-data.js";
import type { FoundationEngine } from "./foundations.js";
import { parsePrivateSubnet } from "./infra-network.js";
import type { CompiledApplication } from "./infra-policy.js";
import { INFRASTRUCTURE_POLICY_VERSION } from "./infra-policy.js";
import type { InfrastructureCollector, InfrastructureProvider } from "./infra-provider.js";
import { fingerprint } from "./journal.js";
import type { Actor } from "./policy.js";
import { recoveryCommitments } from "./recovery-capacity.js";

export const INFRA_ADAPTER_ID = "local.infrastructure";
export const INFRA_DESTINATION = "professional.local";
export interface InfrastructureState {
  store: Store;
  now: () => Date;
  collector: InfrastructureCollector;
  provider?: InfrastructureProvider;
  foundation: FoundationEngine;
}
export const assertInfrastructureFresh = (state: InfrastructureState, actor: Actor) =>
  assertFresh(actor, foundationState(state.store, { now: state.now }));
export async function inventoryFor(tx: DatabaseAccess) {
  const [row] = await tx
    .select()
    .from(schema.infrastructureInventory)
    .where(eq(schema.infrastructureInventory.id, 1));
  if (!row)
    throw new DomainError("JOURNAL_INCONSISTENT", "Infrastructure inventory is missing", 500);
  return row;
}
export async function preparationFor(tx: DatabaseAccess, id: string) {
  const [row] = await tx
    .select()
    .from(schema.infrastructurePreparations)
    .where(eq(schema.infrastructurePreparations.id, id));
  if (!row) throw new DomainError("NOT_FOUND", "Infrastructure preparation not found", 404);
  if (row.policyVersion !== INFRASTRUCTURE_POLICY_VERSION || fingerprint(row.manifest) !== row.hash)
    throw new DomainError("PLAN_TAMPERED", "Infrastructure preparation is inconsistent", 409);
  return row;
}
export const preparationManifest = (row: typeof schema.infrastructurePreparations.$inferSelect) =>
  row.manifest as unknown as CompiledApplication;
export function observationReasons(observation: InfrastructureObservationInput | null, now: Date) {
  if (!observation) return ["No trusted professional-VM observation is available"];
  const age = now.getTime() - Date.parse(observation.observedAt);
  if (
    age < 0 ||
    Date.parse(observation.expiresAt) <= now.getTime() ||
    Date.parse(observation.expiresAt) - Date.parse(observation.observedAt) > 300_000
  )
    return ["Trusted observation is stale or has an invalid freshness window"];
  const reasons = [...observation.reasons];
  if (observation.target !== "professional-vm" || !observation.hostCapacity)
    reasons.push("Local development PC is not the professional VM or physical host");
  for (const [capability, available] of Object.entries(observation.qualification))
    if (!available) reasons.push(`Unqualified capability: ${capability}`);
  return reasons;
}
/** Missing evidence is "unknown"; expired or malformed freshness windows are "stale", never healthy. */
export function observationStateOf(observation: InfrastructureObservationInput | null, now: Date) {
  if (!observation) return "unknown" as const;
  const observed = Date.parse(observation.observedAt),
    expires = Date.parse(observation.expiresAt);
  return now.getTime() < observed || expires <= now.getTime() || expires - observed > 300_000
    ? ("stale" as const)
    : ("observed" as const);
}
const dimensions = ["cpuMilliCores", "memoryMiB", "storageGiB", "pids"] as const;
function fits(
  total: Omit<InfrastructureCapacityInput, "pids"> & { pids: number | null },
  used: InfrastructureCapacityInput[],
) {
  return dimensions.every((key) => {
    const available = total[key];
    return available !== null && used.reduce((sum, part) => sum + part[key], 0) <= available;
  });
}
export function validateDesired(data: DeclareInventoryInput) {
  const roles = data.guests.map((guest) => guest.role);
  if (
    new Set(roles).size !== roles.length ||
    !roles.includes("professional") ||
    !roles.includes("games")
  )
    throw new DomainError(
      "INVALID_TOPOLOGY",
      "Exactly one professional VM, one games VM and at most one disposable task VM are allowed",
      422,
    );
  if (data.publicIpv4Count === 2 && !data.secondIpv4Justification)
    throw new DomainError(
      "IPV4_JUSTIFICATION_REQUIRED",
      "A second paid IPv4 requires an explicit justification",
      422,
    );
  const professional = data.guests.find((guest) => guest.role === "professional");
  if (
    !professional ||
    !fits(data.host.capacity, [
      data.host.headroom,
      ...data.guests.map((guest) => guest.capacity),
    ]) ||
    !fits(professional.capacity, [data.pool.capacity]) ||
    !fits(data.pool.capacity, [data.pool.headroom])
  )
    throw new DomainError(
      "CAPACITY_EXCEEDED",
      "Guest or pool commitments exceed declared capacity and headroom",
      409,
    );
  const v4 = parsePrivateSubnet(data.pool.ipv4Pool),
    v6 = parsePrivateSubnet(data.pool.ipv6Pool);
  if (
    v4.family !== 4 ||
    v4.prefix < 16 ||
    v4.prefix > 28 ||
    v6.family !== 6 ||
    v6.prefix < 48 ||
    v6.prefix > 64
  )
    throw new DomainError(
      "INVALID_NETWORK",
      "Cell pools require bounded private IPv4 and ULA IPv6 prefixes",
      422,
    );
  data.pool.ipv4Pool = v4.canonical;
  data.pool.ipv6Pool = v6.canonical;
}
export async function validateCapacity(
  tx: DatabaseAccess,
  desired: DeclareInventoryInput,
  observation: InfrastructureObservationInput,
  manifest: CompiledApplication,
  existingId?: string,
) {
  return validatePoolCapacity(
    tx,
    desired,
    observation,
    {
      cpuMilliCores: manifest.limits.cpuMilliCores,
      memoryMiB: manifest.limits.memoryMiB + manifest.limits.temporaryMiB,
      storageGiB: manifest.limits.dataGiB,
      pids: manifest.limits.pids,
    },
    existingId,
  );
}
/** Every active professional-pool reservation ledger, shared by admission checks and headroom reporting. */
export async function poolRequirements(tx: DatabaseAccess, existingId?: string) {
  const rows = await tx.select().from(schema.infrastructureAllocations);
  const reserved: CompiledApplication[] = [];
  for (const row of rows) {
    if (row.state === "released" || row.id === existingId) continue;
    reserved.push(preparationManifest(await preparationFor(tx, row.preparationId)));
  }
  const requirements = reserved.map((item) => ({
    cpuMilliCores: item.limits.cpuMilliCores,
    memoryMiB: item.limits.memoryMiB + item.limits.temporaryMiB,
    storageGiB: item.limits.dataGiB,
    pids: item.limits.pids,
  }));
  const databases = await tx.select().from(schema.databaseAllocations);
  for (const allocation of databases) {
    if (allocation.state === "released" || allocation.id === existingId) continue;
    const [preparation] = await tx
      .select()
      .from(schema.databasePreparations)
      .where(eq(schema.databasePreparations.id, allocation.preparationId));
    if (!preparation)
      throw new DomainError("JOURNAL_INCONSISTENT", "Database reservation profile missing", 500);
    requirements.push(databaseCapacity(preparation.profile));
  }
  requirements.push(
    ...(await recoveryCommitments(tx, existingId)),
    ...(await deliveryCommitments(tx, existingId)),
  );
  return requirements;
}
export async function validatePoolCapacity(
  tx: DatabaseAccess,
  desired: DeclareInventoryInput,
  observation: InfrastructureObservationInput,
  requested: InfrastructureCapacityInput,
  existingId?: string,
) {
  validateDesired(structuredClone(desired));
  if (
    !observation.hostCapacity ||
    !fits(observation.hostCapacity, [
      desired.host.headroom,
      ...desired.guests.map((guest) => guest.capacity),
    ])
  )
    throw new DomainError(
      "CAPACITY_EXCEEDED",
      "Observed host cannot satisfy guest commitments and host headroom",
      409,
    );
  const requirements = [...(await poolRequirements(tx, existingId)), requested];
  // Cells fit inside the already committed professional VM, never added again to physical guest memory.
  if (
    !fits(desired.pool.capacity, [desired.pool.headroom, ...requirements]) ||
    !fits(observation.capacity, [desired.pool.headroom, ...requirements])
  )
    throw new DomainError(
      "CAPACITY_EXCEEDED",
      "Professional pool capacity or enforced data storage is exhausted",
      409,
    );
}
export function databaseCapacity(profile: {
  cpuMilliCores: number;
  memoryMiB: number;
  temporaryMiB: number;
  dataGiB: number;
  walGiB: number;
  maxConnections: number;
}) {
  return {
    cpuMilliCores: profile.cpuMilliCores,
    memoryMiB: profile.memoryMiB,
    storageGiB:
      profile.dataGiB +
      profile.walGiB +
      Math.ceil((profile.maxConnections * profile.temporaryMiB) / 1024),
    pids: profile.maxConnections + 16,
  };
}
/** Reuses both reservation ledgers inside the caller's atomic admission transaction. */
export async function validateEnvironmentCapacity(
  tx: DatabaseAccess,
  environmentId: string,
  requested: InfrastructureCapacityInput,
  existingId?: string,
) {
  const [env] = await tx
    .select()
    .from(schema.environments)
    .where(eq(schema.environments.id, environmentId));
  if (!env) throw new DomainError("JOURNAL_INCONSISTENT", "Environment capacity is missing", 500);
  const requirements = [{ ...requested }];
  const applications = await tx
    .select()
    .from(schema.infrastructureAllocations)
    .where(eq(schema.infrastructureAllocations.environmentId, env.id));
  for (const allocation of applications) {
    if (allocation.state === "released" || allocation.id === existingId) continue;
    const manifest = preparationManifest(await preparationFor(tx, allocation.preparationId));
    requirements.push({
      cpuMilliCores: manifest.limits.cpuMilliCores,
      memoryMiB: manifest.limits.memoryMiB + manifest.limits.temporaryMiB,
      storageGiB: manifest.limits.dataGiB,
      pids: manifest.limits.pids,
    });
  }
  const databases = await tx
    .select()
    .from(schema.databaseAllocations)
    .where(eq(schema.databaseAllocations.environmentId, env.id));
  for (const allocation of databases) {
    if (allocation.state === "released" || allocation.id === existingId) continue;
    const [preparation] = await tx
      .select()
      .from(schema.databasePreparations)
      .where(eq(schema.databasePreparations.id, allocation.preparationId));
    if (!preparation)
      throw new DomainError("JOURNAL_INCONSISTENT", "Database reservation missing", 500);
    requirements.push(databaseCapacity(preparation.profile));
  }
  requirements.push(...(await deliveryCommitments(tx, existingId, environmentId)));
  const sum = (key: "cpuMilliCores" | "memoryMiB" | "storageGiB") =>
    requirements.reduce((total, item) => total + item[key], 0);
  if (
    sum("cpuMilliCores") > env.cpuMilliCores ||
    sum("memoryMiB") > env.memoryMiB ||
    sum("storageGiB") > env.diskGiB
  )
    throw new DomainError(
      "CAPACITY_EXCEEDED",
      "Application and database commitments exceed environment limits",
      409,
    );
}
