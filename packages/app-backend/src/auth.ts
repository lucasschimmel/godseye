import { createHmac } from "node:crypto";
import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { betterAuth } from "better-auth";
import { genericOAuth } from "better-auth/plugins/generic-oauth";
import { APP_API_HEADER, APP_API_VERSION, APP_BASE, ApplicationError } from "./contracts.js";
import { authSchema } from "./schema.js";
import { type ApplicationState, guardApplication } from "./state.js";

export function applicationAuth(state: ApplicationState) {
  const prefix = createHmac("sha256", state.authMaterial)
    .update(JSON.stringify(state.scope))
    .digest("hex")
    .slice(0, 20);
  return betterAuth({
    baseURL: state.baseUrl,
    basePath: `${APP_BASE}/auth`,
    secret: createHmac("sha256", state.authMaterial)
      .update(`app-auth-v1:${JSON.stringify(state.scope)}`)
      .digest("hex"),
    trustedOrigins: [...state.origins],
    database: drizzleAdapter(state.store.db, {
      provider: "pg",
      schema: authSchema,
      transaction: true,
    }),
    emailAndPassword: {
      enabled: true,
      disableSignUp: !state.registrationEnabled,
      minPasswordLength: 12,
      maxPasswordLength: 128,
    },
    user: { deleteUser: { enabled: false }, changeEmail: { enabled: false } },
    account: { accountLinking: { enabled: false } },
    session: {
      expiresIn: state.limits.sessionSeconds,
      disableSessionRefresh: true,
      cookieCache: { enabled: false },
    },
    advanced: {
      cookiePrefix: `godseye-app-${prefix}`,
      useSecureCookies: state.baseUrl.startsWith("https:"),
      defaultCookieAttributes: { httpOnly: true, sameSite: "lax", path: APP_BASE },
      ipAddress: { disableIpTracking: true },
    },
    rateLimit: {
      enabled: true,
      window: Math.ceil(state.limits.authWindowMs / 1000),
      max: state.limits.authAttempts,
    },
    logger: { disabled: true },
    plugins: state.oauthProviders.length ? [genericOAuth({ config: state.oauthProviders })] : [],
    databaseHooks: {
      user: {
        create: {
          before: async () => {
            await guardApplication(state);
          },
        },
      },
      session: {
        create: {
          before: async () => {
            await guardApplication(state);
          },
        },
      },
    },
  });
}
export type ApplicationAuth = ReturnType<typeof applicationAuth>;
const authMethods = new Map([
  ["/sign-up/email", "POST"],
  ["/sign-in/email", "POST"],
  ["/get-session", "GET"],
  ["/sign-out", "POST"],
  ["/list-sessions", "GET"],
  ["/revoke-session", "POST"],
  ["/revoke-sessions", "POST"],
  ["/revoke-other-sessions", "POST"],
  ["/change-password", "POST"],
]);
export function assertApplicationAuthRoute(state: ApplicationState, path: string, method: string) {
  const callback = /^\/callback\/([a-z][a-z0-9-]{0,40})$/.exec(path);
  const oauth =
    (path === "/sign-in/social" && method === "POST" && state.oauthProviders.length > 0) ||
    (callback &&
      method === "GET" &&
      state.oauthProviders.some((item) => item.providerId === callback[1]));
  if (authMethods.get(path) !== method && !oauth)
    throw new ApplicationError("NOT_FOUND", "Application authentication route not found", 404);
}
export async function handleApplicationAuth(
  state: ApplicationState,
  auth: ApplicationAuth,
  request: Request,
) {
  const path = new URL(request.url).pathname.slice(`${APP_BASE}/auth`.length);
  assertApplicationAuthRoute(state, path, request.method);
  const epoch = await guardApplication(state);
  const response = await auth.handler(request);
  await guardApplication(state, epoch);
  const headers = new Headers(response.headers);
  headers.set(APP_API_HEADER, APP_API_VERSION);
  headers.set("cache-control", "no-store");
  if (response.status >= 400)
    return Response.json(
      {
        error: { code: "AUTHENTICATION_REJECTED", message: "Authentication request was rejected" },
      },
      { status: response.status, headers },
    );
  // Native bearer/session values are never exposed in JSON; only HttpOnly cookies carry authority.
  if (response.status < 300 && headers.get("content-type")?.includes("application/json")) {
    const sanitize = (value: unknown): unknown =>
      Array.isArray(value)
        ? value.map(sanitize)
        : value && typeof value === "object"
          ? Object.fromEntries(
              Object.entries(value)
                .filter(([key]) => key !== "token")
                .map(([key, item]) => [key, sanitize(item)]),
            )
          : value;
    return Response.json(sanitize(await response.json()), { status: response.status, headers });
  }
  return new Response(response.body, { status: response.status, headers });
}
export async function requireApplicationSession(
  state: ApplicationState,
  auth: ApplicationAuth,
  headers: Headers,
) {
  await guardApplication(state);
  const session = await auth.api.getSession({ headers });
  if (!session || session.session.expiresAt <= state.now())
    throw new ApplicationError("UNAUTHENTICATED", "Application session is required", 401);
  await guardApplication(state);
  return session;
}
