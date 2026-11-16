import { randomUUID } from "node:crypto";
import { schema } from "@godseye/store";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import type { StaticTransitionContext, StaticTransitionResult } from "./access-provider.js";
import {
  type AccessState,
  checkRevision,
  currentIdentity,
  fresh,
  materialDigest,
  operationFor,
  operationView,
  readyProvider,
  receipt,
  record,
  safeProviderRead,
  scopeFor,
  slotFor,
  verifiedVersion,
} from "./access-state.js";
import { DomainError } from "./errors.js";
import { appendAudit, write } from "./journal.js";
import type { Actor } from "./policy.js";

const StageInput = z
  .object({ slotId: z.string().uuid(), expectedRevision: z.number().int().positive() })
  .strict();
async function noPending(tx: Parameters<Parameters<typeof write>[1]>[0], slotId: string) {
  const [pending] = await tx
    .select()
    .from(schema.accessOperations)
    .where(
      and(
        eq(schema.accessOperations.slotId, slotId),
        inArray(schema.accessOperations.state, ["pending", "unknown"]),
      ),
    );
  if (pending)
    throw new DomainError(
      "RECONCILIATION_REQUIRED",
      "An access effect requires reconciliation",
      409,
    );
}
function transitionContext(
  operation: typeof schema.accessOperations.$inferSelect,
  scope: ReturnType<typeof scopeFor>,
): StaticTransitionContext {
  return {
    operationId: operation.id,
    scope,
    candidateVersion: operation.candidateVersion,
    previousVersion: operation.previousVersion,
  };
}
async function settleStage(state: AccessState, id: string) {
  const operation = await operationFor(state.store.db, id);
  if (["succeeded", "failed"].includes(operation.state)) return operationView(operation);
  const { slot, identity } = await slotFor(state.store.db, operation.slotId);
  const stored = await safeProviderRead(
    await readyProvider(state),
    scopeFor(identity, slot.id),
    operation.candidateVersion,
  );
  if (
    !stored ||
    stored.operationId !== id ||
    stored.fingerprint !== operation.materialFingerprint ||
    materialDigest(state, stored.value) !== operation.materialFingerprint ||
    stored.version !== operation.candidateVersion
  )
    return operationView(operation);
  return write(state.store, async (tx) => {
    const current = await operationFor(tx, id);
    if (["succeeded", "failed"].includes(current.state)) return operationView(current);
    const { slot: latest } = await slotFor(tx, slot.id);
    await tx
      .update(schema.accessSlots)
      .set({
        stagedVersion: operation.candidateVersion,
        state: "staged",
        revision: latest.revision + 1,
      })
      .where(eq(schema.accessSlots.id, slot.id));
    await tx
      .update(schema.accessOperations)
      .set({ state: "succeeded" })
      .where(eq(schema.accessOperations.id, id));
    return operationView(await operationFor(tx, id));
  });
}
/** Persist the keyed intention and uncertainty before the single CAS mutation. Replay only reconciles. */
export async function stage(
  state: AccessState,
  actor: Actor,
  input: z.infer<typeof StageInput>,
  value: string,
  key: string,
) {
  fresh(state, actor);
  const data = StageInput.parse(input);
  if (typeof value !== "string" || !value.length || value.length > 16384)
    throw new DomainError("INVALID_INPUT", "Material must be a bounded nonempty string", 422);
  const provider = await readyProvider(state);
  const digest = materialDigest(state, value);
  const result = await write(state.store, async (tx) => {
    const request = await receipt(tx, actor, key, "access.stage", { ...data, digest });
    if (request.previous)
      return { operation: await operationFor(tx, request.previous.resourceId), created: false };
    const { slot, identity } = await slotFor(tx, data.slotId);
    await currentIdentity(state, tx, identity);
    checkRevision(slot.revision, data.expectedRevision);
    if (slot.stagedVersion)
      throw new DomainError(
        "CONFLICT",
        "An active identity and no staged candidate are required",
        409,
      );
    await noPending(tx, slot.id);
    const previousVersion = slot.activeVersion;
    const operation = {
      id: randomUUID(),
      slotId: slot.id,
      kind: "stage",
      state: "unknown",
      materialFingerprint: digest,
      previousVersion,
      candidateVersion: (previousVersion ?? 0) + 1,
      expectedProviderVersion: previousVersion ?? 0,
      adapterId: null,
      receipt: null,
      createdAt: state.now(),
    };
    await tx.insert(schema.accessOperations).values(operation);
    await tx
      .update(schema.accessSlots)
      .set({ state: "unknown" })
      .where(eq(schema.accessSlots.id, slot.id));
    await record(
      tx,
      state,
      actor,
      key,
      request.digest,
      operation.id,
      "access.stage",
      identity.projectId,
    );
    return { operation, created: true };
  });
  if (!result.created) return settleStage(state, result.operation.id);
  const { slot, identity } = await slotFor(state.store.db, data.slotId);
  try {
    const version = await provider.write(
      scopeFor(identity, slot.id),
      { value, operationId: result.operation.id, fingerprint: digest },
      result.operation.expectedProviderVersion,
    );
    if (version !== result.operation.candidateVersion)
      throw new Error("Uncertain provider version");
    return await settleStage(state, result.operation.id);
  } catch (error) {
    if (error instanceof DomainError && error.code === "PROVIDER_CONFLICT") {
      await write(state.store, async (tx) => {
        await tx
          .update(schema.accessOperations)
          .set({ state: "failed" })
          .where(eq(schema.accessOperations.id, result.operation.id));
        await tx
          .update(schema.accessSlots)
          .set({ state: slot.activeVersion ? "active" : "empty" })
          .where(eq(schema.accessSlots.id, slot.id));
      });
    }
    // Never retry a write whose receipt may have been lost, and never relay the provider error.
    return operationView(await operationFor(state.store.db, result.operation.id));
  }
}
async function settleTransition(state: AccessState, id: string, result: StaticTransitionResult) {
  return write(state.store, async (tx) => {
    const operation = await operationFor(tx, id);
    if (["succeeded", "failed"].includes(operation.state)) return operationView(operation);
    const { slot, identity } = await slotFor(tx, operation.slotId);
    await currentIdentity(state, tx, identity);
    if (
      result.status === "failed" &&
      result.operationId === id &&
      result.candidateVersion === operation.candidateVersion &&
      result.previousAccessPreserved === true &&
      result.phase === "readiness" &&
      result.evidence?.trim() &&
      result.evidence.length <= 512
    ) {
      await tx
        .update(schema.accessSlots)
        .set({ state: "staged", revision: slot.revision + 1 })
        .where(eq(schema.accessSlots.id, slot.id));
      await tx
        .update(schema.accessOperations)
        .set({ state: "failed", receipt: materialDigest(state, result.evidence) })
        .where(eq(schema.accessOperations.id, id));
      return operationView(await operationFor(tx, id));
    }
    if (
      result.status !== "succeeded" ||
      result.operationId !== id ||
      result.candidateVersion !== operation.candidateVersion ||
      result.transitioned !== true ||
      result.oldAccessRevoked !== true ||
      !result.evidence?.trim() ||
      result.evidence.length > 512 ||
      identity.status !== "active"
    )
      return operationView(operation);
    await tx
      .update(schema.accessSlots)
      .set({
        activeVersion: operation.candidateVersion,
        stagedVersion: null,
        state: "active",
        revision: slot.revision + 1,
      })
      .where(eq(schema.accessSlots.id, slot.id));
    // Evidence may be sensitive provider output: retain only a keyed integrity witness.
    await tx
      .update(schema.accessOperations)
      .set({ state: "succeeded", receipt: materialDigest(state, result.evidence) })
      .where(eq(schema.accessOperations.id, id));
    return operationView(await operationFor(tx, id));
  });
}
export async function activate(
  state: AccessState,
  actor: Actor,
  slotId: string,
  adapterId: string,
  expectedRevision: number,
  key: string,
) {
  fresh(state, actor);
  const adapter = state.adapters.get(adapterId);
  if (!adapter?.qualified)
    throw new DomainError(
      "CAPABILITY_UNAVAILABLE",
      "A qualified transition and upstream revocation adapter is required",
      503,
    );
  const provider = await readyProvider(state);
  const result = await write(state.store, async (tx) => {
    const request = await receipt(tx, actor, key, "access.activate", {
      slotId,
      adapterId,
      expectedRevision,
    });
    if (request.previous)
      return { operation: await operationFor(tx, request.previous.resourceId), created: false };
    const { slot, identity } = await slotFor(tx, slotId);
    await currentIdentity(state, tx, identity);
    checkRevision(slot.revision, expectedRevision);
    if (!slot.stagedVersion || slot.state !== "staged" || identity.status !== "active")
      throw new DomainError("CONFLICT", "A staged candidate and active identity are required", 409);
    await noPending(tx, slotId);
    const operation = {
      id: randomUUID(),
      slotId,
      kind: "activate",
      state: "unknown",
      materialFingerprint: null,
      previousVersion: slot.activeVersion,
      candidateVersion: slot.stagedVersion,
      expectedProviderVersion: slot.stagedVersion,
      adapterId,
      receipt: null,
      createdAt: state.now(),
    };
    await tx.insert(schema.accessOperations).values(operation);
    await tx
      .update(schema.accessSlots)
      .set({ state: "unknown" })
      .where(eq(schema.accessSlots.id, slotId));
    await record(
      tx,
      state,
      actor,
      key,
      request.digest,
      operation.id,
      "access.activate",
      identity.projectId,
    );
    return { operation, created: true };
  });
  const { slot, identity } = await slotFor(state.store.db, slotId);
  const context = transitionContext(result.operation, scopeFor(identity, slot.id));
  try {
    if (!result.created)
      return settleTransition(state, result.operation.id, await adapter.reconcile(context));
    const candidate = await verifiedVersion(
      state,
      slotId,
      await safeProviderRead(provider, context.scope, context.candidateVersion),
    );
    const previous = context.previousVersion
      ? await verifiedVersion(
          state,
          slotId,
          await safeProviderRead(provider, context.scope, context.previousVersion),
        )
      : null;
    if (!candidate || (context.previousVersion && !previous))
      return operationView(result.operation);
    // Dispatch authority linearizes here, after provider reads. Later revocation may leave an
    // already admitted external effect uncertain; revocation during those reads must block it.
    await write(state.store, async (tx) => {
      fresh(state, actor);
      const current = await operationFor(tx, result.operation.id);
      const latest = await slotFor(tx, slotId);
      await currentIdentity(state, tx, latest.identity);
      checkRevision(latest.slot.revision, slot.revision);
      if (
        latest.identity.id !== identity.id ||
        latest.identity.revision !== identity.revision ||
        latest.identity.epoch !== identity.epoch ||
        latest.slot.state !== "unknown" ||
        latest.slot.stagedVersion !== context.candidateVersion ||
        latest.slot.activeVersion !== context.previousVersion ||
        current.state !== "unknown" ||
        current.kind !== "activate" ||
        current.slotId !== slotId ||
        current.adapterId !== adapterId ||
        current.candidateVersion !== context.candidateVersion ||
        current.previousVersion !== context.previousVersion
      )
        throw new DomainError("FENCED", "Transition authority changed before dispatch", 409);
      await appendAudit(
        tx,
        actor,
        latest.identity.projectId,
        "access.transition.dispatch_admitted",
        `Access operation ${current.id}`,
      );
    });
    return settleTransition(
      state,
      result.operation.id,
      await adapter.transition(context, candidate.value, previous?.value ?? null),
    );
  } catch {
    return operationView(await operationFor(state.store.db, result.operation.id));
  }
}
export async function reconcile(state: AccessState, actor: Actor, id: string, key: string) {
  fresh(state, actor);
  const operation = await operationFor(state.store.db, id);
  const { identity } = await slotFor(state.store.db, operation.slotId);
  await write(state.store, async (tx) => {
    const request = await receipt(tx, actor, key, "access.reconcile", { id });
    if (!request.previous)
      await record(
        tx,
        state,
        actor,
        key,
        request.digest,
        id,
        "access.reconcile",
        identity.projectId,
      );
  });
  if (["succeeded", "failed"].includes(operation.state)) return operationView(operation);
  if (operation.kind === "stage") return settleStage(state, id);
  const adapter = operation.adapterId ? state.adapters.get(operation.adapterId) : null;
  if (!adapter?.qualified)
    throw new DomainError(
      "CAPABILITY_UNAVAILABLE",
      "Transition reconciliation adapter is unavailable",
      503,
    );
  try {
    return settleTransition(
      state,
      id,
      await adapter.reconcile(transitionContext(operation, scopeFor(identity, operation.slotId))),
    );
  } catch {
    return operationView(await operationFor(state.store.db, id));
  }
}
