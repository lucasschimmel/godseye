import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { AccessOperationView, AccessSlotView, ServiceIdentityView } from "@godseye/contracts";
import { type DatabaseAccess, type Store, schema } from "@godseye/store";
import { eq } from "drizzle-orm";
import { z } from "zod";
import type {
  AccessProvider,
  AccessScope,
  AccessVersion,
  StaticTransitionAdapter,
} from "./access-provider.js";
import { DomainError } from "./errors.js";
import { assertFresh, currentEpoch, foundationState, requestFor } from "./foundation-data.js";
import type { FoundationEngine } from "./foundations.js";
import { appendAudit } from "./journal.js";
import type { Actor } from "./policy.js";

export interface AccessBrokerOptions {
  foundation: FoundationEngine;
  provider?: AccessProvider;
  fingerprintKey: string;
  now?: () => Date;
  transitions?: StaticTransitionAdapter[];
}
export function accessState(store: Store, options: AccessBrokerOptions) {
  if (options.fingerprintKey.length < 32)
    throw new Error("A private high-entropy broker key is required");
  const now = options.now ?? (() => new Date());
  const adapters = new Map<string, StaticTransitionAdapter>();
  for (const item of options.transitions ?? []) {
    if (adapters.has(item.id)) throw new Error("Duplicate static transition adapter");
    adapters.set(item.id, item);
  }
  return { store, ...options, now, adapters, foundationState: foundationState(store, { now }) };
}
export type AccessState = ReturnType<typeof accessState>;
export const fresh = (state: AccessState, actor: Actor) =>
  assertFresh(actor, state.foundationState);
export function materialDigest(state: AccessState, value: string) {
  return createHmac("sha256", state.fingerprintKey)
    .update("godseye/access/material/v1\0")
    .update(value)
    .digest("hex");
}
export function derivedProof(state: AccessState, id: string, revision: number) {
  return createHmac("sha256", state.fingerprintKey)
    .update(`godseye/access/proof/v1\0${id}\0${revision}`)
    .digest("base64url");
}
export const proofDigest = (proof: string) => createHash("sha256").update(proof).digest("hex");
export async function identityFor(tx: DatabaseAccess, id: string) {
  const [identity] = await tx
    .select()
    .from(schema.serviceIdentities)
    .where(eq(schema.serviceIdentities.id, id));
  if (!identity) throw new DomainError("NOT_FOUND", "Service identity not found", 404);
  return identity;
}
export async function slotFor(tx: DatabaseAccess, id: string) {
  const [slot] = await tx.select().from(schema.accessSlots).where(eq(schema.accessSlots.id, id));
  if (!slot) throw new DomainError("NOT_FOUND", "Material slot not found", 404);
  return { slot, identity: await identityFor(tx, slot.identityId) };
}
export async function operationFor(tx: DatabaseAccess, id: string) {
  const [operation] = await tx
    .select()
    .from(schema.accessOperations)
    .where(eq(schema.accessOperations.id, id));
  if (!operation) throw new DomainError("NOT_FOUND", "Access operation not found", 404);
  return operation;
}
export const scopeFor = (
  identity: Awaited<ReturnType<typeof identityFor>>,
  slotId: string,
): AccessScope => ({
  id: identity.id,
  projectId: identity.projectId,
  environmentId: identity.environmentId,
  purpose: ServiceIdentityView.shape.purpose.parse(identity.purpose),
  slotId,
});
export function slotView(slot: typeof schema.accessSlots.$inferSelect) {
  return AccessSlotView.parse(slot);
}
export function operationView(row: typeof schema.accessOperations.$inferSelect) {
  return AccessOperationView.parse({
    id: row.id,
    slotId: row.slotId,
    kind: row.kind,
    state: row.state,
    candidateVersion: row.candidateVersion,
    previousVersion: row.previousVersion,
    adapterId: row.adapterId,
    createdAt: row.createdAt.toISOString(),
  });
}
export async function identityView(
  tx: DatabaseAccess,
  row: typeof schema.serviceIdentities.$inferSelect,
) {
  const slots = await tx
    .select()
    .from(schema.accessSlots)
    .where(eq(schema.accessSlots.identityId, row.id));
  return ServiceIdentityView.parse({
    id: row.id,
    projectId: row.projectId,
    environmentId: row.environmentId,
    purpose: row.purpose,
    name: row.name,
    workerId: row.workerId,
    epoch: row.epoch,
    revision: row.revision,
    status: row.status,
    proofIssued: row.proofIssued,
    expiresAt: row.expiresAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    upstreamRevocation:
      row.status === "revoked" && slots.some((slot) => slot.activeVersion)
        ? "pending"
        : "not_required",
  });
}
export function checkRevision(current: number, expected: number) {
  if (!Number.isInteger(expected) || current !== expected)
    throw new DomainError("REVISION_CONFLICT", "The access resource revision changed", 409);
}
export async function currentIdentity(
  state: AccessState,
  tx: DatabaseAccess,
  row: Awaited<ReturnType<typeof identityFor>>,
) {
  if (
    row.status !== "active" ||
    (row.expiresAt && row.expiresAt.getTime() <= state.now().getTime()) ||
    row.epoch !== (await currentEpoch(tx, row.environmentId))
  )
    throw new DomainError("FORBIDDEN", "Identity is inactive, expired or fenced", 403);
}
export async function verifiedVersion(
  state: AccessState,
  slotId: string,
  material: AccessVersion | null,
) {
  if (!material)
    throw new DomainError("PROVIDER_UNAVAILABLE", "Recorded material is unavailable", 503);
  const operation = await operationFor(state.store.db, material.operationId);
  if (
    operation.kind !== "stage" ||
    operation.state !== "succeeded" ||
    operation.slotId !== slotId ||
    operation.candidateVersion !== material.version ||
    operation.materialFingerprint !== material.fingerprint ||
    materialDigest(state, material.value) !== operation.materialFingerprint
  )
    throw new DomainError(
      "PROVIDER_INVALID",
      "Provider material does not match the recorded intention",
      503,
    );
  return material;
}
export async function liveIdentity(state: AccessState, tx: DatabaseAccess, proof: string) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(proof))
    throw new DomainError("UNAUTHENTICATED", "Service authentication failed", 401);
  const digest = proofDigest(proof);
  const [row] = await tx
    .select()
    .from(schema.serviceIdentities)
    .where(eq(schema.serviceIdentities.proofDigest, digest));
  if (
    row?.proofDigest?.length !== 64 ||
    !timingSafeEqual(Buffer.from(row.proofDigest), Buffer.from(digest)) ||
    row.status !== "active" ||
    (row.expiresAt && row.expiresAt.getTime() <= state.now().getTime()) ||
    row.epoch !== (await currentEpoch(tx, row.environmentId))
  )
    throw new DomainError("UNAUTHENTICATED", "Service authentication failed", 401);
  const [environment] = await tx
    .select()
    .from(schema.environments)
    .where(eq(schema.environments.id, row.environmentId));
  if (!environment || environment.recoveryHold)
    throw new DomainError("RECOVERY_HOLD", "Recovery environment material remains held", 409);
  return row;
}
/** Revalidate adapter data and discard exception text at the private broker boundary. */
export async function safeProviderRead(
  provider: AccessProvider,
  scope: AccessScope,
  version?: number,
): Promise<AccessVersion | null> {
  try {
    const result = await provider.read(scope, version);
    if (result === null) return null;
    return z
      .object({
        value: z.string().min(1).max(16384),
        operationId: z.string().uuid(),
        fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
        version: z.number().int().positive(),
      })
      .strict()
      .parse(result);
  } catch {
    throw new DomainError("PROVIDER_UNAVAILABLE", "OpenBao material read failed", 503);
  }
}
export async function receipt(
  tx: DatabaseAccess,
  actor: Actor,
  key: string,
  kind: string,
  input: unknown,
) {
  const result = await requestFor(tx, actor, key, kind, input);
  return { digest: result.digest, previous: result.existing };
}
export async function record(
  tx: DatabaseAccess,
  state: AccessState,
  actor: Actor,
  key: string,
  digest: string,
  id: string,
  kind: string,
  projectId: string,
) {
  await tx.insert(schema.foundationRequests).values({
    key,
    fingerprint: digest,
    resourceId: id,
    kind,
    createdAt: state.now(),
    terminalAt: state.now(),
  });
  await appendAudit(tx, actor, projectId, kind, `Access resource ${id}`);
}
export function providerFor(state: AccessState) {
  if (!state.provider)
    throw new DomainError("CAPABILITY_UNAVAILABLE", "OpenBao is not configured", 503);
  return state.provider;
}
export async function readyProvider(state: AccessState) {
  const provider = providerFor(state);
  try {
    if ((await provider.health()).state === "ready") return provider;
  } catch {
    /* The private provider error never crosses this boundary. */
  }
  throw new DomainError("CAPABILITY_UNAVAILABLE", "OpenBao is not ready for new access", 503);
}
