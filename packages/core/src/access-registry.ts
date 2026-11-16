import { randomUUID } from "node:crypto";
import {
  CreateAccessSlot,
  type CreateAccessSlotInput,
  CreateServiceIdentity,
  type CreateServiceIdentityInput,
} from "@godseye/contracts";
import { schema } from "@godseye/store";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import {
  type AccessState,
  checkRevision,
  currentIdentity,
  derivedProof,
  fresh,
  identityFor,
  identityView,
  proofDigest,
  readyProvider,
  receipt,
  record,
  slotView,
} from "./access-state.js";
import { DomainError, parseInput } from "./errors.js";
import { currentEpoch, environmentFor } from "./foundation-data.js";
import { write } from "./journal.js";
import { type Actor, assertOwner } from "./policy.js";

export async function overview(state: AccessState, actor: Actor) {
  assertOwner(actor);
  let provider:
    | { state: "unconfigured" | "unavailable" }
    | Awaited<ReturnType<NonNullable<AccessState["provider"]>["health"]>>;
  try {
    provider = state.provider ? await state.provider.health() : { state: "unconfigured" };
  } catch {
    provider = { state: "unavailable" };
  }
  const rows = await state.store.db.select().from(schema.serviceIdentities);
  const slots = await state.store.db.select().from(schema.accessSlots);
  const operations = await state.store.db.select().from(schema.accessOperations);
  const { operationView } = await import("./access-state.js");
  return {
    provider,
    identities: await Promise.all(rows.map((row) => identityView(state.store.db, row))),
    slots: slots.map(slotView),
    operations: operations.map(operationView),
    adapters: [...state.adapters.values()]
      .filter((item) => item.qualified)
      .map(({ id }) => ({ id })),
  };
}
export async function createIdentity(
  state: AccessState,
  actor: Actor,
  input: CreateServiceIdentityInput,
  key: string,
) {
  fresh(state, actor);
  const data = parseInput(CreateServiceIdentity, input);
  if ((data.purpose === "runtime") === Boolean(data.workerId))
    throw new DomainError("INVALID_INPUT", "Only task identities require a worker binding", 422);
  const expiresAt = data.expiresAt ? new Date(data.expiresAt) : null;
  if (expiresAt && expiresAt.getTime() <= state.now().getTime())
    throw new DomainError("INVALID_INPUT", "Identity expiry must be in the future", 422);
  return write(state.store, async (tx) => {
    const request = await receipt(tx, actor, key, "access.identity.create", data);
    if (request.previous)
      return identityView(tx, await identityFor(tx, request.previous.resourceId));
    await environmentFor(tx, actor, data.projectId, data.environmentId);
    const row = {
      ...data,
      id: randomUUID(),
      workerId: data.workerId ?? null,
      expiresAt,
      epoch: await currentEpoch(tx, data.environmentId),
      revision: 1,
      status: "active",
      proofIssued: false,
      createdAt: state.now(),
    };
    await tx.insert(schema.serviceIdentities).values(row);
    await record(
      tx,
      state,
      actor,
      key,
      request.digest,
      row.id,
      "access.identity.create",
      row.projectId,
    );
    return identityView(tx, await identityFor(tx, row.id));
  });
}
export async function createSlot(
  state: AccessState,
  actor: Actor,
  input: CreateAccessSlotInput,
  key: string,
) {
  fresh(state, actor);
  const data = parseInput(CreateAccessSlot, input);
  return write(state.store, async (tx) => {
    const request = await receipt(tx, actor, key, "access.slot.create", data);
    if (request.previous) {
      const [existing] = await tx
        .select()
        .from(schema.accessSlots)
        .where(eq(schema.accessSlots.id, request.previous.resourceId));
      return slotView(z.custom<typeof schema.accessSlots.$inferSelect>().parse(existing));
    }
    const identity = await identityFor(tx, data.identityId);
    await currentIdentity(state, tx, identity);
    const [duplicate] = await tx
      .select()
      .from(schema.accessSlots)
      .where(
        and(
          eq(schema.accessSlots.identityId, data.identityId),
          eq(schema.accessSlots.name, data.name),
        ),
      );
    if (duplicate)
      throw new DomainError("CONFLICT", "This identity already has a slot with that name", 409);
    const row = {
      ...data,
      id: randomUUID(),
      revision: 1,
      activeVersion: null,
      stagedVersion: null,
      state: "empty",
    };
    await tx.insert(schema.accessSlots).values(row);
    await record(
      tx,
      state,
      actor,
      key,
      request.digest,
      row.id,
      "access.slot.create",
      identity.projectId,
    );
    return slotView(row);
  });
}
export async function revokeIdentity(
  state: AccessState,
  actor: Actor,
  id: string,
  expectedRevision: number,
  key: string,
) {
  fresh(state, actor);
  return write(state.store, async (tx) => {
    const request = await receipt(tx, actor, key, "access.identity.revoke", {
      id,
      expectedRevision,
    });
    if (request.previous) return identityView(tx, await identityFor(tx, id));
    const identity = await identityFor(tx, id);
    checkRevision(identity.revision, expectedRevision);
    await tx
      .update(schema.serviceIdentities)
      .set({
        status: "revoked",
        proofDigest: null,
        proofIssued: false,
        revision: identity.revision + 1,
      })
      .where(eq(schema.serviceIdentities.id, id));
    await record(
      tx,
      state,
      actor,
      key,
      request.digest,
      id,
      "access.identity.revoke",
      identity.projectId,
    );
    return identityView(tx, await identityFor(tx, id));
  });
}
/** Private callback only: deterministic derivation makes lost handoff replay safe without storing the proof. */
export async function issueProof(
  state: AccessState,
  actor: Actor,
  id: string,
  expectedRevision: number,
  key: string,
  deliver: (proof: string) => Promise<void> | void,
) {
  fresh(state, actor);
  await readyProvider(state);
  const result = await write(state.store, async (tx) => {
    const request = await receipt(tx, actor, key, "access.proof.issue", { id, expectedRevision });
    const identity = await identityFor(tx, id);
    if (
      identity.status !== "active" ||
      (identity.expiresAt && identity.expiresAt.getTime() <= state.now().getTime()) ||
      identity.epoch !== (await currentEpoch(tx, identity.environmentId))
    )
      throw new DomainError("FORBIDDEN", "Identity is inactive", 403);
    if (request.previous) {
      const revision = Number(request.previous.kind.split(".").at(-1));
      const proof = derivedProof(state, id, revision);
      if (proofDigest(proof) !== identity.proofDigest)
        throw new DomainError("FORBIDDEN", "Issued access was replaced or revoked", 403);
      return { proof, view: await identityView(tx, identity) };
    }
    checkRevision(identity.revision, expectedRevision);
    const revision = identity.revision + 1;
    const proof = derivedProof(state, id, revision);
    await tx
      .update(schema.serviceIdentities)
      .set({ proofDigest: proofDigest(proof), proofIssued: true, revision })
      .where(eq(schema.serviceIdentities.id, id));
    await record(
      tx,
      state,
      actor,
      key,
      request.digest,
      id,
      `access.proof.issue.${revision}`,
      identity.projectId,
    );
    return { proof, view: await identityView(tx, await identityFor(tx, id)) };
  });
  try {
    await deliver(result.proof);
  } catch {
    throw new DomainError(
      "PRIVATE_HANDOFF_FAILED",
      "Private proof handoff failed; replay the same command",
      503,
    );
  }
  return result.view;
}
