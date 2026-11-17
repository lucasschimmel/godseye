import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { betterAuth } from "better-auth";
import type { BoardsDatabase } from "./db";
import { authSchema } from "./schema";

const SESSION_SECONDS = 60 * 60 * 24 * 14;

export function createBoardsAuth(options: {
  db: BoardsDatabase;
  secret: string;
  baseUrl: string;
  allowSignUp: boolean;
}) {
  return betterAuth({
    baseURL: options.baseUrl,
    basePath: "/api/auth",
    secret: options.secret,
    trustedOrigins: [options.baseUrl],
    database: drizzleAdapter(options.db, {
      provider: "pg",
      schema: authSchema,
      transaction: true,
    }),
    emailAndPassword: {
      enabled: true,
      disableSignUp: !options.allowSignUp,
      minPasswordLength: 12,
      maxPasswordLength: 128,
    },
    session: { expiresIn: SESSION_SECONDS, cookieCache: { enabled: false } },
    advanced: {
      cookiePrefix: "godseye-boards",
      useSecureCookies: options.baseUrl.startsWith("https:"),
      defaultCookieAttributes: { httpOnly: true, sameSite: "lax", path: "/" },
    },
    rateLimit: { enabled: true, window: 60, max: 20 },
    logger: { disabled: true },
  });
}
export type BoardsAuth = ReturnType<typeof createBoardsAuth>;
