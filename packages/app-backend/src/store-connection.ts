import type pg from "pg";
import { ApplicationError } from "./contracts.js";

/** Verified TLS (`verify-full` equivalent): CA chain plus hostname check; no URI-level override is honored. */
export interface ApplicationTlsOptions {
  /** PEM CA bundle that signed the cell server certificate. */
  ca: string;
  /** Name that must appear in the certificate; defaults to the URL host. */
  servername?: string;
}
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);
const invalid = (message: string) => new ApplicationError("INVALID_CONFIGURATION", message, 422);

function parseUrl(databaseUrl: string) {
  try {
    return new URL(databaseUrl);
  } catch {
    throw invalid("Invalid application database URL");
  }
}
/**
 * Builds a pg pool configuration. Without `tls` only an explicit loopback endpoint is accepted (the
 * pre-existing local behavior). With `tls` the URL must carry no query parameters, so `sslmode` or
 * similar parameters can never weaken certificate and hostname verification.
 */
export function applicationPoolConfig(
  databaseUrl: string,
  tls: ApplicationTlsOptions | undefined,
  max: number,
): pg.PoolConfig {
  const url = parseUrl(databaseUrl);
  if (!tls) {
    if (!LOOPBACK_HOSTS.has(url.hostname))
      throw invalid("A non-loopback application database requires verified TLS options");
    return { connectionString: databaseUrl, max };
  }
  if (
    !["postgresql:", "postgres:"].includes(url.protocol) ||
    !url.username ||
    !url.password ||
    !/^\/[A-Za-z0-9_-]+$/.test(url.pathname) ||
    url.search ||
    url.hash ||
    !tls.ca.includes("BEGIN CERTIFICATE")
  )
    throw invalid("Verified TLS requires a plain authenticated URL and a PEM CA");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  return {
    host,
    port: url.port ? Number(url.port) : 5432,
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database: url.pathname.slice(1),
    ssl: {
      ca: tls.ca,
      rejectUnauthorized: true,
      servername: tls.servername ?? host,
      minVersion: "TLSv1.2",
    },
    connectionTimeoutMillis: 5000,
    max,
  };
}
