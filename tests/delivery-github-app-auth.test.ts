import { createVerify, generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  createGithubSourceProvider,
  githubAppAuthorizer,
  signGithubAppJwt,
} from "../apps/control-api/src/delivery/github-app-auth.js";

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const privateKeyPem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const NOW = new Date("2026-11-15T10:00:00.000Z");
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("GitHub App authentication", () => {
  it("signs an RS256 JWT with a backdated iat and a lifetime under ten minutes", () => {
    const jwt = signGithubAppJwt("Iv1.client", privateKey, NOW);
    const [header, claims, signature] = jwt.split(".") as [string, string, string];
    expect(JSON.parse(Buffer.from(header, "base64url").toString())).toEqual({
      alg: "RS256",
      typ: "JWT",
    });
    const parsed = JSON.parse(Buffer.from(claims, "base64url").toString());
    const now = NOW.getTime() / 1000;
    expect(parsed).toEqual({ iat: now - 60, exp: now + 540, iss: "Iv1.client" });
    expect(parsed.exp - now).toBeLessThanOrEqual(600);
    const verifier = createVerify("RSA-SHA256").update(`${header}.${claims}`);
    expect(verifier.verify(publicKey, Buffer.from(signature, "base64url"))).toBe(true);
  });

  it("mints one scoped installation token, caches it and refreshes before expiry", async () => {
    let clock = NOW.getTime();
    const bodies: unknown[] = [];
    let mints = 0;
    const request = (async (url: string, init: RequestInit) => {
      expect(url).toBe("https://api.github.com/app/installations/456/access_tokens");
      expect(init.method).toBe("POST");
      expect(String((init.headers as Record<string, string>).authorization)).toMatch(/^Bearer ey/);
      bodies.push(JSON.parse(String(init.body)));
      mints += 1;
      return json(201, {
        token: `ghs_token_${mints}`,
        expires_at: new Date(clock + 3600_000).toISOString(),
      });
    }) as unknown as typeof fetch;
    const authorize = githubAppAuthorizer(
      { issuer: "1", privateKeyPem },
      { request, now: () => new Date(clock) },
    );
    const [first, second] = await Promise.all([
      authorize(456, "installation"),
      authorize(456, "installation"),
    ]);
    expect([first, second]).toEqual(["ghs_token_1", "ghs_token_1"]);
    expect(mints).toBe(1);
    expect(bodies[0]).toEqual({
      permissions: { contents: "read", pull_requests: "read", metadata: "read" },
    });
    clock += 30 * 60_000;
    expect(await authorize(456, "installation")).toBe("ghs_token_1");
    clock += 30 * 60_000;
    expect(await authorize(456, "installation")).toBe("ghs_token_2");
    expect(await authorize(456, "app")).toMatch(/^ey/);
  });

  it("fails closed when GitHub refuses the installation token", async () => {
    const authorize = githubAppAuthorizer(
      { issuer: "1", privateKeyPem },
      { request: (async () => json(404, { message: "Not Found" })) as unknown as typeof fetch },
    );
    await expect(authorize(9, "installation")).rejects.toThrow("installation token");
  });

  it("resolves branch heads and flags fork pull requests via the real source verifier", async () => {
    const repo = { id: 7, full_name: "owner/app" };
    const routes: Record<string, unknown> = {
      "/repos/owner/app/installation": { id: 456, suspended_at: null },
      "/repos/owner/app": repo,
      "/repos/owner/app/git/ref/heads/main": {
        ref: "refs/heads/main",
        object: { type: "commit", sha: "c".repeat(40) },
      },
      "/repos/owner/app/pulls/3": {
        number: 3,
        state: "open",
        head: { ref: "patch", sha: "d".repeat(40), repo: { id: 99, full_name: "evil/app" } },
        base: { ref: "main", repo },
      },
    };
    const request = (async (url: string, init: RequestInit) => {
      if (url.endsWith("/access_tokens"))
        return json(201, {
          token: "ghs_x",
          expires_at: new Date(NOW.getTime() + 3600_000).toISOString(),
        });
      const path = new URL(url).pathname;
      expect(String((init.headers as Record<string, string>).authorization)).toMatch(/^Bearer /);
      return routes[path] ? json(200, routes[path]) : json(404, {});
    }) as unknown as typeof fetch;
    const provider = createGithubSourceProvider(
      { issuer: "1", privateKeyPem },
      { request, now: () => NOW },
    );
    const binding = {
      fullName: "owner/app",
      repositoryId: 7,
      installationId: 456,
      branch: "main",
      autoDeploy: false,
    };
    const head = await provider.resolve(binding, { branch: "main", pullRequestNumber: null });
    expect(head).toMatchObject({
      commitSha: "c".repeat(40),
      sameRepository: true,
      installationActive: true,
    });
    const pull = await provider.resolve(binding, { branch: "patch", pullRequestNumber: 3 });
    expect(pull.sameRepository).toBe(false);
    await expect(
      provider.resolve(binding, { branch: "other", pullRequestNumber: null }),
    ).rejects.toMatchObject({ code: "SOURCE_UNAVAILABLE" });
  });
});
