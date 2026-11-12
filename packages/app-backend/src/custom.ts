import { and, eq } from "drizzle-orm";
import type { Hono } from "hono";
import type { z } from "zod";
import { type ApplicationAuth, requireApplicationSession } from "./auth.js";
import { APP_BASE, ApplicationError, type ApplicationUser } from "./contracts.js";
import { fileMutation } from "./file-state.js";
import { boundedBody } from "./runtime.js";
import { session } from "./schema.js";
import { type ApplicationState, guardApplication } from "./state.js";
import type { ApplicationAccess } from "./store.js";

export interface ApplicationRouteContext<Input = undefined> {
  user: ApplicationUser;
  input: Input;
  db: ApplicationAccess;
}
export interface ApplicationRouteRegistry {
  get<Output>(
    path: string,
    output: z.ZodType<Output>,
    handler: (context: ApplicationRouteContext) => Promise<Output>,
  ): void;
  post<Input, Output>(
    path: string,
    input: z.ZodType<Input>,
    output: z.ZodType<Output>,
    handler: (context: ApplicationRouteContext<Input>) => Promise<Output>,
  ): void;
}
export function applicationRouteRegistry(
  app: Hono,
  state: ApplicationState,
  auth: ApplicationAuth,
): ApplicationRouteRegistry {
  const fixedPath = (path: string) => {
    if (!/^\/[a-z][a-z0-9/-]*$/.test(path))
      throw new ApplicationError(
        "INVALID_ROUTE",
        "Application route must be a fixed relative path",
        422,
      );
    return `${APP_BASE}/custom${path}`;
  };
  return {
    get(path, output, handler) {
      app.get(fixedPath(path), async (c) => {
        const epoch = await guardApplication(state);
        const identity = await requireApplicationSession(state, auth, c.req.raw.headers);
        const result = output.parse(
          await handler({ user: identity.user, input: undefined, db: state.store.db }),
        );
        await requireApplicationSession(state, auth, c.req.raw.headers);
        await guardApplication(state, epoch);
        return c.json(result);
      });
    },
    post(path, input, output, handler) {
      app.post(fixedPath(path), (c) =>
        state.store.exclusive(async () => {
          const identity = await requireApplicationSession(state, auth, c.req.raw.headers);
          let value: unknown;
          try {
            value = JSON.parse(new TextDecoder().decode(await boundedBody(c.req.raw, 16384)));
          } catch (error) {
            if (error instanceof ApplicationError) throw error;
            throw new ApplicationError("INVALID_JSON", "Malformed custom-route JSON", 400);
          }
          const parsed = input.safeParse(value);
          if (!parsed.success)
            throw new ApplicationError(
              "INVALID_INPUT",
              "Custom-route input differs from contract",
              422,
            );
          const result = await fileMutation(
            state,
            identity.user.id,
            c.req.header("Idempotency-Key"),
            { action: `custom:${path}`, input: parsed.data },
            async (tx) => {
              const response = output.parse(
                await handler({ user: identity.user, input: parsed.data, db: tx }),
              );
              // Stay on the transaction connection: global auth queries deadlock PGlite here.
              const [currentSession] = await tx
                .select({ expiresAt: session.expiresAt })
                .from(session)
                .where(
                  and(eq(session.id, identity.session.id), eq(session.userId, identity.user.id)),
                );
              if (!currentSession || currentSession.expiresAt <= state.now())
                throw new ApplicationError(
                  "UNAUTHENTICATED",
                  "Application session was revoked",
                  401,
                );
              return response;
            },
          );
          return c.json(result);
        }),
      );
    },
  };
}
