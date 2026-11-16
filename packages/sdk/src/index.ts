import { z } from "zod";
import { applicationEvents } from "./events.js";
import { applicationFiles } from "./files.js";
import { applicationTransport, type GodseyeClientOptions, jsonRequest } from "./transport.js";

export {
  APP_API_VERSION,
  type ApplicationEventView,
  type ApplicationFileView,
  type ApplicationScopeInput,
} from "@godseye/app-backend/contracts";
export {
  type EventSubscriptionOptions,
  type GodseyeEventMessage,
  parseApplicationEvents,
} from "./events.js";
export { type GodseyeClientOptions, GodseyeHttpError } from "./transport.js";

const User = z.object({
  id: z.string(),
  name: z.string(),
  email: z.email(),
  emailVerified: z.boolean(),
});
const Session = z
  .object({ user: User, session: z.object({ id: z.string(), expiresAt: z.iso.datetime() }) })
  .nullable();
/** Browser/server application client. It carries application cookies and no owner/control authority. */
export function createGodseyeClient(options: GodseyeClientOptions) {
  const transport = applicationTransport(options);
  return {
    auth: {
      signUp: (input: { name: string; email: string; password: string }, signal?: AbortSignal) =>
        transport.json(
          "/auth/sign-up/email",
          jsonRequest(input, "POST", undefined, signal),
          z.object({ user: User }),
        ),
      signIn: (input: { email: string; password: string }, signal?: AbortSignal) =>
        transport.json(
          "/auth/sign-in/email",
          jsonRequest(input, "POST", undefined, signal),
          z.object({ user: User }),
        ),
      session: (signal?: AbortSignal) => transport.json("/auth/get-session", { signal }, Session),
      signOut: (signal?: AbortSignal) =>
        transport.json("/auth/sign-out", jsonRequest({}, "POST", undefined, signal), z.unknown()),
      sessions: (signal?: AbortSignal) =>
        transport.json(
          "/auth/list-sessions",
          { signal },
          z.array(z.object({ id: z.string(), expiresAt: z.iso.datetime() })),
        ),
      revokeSession: (sessionId: string, signal?: AbortSignal) =>
        transport.json(
          "/auth/revoke-session",
          jsonRequest({ sessionId }, "POST", undefined, signal),
          z.object({ revoked: z.literal(true) }),
        ),
      revokeSessions: (signal?: AbortSignal) =>
        transport.json(
          "/auth/revoke-sessions",
          jsonRequest({}, "POST", undefined, signal),
          z.unknown(),
        ),
      changePassword: (
        input: { currentPassword: string; newPassword: string; revokeOtherSessions?: boolean },
        signal?: AbortSignal,
      ) =>
        transport.json(
          "/auth/change-password",
          jsonRequest(input, "POST", undefined, signal),
          z.unknown(),
        ),
      oauth: (provider: string, callbackURL: string, signal?: AbortSignal) =>
        transport.json(
          "/auth/sign-in/social",
          jsonRequest({ provider, callbackURL, disableRedirect: true }, "POST", undefined, signal),
          z.object({ url: z.url(), redirect: z.boolean() }),
        ),
    },
    files: applicationFiles(transport, options.chunkBytes),
    events: applicationEvents(transport, options.reconnectMs),
    request: <T>(
      path: string,
      input: {
        method?: "GET" | "POST";
        body?: unknown;
        idempotencyKey?: string;
        signal?: AbortSignal;
      },
      response: z.ZodType<T>,
    ) => {
      if (!/^\/[a-z][a-z0-9/-]*$/.test(path))
        throw new Error("Custom application route must be a fixed relative path");
      return transport.json(
        `/custom${path}`,
        input.method === "POST"
          ? jsonRequest(input.body, "POST", input.idempotencyKey, input.signal)
          : { signal: input.signal },
        response,
      );
    },
  };
}
