import { isIP } from "node:net";

/**
 * Explicit server-mode admission. Every value here is validated from the environment; the mode flag
 * alone grants nothing. Console and API are private (WireGuard); only the signed GitHub webhook and
 * project applications are public, and the edge proxy in front of the API is a fixed trusted list.
 */
export interface ServerSettings {
  /** Single owner origin: WebAuthn rpID/origin, cookies, Host/Origin allowlists and enrollment links. */
  ownerOrigin: string;
  host: string;
  trustedProxies: string[];
}

const LOOPBACK_V4 = /^127\./;
const PRIVATE_V4 = /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/;

export function isLoopbackAddress(address: string): boolean {
  const value = address.replace(/^::ffff:/i, "");
  return value === "::1" || (isIP(value) === 4 && LOOPBACK_V4.test(value));
}

export function isPrivateAddress(address: string): boolean {
  const value = address.replace(/^::ffff:/i, "");
  if (isLoopbackAddress(value)) return true;
  if (isIP(value) === 4) return PRIVATE_V4.test(value);
  // Unique local IPv6 (fc00::/7). Link-local and public ranges are never an admitted bind.
  return isIP(value) === 6 && /^f[cd][0-9a-f]{2}:/i.test(value);
}

/** Host-header form of an address and port (IPv6 literals are bracketed). */
export function hostPort(host: string, port: number): string {
  return `${isIP(host) === 6 ? `[${host}]` : host}:${port}`;
}

/** Validates a browser-facing https origin that can be a WebAuthn relying party. */
export function parsePublicOrigin(value: string | undefined): string {
  let url: URL;
  try {
    url = new URL(value ?? "");
  } catch {
    throw new Error("Server mode requires GODSEYE_PUBLIC_ORIGIN as an https origin");
  }
  const bare =
    url.protocol === "https:" &&
    url.origin === value &&
    !url.username &&
    !url.password &&
    url.pathname === "/" &&
    !url.search &&
    !url.hash;
  const rpIdCapable =
    isIP(url.hostname.replace(/^\[|\]$/g, "")) === 0 &&
    url.hostname !== "localhost" &&
    !url.hostname.endsWith(".localhost") &&
    url.hostname.includes(".");
  if (!bare || !rpIdCapable)
    throw new Error(
      "GODSEYE_PUBLIC_ORIGIN must be a bare https origin with a registrable DNS name (no IP, localhost, path or credentials)",
    );
  return url.origin;
}

function parseTrustedProxies(value: string | undefined): string[] {
  const entries = (value ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  if (!entries.length || entries.some((entry) => isIP(entry) === 0 || !isPrivateAddress(entry)))
    throw new Error(
      "Server mode requires GODSEYE_TRUSTED_PROXIES as a fixed list of loopback or private IP addresses",
    );
  return [...new Set(entries)];
}

function parseBindHost(value: string | undefined): string {
  const host = value ?? "";
  if (isIP(host) === 0 || !isPrivateAddress(host))
    throw new Error(
      "Server mode requires GODSEYE_API_HOST as a loopback or private-bridge IP address, never a wildcard or public address",
    );
  return host;
}

function requireHttps(name: string, value: string | undefined): void {
  let url: URL;
  try {
    url = new URL(value ?? "");
  } catch {
    throw new Error(`Server mode requires ${name} as an https URL`);
  }
  if (url.protocol !== "https:" || url.username || url.password)
    throw new Error(`Server mode requires ${name} as an https URL without credentials`);
}

export function serverSettings(env: NodeJS.ProcessEnv, databaseUrl: string | undefined) {
  if (!databaseUrl || !/^postgres(ql)?:\/\//.test(databaseUrl))
    throw new Error("Server mode requires a PostgreSQL GODSEYE_DATABASE_URL");
  requireHttps("GODSEYE_BAO_ADDRESS", env.GODSEYE_BAO_ADDRESS);
  if (!env.GODSEYE_BAO_MOUNT) throw new Error("Server mode requires GODSEYE_BAO_MOUNT");
  return {
    ownerOrigin: parsePublicOrigin(env.GODSEYE_PUBLIC_ORIGIN),
    host: parseBindHost(env.GODSEYE_API_HOST),
    trustedProxies: parseTrustedProxies(env.GODSEYE_TRUSTED_PROXIES),
  } satisfies ServerSettings;
}

/**
 * Client address behind a fixed proxy list: the socket peer unless it is a trusted proxy, in which
 * case the right-most untrusted X-Forwarded-For entry. Returns undefined when it cannot be proven.
 */
export function clientAddress(
  peer: string | undefined,
  forwardedFor: string | undefined,
  trusted: readonly string[],
): string | undefined {
  if (!peer) return undefined;
  const normalize = (value: string) => value.replace(/^::ffff:/i, "");
  const trustedSet = new Set(trusted.map(normalize));
  if (!trustedSet.has(normalize(peer)) || forwardedFor === undefined) return normalize(peer);
  const chain = (forwardedFor ?? "").split(",").map((entry) => normalize(entry.trim()));
  for (let index = chain.length - 1; index >= 0; index--) {
    const hop = chain[index];
    if (!hop || isIP(hop) === 0) return undefined;
    if (!trustedSet.has(hop)) return hop;
  }
  return normalize(peer);
}
