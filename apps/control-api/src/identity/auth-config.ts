import { createHmac } from "node:crypto";
import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { passkey } from "@better-auth/passkey";
import { schema } from "@godseye/store";
import { betterAuth } from "better-auth";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { type IdentityState, OWNER_DEFAULTS, requireFresh, ticketIdentifier } from "./shared.js";

/**
 * Everything browser-facing derives from the single owner origin: the WebAuthn relying party and the
 * cookie names/attributes. An https origin uses a __Host- cookie (Secure, Path=/, no Domain); Better
 * Auth only prepends __Secure-, so its own prefix is disabled and Secure is set explicitly.
 */
export function ownerOriginSettings(origin: string) {
  const url = new URL(origin);
  const secure = url.protocol === "https:";
  return {
    rpID: url.hostname,
    secure,
    cookiePrefix: secure ? "__Host-godseye-owner" : "godseye-owner",
    cookieAttributes: { httpOnly: true, sameSite: "strict", path: "/", secure } as const,
  };
}

/** Built once per store. The pre-created fixed identity is the only authentication principal. */
export function buildOwnerAuth(state: IdentityState) {
  const settings = ownerOriginSettings(state.options.origin);
  const fixedOwner = { id: state.ownerId, kind: "owner" as const, projectIds: [] };
  return betterAuth({
    baseURL: state.options.origin,
    basePath: OWNER_DEFAULTS.authPath,
    secret: createHmac("sha256", state.options.signingKey)
      .update("godseye-owner-auth-v1")
      .digest("hex"),
    trustedOrigins: [state.options.origin],
    database: drizzleAdapter(state.store.fullDb, {
      provider: "pg",
      schema: schema.ownerAuthSchema,
      transaction: true,
    }),
    emailAndPassword: { enabled: false },
    user: { deleteUser: { enabled: false }, changeEmail: { enabled: false } },
    session: {
      expiresIn: OWNER_DEFAULTS.sessionSeconds,
      disableSessionRefresh: true,
      freshAge: OWNER_DEFAULTS.freshMs / 1000,
      cookieCache: { enabled: false },
    },
    advanced: {
      cookiePrefix: settings.cookiePrefix,
      useSecureCookies: false,
      defaultCookieAttributes: settings.cookieAttributes,
      ipAddress: { disableIpTracking: true },
    },
    verification: { storeIdentifier: "plain" },
    logger: { disabled: true },
    rateLimit: { enabled: false }, // The wrapper enforces a durable local rate limit before reaching any ceremony.
    databaseHooks: {
      user: { create: { before: async () => false } },
      session: {
        create: {
          before: async (session) => {
            if (session.userId !== state.ownerId)
              throw new APIError("FORBIDDEN", { message: "Owner identity is required" });
            return { data: session };
          },
        },
      },
    },
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        if (!ctx.path.startsWith("/passkey/") || !ctx.path.includes("register")) return;
        const signed = await ctx.getSignedCookie(
          ctx.context.authCookies.sessionToken.name,
          ctx.context.secret,
        );
        const session = signed ? await ctx.context.internalAdapter.findSession(signed) : null;
        if (session) {
          if (session.user.id !== state.ownerId || session.session.expiresAt <= state.now())
            throw new APIError("UNAUTHORIZED");
          requireFresh(
            {
              ...fixedOwner,
              sessionId: session.session.id,
              authenticatedAt: session.session.createdAt.toISOString(),
            },
            state.now(),
          );
        }
        if (ctx.path === "/passkey/verify-registration" && ctx.body?.createSession !== true) {
          throw new APIError("BAD_REQUEST", {
            message: "Atomic session creation is required for enrollment",
          });
        }
      }),
    },
    plugins: [
      passkey({
        rpID: settings.rpID,
        rpName: "G.O.D.S.E.Y.E",
        origin: state.options.origin,
        authenticatorSelection: { residentKey: "required", userVerification: "required" },
        registration: {
          requireSession: false,
          resolveUser: async ({ ctx, context }) => {
            if (!context || !/^[A-Za-z0-9_-]{43}$/.test(context))
              throw new APIError("UNAUTHORIZED", { message: "Enrollment authority is required" });
            const ticket = await ctx.context.internalAdapter.findVerificationValue(
              ticketIdentifier(context),
            );
            if (!ticket || ticket.value !== state.ownerId || ticket.expiresAt <= state.now())
              throw new APIError("UNAUTHORIZED", {
                message: "Enrollment authority is invalid or expired",
              });
            return { id: state.ownerId, name: "Propriétaire" };
          },
          afterVerification: async ({ ctx, context, user }) => {
            if (user.id !== state.ownerId) throw new APIError("FORBIDDEN");
            if (context) {
              // This consumption joins Better Auth's registration transaction; failure rolls back the passkey and session too.
              const ticket = await ctx.context.internalAdapter.consumeVerificationValue(
                ticketIdentifier(context),
              );
              if (!ticket || ticket.value !== state.ownerId || ticket.expiresAt <= state.now())
                throw new APIError("UNAUTHORIZED", {
                  message: "Enrollment authority is invalid or expired",
                });
            } else {
              const signed = await ctx.getSignedCookie(
                ctx.context.authCookies.sessionToken.name,
                ctx.context.secret,
              );
              const session = signed ? await ctx.context.internalAdapter.findSession(signed) : null;
              requireFresh(
                session?.user.id === state.ownerId
                  ? {
                      ...fixedOwner,
                      sessionId: session.session.id,
                      authenticatedAt: session.session.createdAt.toISOString(),
                    }
                  : null,
                state.now(),
              );
            }
            return { userId: state.ownerId };
          },
        },
      }),
    ],
  });
}
export type OwnerAuth = ReturnType<typeof buildOwnerAuth>;
