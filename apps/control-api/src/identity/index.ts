import { write } from "@godseye/core";
import { type Store, schema } from "@godseye/store";
import { eq } from "drizzle-orm";
import { parsePublicOrigin } from "../server-config.js";
import { buildOwnerAuth } from "./auth-config.js";
import { flushIdentityEvents, prepareEnrollment, reserveOwner } from "./enrollment.js";
import { consumeLocalProof } from "./local-admin.js";
import { ownerActor, ownerSession, revokeIdentityObject, securityOverview } from "./security.js";
import {
  type IdentityOptions,
  type IdentityState,
  OWNER_DEFAULTS,
  type OwnerStatus,
  serialLane,
} from "./shared.js";

const methods = new Map([
  ["/passkey/generate-register-options", "GET"],
  ["/passkey/verify-registration", "POST"],
  ["/passkey/generate-authenticate-options", "GET"],
  ["/passkey/verify-authentication", "POST"],
  ["/sign-out", "POST"],
]);
function withoutSessionValues(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutSessionValues);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => key !== "token")
        .map(([key, item]) => [key, withoutSessionValues(item)]),
    );
  return value;
}

export async function createOwnerIdentity(store: Store, options: IdentityOptions) {
  const origin = new URL(options.origin);
  const local = origin.protocol === "http:" && origin.hostname === "localhost";
  // Exactly one owner origin: plain-http localhost (local mode) or a bare https DNS origin (server).
  if (
    (!local && parsePublicOrigin(options.origin) !== options.origin) ||
    origin.origin !== options.origin ||
    options.signingKey.length < 32
  )
    throw new Error(
      "Owner identity requires a localhost or https owner origin and a private signing key",
    );
  const state: IdentityState = {
    store,
    ownerId: await reserveOwner(store),
    options,
    now: options.now ?? (() => new Date()),
  };
  const auth = buildOwnerAuth(state);
  const exclusive = serialLane();
  await flushIdentityEvents(state);
  return {
    auth,
    ownerId: state.ownerId,
    exclusive,
    actor: (headers: Headers) => ownerActor(auth, state, headers),
    async status(headers: Headers): Promise<OwnerStatus> {
      const [passkey] = await store.db
        .select()
        .from(schema.ownerPasskey)
        .where(eq(schema.ownerPasskey.userId, state.ownerId))
        .limit(1);
      const session = await ownerSession(auth, state, headers);
      return {
        authenticated: !!session,
        configured: !!passkey,
        origin: options.origin,
        ...(session
          ? {
              owner: { id: state.ownerId, name: session.user.name },
              session: {
                id: session.session.id,
                createdAt: session.session.createdAt.toISOString(),
                expiresAt: session.session.expiresAt.toISOString(),
              },
            }
          : {}),
      };
    },
    security: (headers: Headers) => securityOverview(auth, state, headers),
    revokeSession: (headers: Headers, id: string, key: string) =>
      revokeIdentityObject(auth, state, headers, "session", id, key),
    revokePasskey: (headers: Headers, id: string, key: string) =>
      revokeIdentityObject(auth, state, headers, "passkey", id, key),
    prepareEnrollment: (intent: "setup" | "recover") =>
      exclusive(async () => {
        const result = await prepareEnrollment(state, intent);
        await flushIdentityEvents(state);
        return result;
      }),
    async localCommand(body: string, headers: Headers, intent: "setup" | "recover") {
      return exclusive(async () => {
        await consumeLocalProof(store, options.signingKey, body, headers, state.now());
        const result = await prepareEnrollment(state, intent);
        await flushIdentityEvents(state);
        return result;
      });
    },
    flushAudit: () => flushIdentityEvents(state),
    async handle(request: Request): Promise<Response> {
      const url = new URL(request.url);
      const path = url.pathname.startsWith(OWNER_DEFAULTS.authPath)
        ? url.pathname.slice(OWNER_DEFAULTS.authPath.length)
        : "";
      if (methods.get(path) !== request.method)
        return Response.json(
          { error: { code: "NOT_FOUND", message: "Authentication route not found" } },
          { status: 404 },
        );
      const suppliedOrigin = request.headers.get("origin");
      if (suppliedOrigin && suppliedOrigin !== options.origin)
        return Response.json({ error: { code: "INVALID_ORIGIN" } }, { status: 403 });
      return exclusive(async () => {
        const allowed = await write(store, async (tx) => {
          const bucket = `ceremony:${Math.floor(state.now().getTime() / OWNER_DEFAULTS.rateWindowMs)}`;
          const [row] = await tx
            .select()
            .from(schema.ownerThrottle)
            .where(eq(schema.ownerThrottle.bucket, bucket));
          await tx
            .insert(schema.ownerThrottle)
            .values({ bucket, attempts: (row?.attempts ?? 0) + 1 })
            .onConflictDoUpdate({
              target: schema.ownerThrottle.bucket,
              set: { attempts: (row?.attempts ?? 0) + 1 },
            });
          return (row?.attempts ?? 0) < OWNER_DEFAULTS.attempts;
        });
        if (!allowed) return Response.json({ error: { code: "RATE_LIMITED" } }, { status: 429 });
        const response = await auth.handler(request);
        await flushIdentityEvents(state);
        const headers = new Headers(response.headers);
        headers.set("cache-control", "no-store");
        headers.set("referrer-policy", "no-referrer");
        if (!response.ok)
          return Response.json(
            {
              error: {
                code: "AUTHENTICATION_REJECTED",
                message: "Authentication request was rejected",
              },
            },
            { status: response.status, headers },
          );
        const body: unknown = await response.json();
        return Response.json(withoutSessionValues(body), { status: response.status, headers });
      });
    },
  };
}
export type OwnerIdentity = Awaited<ReturnType<typeof createOwnerIdentity>>;
