import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { type BoardsAuth, createBoardsAuth } from "./auth";
import { type BoardsDatabase, openBoardsStore } from "./db";

export interface BoardsRuntime {
  db: BoardsDatabase;
  auth: BoardsAuth;
}

/** Anchored at the repository root (apps/boards/src/server -> four levels up), never at the cwd. */
const DEFAULT_STATE_DIR = fileURLToPath(new URL("../../../../.local/boards", import.meta.url));
const DEFAULT_PORT = 4500;

export const boardsPort = () => Number(process.env.BOARDS_PORT ?? DEFAULT_PORT);
const baseUrl = () => process.env.BOARDS_BASE_URL ?? `http://localhost:${boardsPort()}`;

/**
 * The auth secret comes from the environment. Only outside production, a private random one is
 * created once under the local state directory so that sessions survive a dev-server restart.
 */
function authSecret(stateDir: string): string {
  const configured = process.env.BOARDS_AUTH_SECRET;
  if (configured) return configured;
  if (process.env.NODE_ENV === "production")
    throw new Error("BOARDS_AUTH_SECRET is required in production");
  const path = join(stateDir, "auth.secret");
  if (existsSync(path)) return readFileSync(path, "utf8").trim();
  const secret = randomBytes(48).toString("base64url");
  mkdirSync(stateDir, { recursive: true });
  writeFileSync(path, secret, { mode: 0o600 });
  return secret;
}

async function open(): Promise<BoardsRuntime> {
  const stateDir = resolve(process.env.BOARDS_STATE_DIR ?? DEFAULT_STATE_DIR);
  const store = await openBoardsStore({
    databaseUrl: process.env.BOARDS_DATABASE_URL,
    dataDir: join(stateDir, "database"),
  });
  const auth = createBoardsAuth({
    db: store.db,
    secret: authSecret(stateDir),
    baseUrl: baseUrl(),
    // Sign-up is open by default for a local instance; hosted instances opt out explicitly.
    allowSignUp: process.env.BOARDS_ALLOW_SIGNUP !== "false",
  });
  return { db: store.db, auth };
}

let runtime: Promise<BoardsRuntime> | undefined;
/** One lazily opened runtime per server process. A failed open is retried on the next request. */
export function getRuntime(): Promise<BoardsRuntime> {
  runtime ??= open().catch((error) => {
    runtime = undefined;
    throw error;
  });
  return runtime;
}
