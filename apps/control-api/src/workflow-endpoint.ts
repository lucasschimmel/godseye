import { isIP } from "node:net";
import { parsePrivateSubnet } from "../../../packages/core/src/infra-network.js";

export type WorkflowStore = "postgresql" | "redis";
const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);
const FAILURE =
  "Workflow storage requires an explicit authenticated loopback endpoint or a verified-TLS private-bridge address";
export interface WorkflowEndpoint {
  url: URL;
  /** `loopback` keeps the historical plaintext rules; `private` is a per-cell bridge address with TLS. */
  scope: "loopback" | "private";
  /** Stable identity for reuse detection; every loopback alias is the same host. */
  hostKey: string;
}
function privateAddress(hostname: string) {
  const bare = hostname.replace(/^\[|\]$/g, "");
  const family = isIP(bare);
  if (family === 0) return false;
  try {
    parsePrivateSubnet(`${bare}/${family === 4 ? 32 : 128}`);
    return true;
  } catch {
    return false;
  }
}
/**
 * Validates one per-cell workflow store endpoint. Loopback remains plaintext-only with fixed query
 * rules. A non-loopback address must be an RFC1918/ULA literal (no DNS names, so a name cannot be
 * re-pointed) and must use verified TLS: PostgreSQL `sslmode=verify-full` with an optional absolute
 * `sslrootcert`, Redis `rediss:`. No other connection parameter is accepted in either mode.
 */
export function workflowEndpoint(raw: string, store: WorkflowStore): WorkflowEndpoint {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("Invalid private storage endpoint");
  }
  const loopback = LOOPBACK.has(url.hostname);
  if ((!loopback && !privateAddress(url.hostname)) || !url.port || url.hash)
    throw new Error(FAILURE);
  const expected = store === "postgresql" ? "postgresql:" : loopback ? "redis:" : "rediss:";
  if (url.protocol !== expected) throw new Error(FAILURE);
  const params = [...url.searchParams];
  if (store === "redis" ? params.length : !pgParametersValid(params, loopback))
    throw new Error(FAILURE);
  return {
    url,
    scope: loopback ? "loopback" : "private",
    hostKey: loopback ? "loopback" : url.hostname,
  };
}
function pgParametersValid(params: [string, string][], loopback: boolean) {
  if (loopback) return params.every(([key, value]) => key === "sslmode" && value === "disable");
  const keys = params.map(([key]) => key);
  return (
    new Set(keys).size === keys.length &&
    params.some(([key, value]) => key === "sslmode" && value === "verify-full") &&
    params.every(
      ([key, value]) =>
        (key === "sslmode" && value === "verify-full") ||
        (key === "sslrootcert" && /^\/[A-Za-z0-9_./-]+$/.test(value) && !value.includes("..")),
    )
  );
}
