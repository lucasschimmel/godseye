import { createPrivateKey, createSign, type KeyObject } from "node:crypto";
import { FetchGithubAppTransport, GithubAppSourceProvider } from "@godseye/core";
import { z } from "zod";

/** GitHub caps App JWT lifetime at 10 minutes and recommends backdating `iat` by 60 seconds. */
const JWT_BACKDATE_SECONDS = 60;
const JWT_LIFETIME_SECONDS = 9 * 60;
/** Installation tokens live one hour; refresh early so a token never expires mid-request. */
const TOKEN_REFRESH_MARGIN_MS = 5 * 60 * 1000;
const TOKEN_PERMISSIONS = { contents: "read", pull_requests: "read", metadata: "read" } as const;
const TokenResponse = z.object({ token: z.string().min(1), expires_at: z.string().datetime() });
const base64url = (value: Buffer | string) => Buffer.from(value).toString("base64url");

export interface GithubAppCredentials {
  /** Client ID (preferred by GitHub) or numeric App ID, used as the `iss` claim. */
  issuer: string;
  /** PEM text of the App private key, read from a private OpenBao-rendered file. */
  privateKeyPem: string;
}
export interface GithubAppAuthOptions {
  request?: typeof fetch;
  now?: () => Date;
  apiOrigin?: string;
  apiVersion?: string;
}

/** RS256 App JWT per GitHub's current guidance. */
export function signGithubAppJwt(
  issuer: string,
  key: KeyObject,
  now: Date,
  lifetimeSeconds = JWT_LIFETIME_SECONDS,
) {
  const issuedAt = Math.floor(now.getTime() / 1000) - JWT_BACKDATE_SECONDS;
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = base64url(
    JSON.stringify({
      iat: issuedAt,
      exp: issuedAt + JWT_BACKDATE_SECONDS + lifetimeSeconds,
      iss: issuer,
    }),
  );
  const signature = createSign("RSA-SHA256").update(`${header}.${claims}`).sign(key);
  return `${header}.${claims}.${base64url(signature)}`;
}

/**
 * Produces bearer credentials for {@link FetchGithubAppTransport}: a fresh App JWT, or a cached
 * read-only installation token minted from it. Tokens never leave this closure or enter DTOs.
 */
export function githubAppAuthorizer(
  credentials: GithubAppCredentials,
  options: GithubAppAuthOptions = {},
) {
  const key = createPrivateKey(credentials.privateKeyPem);
  const request = options.request ?? fetch;
  const now = options.now ?? (() => new Date());
  const origin = options.apiOrigin ?? "https://api.github.com";
  const version = options.apiVersion ?? "2026-03-10";
  const cache = new Map<number, { token: string; expiresAt: number }>();
  const inflight = new Map<number, Promise<string>>();
  const mint = async (installationId: number) => {
    const response = await request(`${origin}/app/installations/${installationId}/access_tokens`, {
      method: "POST",
      redirect: "error",
      headers: {
        authorization: `Bearer ${signGithubAppJwt(credentials.issuer, key, now())}`,
        accept: "application/vnd.github+json",
        "content-type": "application/json",
        "X-GitHub-Api-Version": version,
      },
      body: JSON.stringify({ permissions: TOKEN_PERMISSIONS }),
      signal: AbortSignal.timeout(10000),
    });
    if (response.status !== 201) throw new Error("GitHub installation token request failed");
    const parsed = TokenResponse.parse(await response.json());
    cache.set(installationId, { token: parsed.token, expiresAt: Date.parse(parsed.expires_at) });
    return parsed.token;
  };
  return async (installationId: number, mode: "app" | "installation") => {
    if (mode === "app") return signGithubAppJwt(credentials.issuer, key, now());
    const cached = cache.get(installationId);
    if (cached && cached.expiresAt - TOKEN_REFRESH_MARGIN_MS > now().getTime()) return cached.token;
    let pending = inflight.get(installationId);
    if (!pending) {
      pending = mint(installationId).finally(() => inflight.delete(installationId));
      inflight.set(installationId, pending);
    }
    return pending;
  };
}

/** Wires the existing allowlisted source verifier to App credentials; the verifier denies forks. */
export function createGithubSourceProvider(
  credentials: GithubAppCredentials,
  options: GithubAppAuthOptions = {},
) {
  return new GithubAppSourceProvider(
    new FetchGithubAppTransport(githubAppAuthorizer(credentials, options), options.request),
    options.now,
  );
}
