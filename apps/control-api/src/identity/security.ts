import { DomainError, fingerprint, write } from "@godseye/core";
import { schema } from "@godseye/store";
import { and, eq, gt } from "drizzle-orm";
import type { OwnerAuth } from "./auth-config.js";
import { type IdentityState, requireFresh } from "./shared.js";

export async function ownerSession(auth: OwnerAuth, state: IdentityState, headers: Headers) {
  const session = await auth.api.getSession({ headers });
  if (!session || session.user.id !== state.ownerId || session.session.expiresAt <= state.now())
    return null;
  return session;
}
export async function ownerActor(auth: OwnerAuth, state: IdentityState, headers: Headers) {
  const session = await ownerSession(auth, state, headers);
  return session
    ? {
        id: state.ownerId,
        kind: "owner" as const,
        projectIds: [],
        sessionId: session.session.id,
        authenticatedAt: session.session.createdAt.toISOString(),
      }
    : null;
}

export async function securityOverview(auth: OwnerAuth, state: IdentityState, headers: Headers) {
  const current = await ownerSession(auth, state, headers);
  if (!current) throw new DomainError("UNAUTHENTICATED", "Owner authentication is required", 401);
  const sessions = await state.store.db
    .select()
    .from(schema.ownerSession)
    .where(
      and(
        eq(schema.ownerSession.userId, state.ownerId),
        gt(schema.ownerSession.expiresAt, state.now()),
      ),
    );
  const passkeys = await state.store.db
    .select()
    .from(schema.ownerPasskey)
    .where(eq(schema.ownerPasskey.userId, state.ownerId));
  const age = state.now().getTime() - current.session.createdAt.getTime();
  return {
    fresh: age >= 0 && age <= 5 * 60_000,
    sessions: sessions.map(({ id, createdAt, expiresAt }) => ({
      id,
      createdAt: createdAt.toISOString(),
      expiresAt: expiresAt.toISOString(),
      current: id === current.session.id,
    })),
    passkeys: passkeys.map(({ id, name, createdAt }) => ({
      id,
      name: name ?? "Clé d’accès",
      createdAt: createdAt?.toISOString() ?? null,
    })),
  };
}

export async function revokeIdentityObject(
  auth: OwnerAuth,
  state: IdentityState,
  headers: Headers,
  kind: "session" | "passkey",
  id: string,
  key: string,
) {
  requireFresh(await ownerActor(auth, state, headers), state.now());
  if (!/^[A-Za-z0-9._:-]{8,128}$/.test(key))
    throw new DomainError("INVALID_IDEMPOTENCY_KEY", "A valid idempotency key is required", 400);
  const digest = fingerprint({ owner: state.ownerId, action: `revoke.${kind}`, id });
  return write(state.store, async (tx) => {
    const [existing] = await tx
      .select()
      .from(schema.ownerReceipts)
      .where(eq(schema.ownerReceipts.id, key));
    if (existing) {
      if (existing.fingerprint !== digest)
        throw new DomainError(
          "IDEMPOTENCY_CONFLICT",
          "Request key was used for different parameters",
          409,
        );
      return { revoked: true };
    }
    if (kind === "session") {
      await tx
        .delete(schema.ownerSession)
        .where(and(eq(schema.ownerSession.id, id), eq(schema.ownerSession.userId, state.ownerId)));
    } else {
      const rows = await tx
        .select()
        .from(schema.ownerPasskey)
        .where(eq(schema.ownerPasskey.userId, state.ownerId));
      if (rows.some((row) => row.id === id) && rows.length <= 1)
        throw new DomainError(
          "LAST_PASSKEY",
          "The final passkey can only be replaced through local recovery",
          409,
        );
      await tx
        .delete(schema.ownerPasskey)
        .where(and(eq(schema.ownerPasskey.id, id), eq(schema.ownerPasskey.userId, state.ownerId)));
    }
    await tx
      .insert(schema.ownerReceipts)
      .values({ id: key, fingerprint: digest, createdAt: state.now() });
    return { revoked: true };
  });
}
