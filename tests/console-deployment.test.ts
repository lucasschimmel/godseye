import { describe, expect, it } from "vitest";
import {
  describeDeployment,
  isLoopbackHost,
  ownerEntryCopy,
  recoveryCopy,
  runtimeHeading,
  shellCopy,
  UNKNOWN_DEPLOYMENT,
} from "../apps/console/src/lib/deployment";

const server = describeDeployment({
  mode: "server",
  qualification: { completed: 0, total: 8, serverConnected: true },
});
const local = describeDeployment({
  mode: "local",
  qualification: { completed: 0, total: 8, serverConnected: false },
});

describe("console deployment awareness", () => {
  it("stays unknown until the overview answered", () => {
    expect(describeDeployment(undefined)).toBe(UNKNOWN_DEPLOYMENT);
    expect(shellCopy(UNKNOWN_DEPLOYMENT)).toBeUndefined();
  });

  it("keeps the local development wording in local mode", () => {
    const copy = shellCopy(local);
    expect(copy?.pill).toBe("Développement local");
    expect(copy?.strip.title).toBe("Serveur non connecté");
    expect(copy?.footer).toContain("Local d’abord");
  });

  it("never claims a local session or a missing server in server mode", () => {
    const copy = shellCopy(server);
    expect(copy?.strip.title).toBe("Serveur dédié connecté");
    expect(copy?.strip.tone).toBe("green");
    expect(JSON.stringify(copy)).not.toMatch(/local|non connecté|ordinateur/i);
  });

  it("flags a server mode whose connection is not confirmed", () => {
    const unconfirmed = describeDeployment({
      mode: "server",
      qualification: { completed: 0, total: 8, serverConnected: false },
    });
    expect(shellCopy(unconfirmed)?.strip.tone).toBe("amber");
  });

  it("routes server recovery through the break-glass flow, not a local terminal", () => {
    const remote = recoveryCopy(server);
    expect(remote.intro).toContain("WireGuard");
    expect(remote.intro).not.toContain("cette machine");
    expect(remote.procedure).toContain("break-glass.md");
    expect(recoveryCopy(UNKNOWN_DEPLOYMENT).intro).toBe(remote.intro);
    expect(recoveryCopy(local).intro).toContain("terminal de cette machine");
  });

  it("labels the Hermes runtime without local wording in server mode", () => {
    expect(runtimeHeading(false, true)).toBe("Runtime local à connecter");
    expect(runtimeHeading(false, false)).toBe("Runtime à qualifier");
    expect(runtimeHeading(true, false)).not.toMatch(/local/i);
  });

  it("derives the owner entry wording from the host", () => {
    expect(isLoopbackHost("localhost")).toBe(true);
    expect(isLoopbackHost("console.example.test")).toBe(false);
    expect(ownerEntryCopy("localhost").firstAccess).toContain("terminal local");
    expect(ownerEntryCopy("console.example.test").firstAccess).toContain("serveur");
    expect(ownerEntryCopy(null).firstAccess).not.toContain("terminal local");
  });
});
