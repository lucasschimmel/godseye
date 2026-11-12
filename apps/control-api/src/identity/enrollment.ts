import { randomBytes, randomUUID } from "node:crypto";
import { appendAudit, DomainError, write } from "@godseye/core";
import { schema } from "@godseye/store";
import { eq, like } from "drizzle-orm";
import { type IdentityState, OWNER_DEFAULTS, ticketIdentifier } from "./shared.js";

export async function reserveOwner(store: IdentityState["store"]) {
  return write(store, async (tx) => {
    const [existing] = await tx.select().from(schema.ownerIdentity);
    if (existing) return existing.userId;
    const id = randomUUID();
    const now = new Date();
    await tx.insert(schema.ownerUser).values({
      id,
      name: "Propriétaire",
      email: "owner@localhost.invalid",
      emailVerified: false,
      createdAt: now,
      updatedAt: now,
    });
    await tx.insert(schema.ownerIdentity).values({ singleton: 1, userId: id });
    return id;
  });
}

/** Trusted local-admin use only; no unauthenticated HTTP route may invoke this directly. */
export async function prepareEnrollment(state: IdentityState, intent: "setup" | "recover") {
  return write(state.store, async (tx) => {
    const [key] = await tx
      .select()
      .from(schema.ownerPasskey)
      .where(eq(schema.ownerPasskey.userId, state.ownerId))
      .limit(1);
    if (intent === "setup" && key)
      throw new DomainError("OWNER_CONFIGURED", "Owner enrollment is already complete", 409);
    if (intent === "recover") {
      await tx.delete(schema.ownerSession).where(eq(schema.ownerSession.userId, state.ownerId));
      await tx.delete(schema.ownerPasskey).where(eq(schema.ownerPasskey.userId, state.ownerId));
      // Outstanding challenges from the old authority cannot complete after recovery.
      await tx.delete(schema.ownerVerification);
    } else
      await tx
        .delete(schema.ownerVerification)
        .where(like(schema.ownerVerification.identifier, "owner-enrollment:%"));
    const ticket = randomBytes(32).toString("base64url");
    const now = state.now();
    const expiresAt = new Date(now.getTime() + OWNER_DEFAULTS.enrollmentMs);
    await tx.insert(schema.ownerVerification).values({
      id: randomUUID(),
      identifier: ticketIdentifier(ticket),
      value: state.ownerId,
      expiresAt,
      createdAt: now,
      updatedAt: now,
    });
    await appendAudit(
      tx,
      { id: "local-owner-recovery", kind: "owner", projectIds: [] },
      null,
      `owner.${intent}.prepared`,
      "One-time owner enrollment prepared through the local administration authority",
    );
    return { ticket, expiresAt: expiresAt.toISOString() };
  });
}

export async function flushIdentityEvents(state: IdentityState) {
  await write(state.store, async (tx) => {
    const events = await tx
      .select()
      .from(schema.ownerEvents)
      .orderBy(schema.ownerEvents.occurredAt)
      .limit(1000);
    for (const event of events) {
      await appendAudit(
        tx,
        { id: event.ownerId, kind: "owner", projectIds: [] },
        null,
        event.action,
        `Authentication object ${event.entityId}; recorded at ${event.occurredAt.toISOString()}`,
      );
      await tx.delete(schema.ownerEvents).where(eq(schema.ownerEvents.id, event.id));
    }
  });
}
