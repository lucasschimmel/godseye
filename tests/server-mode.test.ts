import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadConfiguration } from "../apps/control-api/src/config.js";
import { clientAddress } from "../apps/control-api/src/server-config.js";
import { challengeCookie, type OwnerAuthFixture, ownerAuthFixture } from "./owner-auth-fixture.js";

const httpsOrigin = "https://godseye.example.org";
const serverEnv: NodeJS.ProcessEnv = {
  GODSEYE_MODE: "server",
  NODE_ENV: "production",
  GODSEYE_PUBLIC_ORIGIN: httpsOrigin,
  GODSEYE_API_HOST: "127.0.0.1",
  GODSEYE_TRUSTED_PROXIES: "127.0.0.1,::1",
  GODSEYE_DATABASE_URL: "postgresql://godseye:REPLACE_ME@127.0.0.1:5432/godseye",
  GODSEYE_BAO_ADDRESS: "https://127.0.0.1:8200",
  GODSEYE_BAO_MOUNT: "godseye",
};
const without = (name: string): NodeJS.ProcessEnv => {
  const { [name]: _removed, ...rest } = serverEnv;
  return rest;
};

describe("server mode configuration", () => {
  it("derives every browser-facing value from the single https owner origin", () => {
    const config = loadConfiguration(serverEnv);
    expect(config).toMatchObject({
      mode: "server",
      ownerOrigin: httpsOrigin,
      origins: [httpsOrigin],
      hosts: ["godseye.example.org", "127.0.0.1:4301"],
      host: "127.0.0.1",
      trustedProxies: ["127.0.0.1", "::1"],
    });
  });

  it.each([
    ["GODSEYE_PUBLIC_ORIGIN"],
    ["GODSEYE_API_HOST"],
    ["GODSEYE_TRUSTED_PROXIES"],
    ["GODSEYE_DATABASE_URL"],
    ["GODSEYE_BAO_ADDRESS"],
    ["GODSEYE_BAO_MOUNT"],
  ])("refuses server mode without %s", (name) => {
    expect(() => loadConfiguration(without(name))).toThrow();
  });

  it.each([
    ["GODSEYE_PUBLIC_ORIGIN", "http://godseye.example.org"],
    ["GODSEYE_PUBLIC_ORIGIN", "https://localhost"],
    ["GODSEYE_PUBLIC_ORIGIN", "https://203.0.113.7"],
    ["GODSEYE_PUBLIC_ORIGIN", "https://godseye.example.org/console"],
    ["GODSEYE_API_HOST", "0.0.0.0"],
    ["GODSEYE_API_HOST", "65.108.38.218"],
    ["GODSEYE_TRUSTED_PROXIES", "*"],
    ["GODSEYE_TRUSTED_PROXIES", "203.0.113.7"],
    ["GODSEYE_DATABASE_URL", "file:./local.db"],
    ["GODSEYE_BAO_ADDRESS", "http://127.0.0.1:8200"],
  ])("refuses an unsafe %s value %s", (name, value) => {
    expect(() => loadConfiguration({ ...serverEnv, [name]: value })).toThrow();
  });

  it("accepts a private-bridge bind address", () => {
    expect(loadConfiguration({ ...serverEnv, GODSEYE_API_HOST: "10.20.1.10" }).hosts).toContain(
      "10.20.1.10:4301",
    );
  });

  it("refuses production with local mode and an unset mode", () => {
    expect(() => loadConfiguration({ ...serverEnv, GODSEYE_MODE: "local" })).toThrow(/Local mode/);
    expect(() => loadConfiguration({ ...serverEnv, GODSEYE_MODE: undefined })).toThrow(
      /GODSEYE_MODE/,
    );
  });

  it("keeps local mode origins and loopback bind unchanged", () => {
    const config = loadConfiguration({ GODSEYE_MODE: "local" });
    expect(config).toMatchObject({
      mode: "local",
      host: "127.0.0.1",
      ownerOrigin: "http://localhost:4300",
      origins: ["http://127.0.0.1:4300", "http://localhost:4300"],
    });
  });
});

describe("trusted proxy client resolution", () => {
  const trusted = ["127.0.0.1"];
  it("uses the socket peer when it is not a trusted proxy, ignoring spoofed forwarding", () => {
    expect(clientAddress("198.51.100.4", "127.0.0.1", trusted)).toBe("198.51.100.4");
  });
  it("uses the right-most untrusted hop behind a trusted proxy", () => {
    expect(clientAddress("127.0.0.1", "127.0.0.1, 198.51.100.4", trusted)).toBe("198.51.100.4");
  });
  it("fails closed on a malformed forwarding chain", () => {
    expect(clientAddress("127.0.0.1", "not-an-ip", trusted)).toBeUndefined();
  });
});

describe("https owner origin HTTP boundary", () => {
  let fixture: OwnerAuthFixture;
  const loopbackPeer = { incoming: { socket: { remoteAddress: "127.0.0.1" } } };
  beforeEach(async () => {
    fixture = await ownerAuthFixture(httpsOrigin, serverEnv);
  });
  afterEach(async () => {
    await fixture.close();
  });

  it("publishes the https origin as the owner status origin", async () => {
    const response = await fixture.request("/api/v1/owner/session");
    expect(await response.json()).toMatchObject({ origin: httpsOrigin });
  });

  it("reports server mode in health", async () => {
    const response = await fixture.request("/api/v1/health");
    expect(await response.json()).toEqual({ status: "ok", mode: "server", serverConnected: true });
  });

  it("refuses a foreign Host or Origin", async () => {
    const host = await fixture.app.request("https://evil.example/api/v1/health", {
      headers: { host: "evil.example" },
    });
    const origin = await fixture.app.request(`${httpsOrigin}/api/v1/health`, {
      headers: { host: "godseye.example.org", origin: "http://localhost:4300" },
    });
    expect([host.status, origin.status]).toEqual([403, 403]);
  });

  it("scopes WebAuthn to the origin hostname and issues __Host- strict secure cookies", async () => {
    const enrollment = await fixture.identity.prepareEnrollment("setup");
    const response = await fixture.authRequest(
      `/passkey/generate-register-options?context=${enrollment.ticket}`,
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ rp: { id: "godseye.example.org" } });
    const cookies = response.headers.getSetCookie();
    expect(cookies.length).toBeGreaterThan(0);
    for (const cookie of cookies) {
      expect(cookie).toMatch(/^__Host-godseye-owner\./);
      expect(cookie).toMatch(/; Secure/i);
      expect(cookie).toMatch(/SameSite=Strict/i);
      expect(cookie).toMatch(/Path=\//);
      expect(cookie).not.toMatch(/Domain=/i);
    }
    expect(challengeCookie(response)).toContain("__Host-godseye-owner");
  });

  it("names the owner session cookie with the __Host- prefix", async () => {
    const session = await fixture.session();
    expect(session.cookie.startsWith("__Host-godseye-owner.")).toBe(true);
    expect(await fixture.identity.actor(session.headers)).toMatchObject({
      id: fixture.identity.ownerId,
    });
  });

  it("refuses local administration when the peer cannot be proven", async () => {
    const response = await fixture.app.request(
      "http://127.0.0.1:4301/api/v1/owner/local-command",
      fixture.localCommandProof("setup"),
    );
    expect(response.status).toBe(403);
  });

  it("refuses local administration from a non-loopback peer", async () => {
    const response = await fixture.app.request(
      "http://127.0.0.1:4301/api/v1/owner/local-command",
      fixture.localCommandProof("setup"),
      { incoming: { socket: { remoteAddress: "10.8.0.2" } } },
    );
    expect(response.status).toBe(403);
  });

  it("refuses local administration that crossed the edge proxy", async () => {
    const request = fixture.localCommandProof("setup");
    const response = await fixture.app.request(
      "http://127.0.0.1:4301/api/v1/owner/local-command",
      { ...request, headers: { ...request.headers, "x-forwarded-for": "198.51.100.4" } },
      loopbackPeer,
    );
    expect(response.status).toBe(403);
  });

  it("accepts proven local administration from a direct loopback peer", async () => {
    const response = await fixture.app.request(
      "http://127.0.0.1:4301/api/v1/owner/local-command",
      fixture.localCommandProof("setup"),
      loopbackPeer,
    );
    expect(response.status).toBe(200);
  });
});
