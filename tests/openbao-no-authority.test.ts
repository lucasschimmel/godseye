import { createServer } from "node:http";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { providerLabels } from "../apps/console/src/components/access-labels";
import {
  providerActionBlock,
  providerExplanations,
} from "../apps/console/src/lib/secrets-bindings";
import {
  BaoAccessProvider,
  ProviderAuthorityAbsentError,
} from "../packages/core/src/bao-provider.js";
import { type AccessFixture, accessFixture } from "./access-helpers.js";

interface Vault {
  health: { initialized: boolean; sealed: boolean };
  lookupStatus: number;
}
async function vaultServer(vault: Vault) {
  const server = createServer((request, response) => {
    response.setHeader("content-type", "application/json");
    if (request.url === "/v1/sys/health") return response.end(JSON.stringify(vault.health));
    response.statusCode = vault.lookupStatus;
    return response.end("{}");
  });
  await new Promise<void>((accept) => server.listen(0, "127.0.0.1", accept));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Fixture has no owned port");
  return {
    origin: `http://127.0.0.1:${address.port}`,
    close: async () => {
      server.closeAllConnections();
      await new Promise<void>((accept) => server.close(() => accept()));
    },
  };
}
const absent = () => {
  throw new ProviderAuthorityAbsentError();
};

describe("OpenBao health when the controller holds no identity", () => {
  let server: Awaited<ReturnType<typeof vaultServer>> | undefined;
  afterEach(async () => {
    await server?.close();
    server = undefined;
  });

  it("reports no_authority when the vault is unsealed and the authority file is absent", async () => {
    server = await vaultServer({ health: { initialized: true, sealed: false }, lookupStatus: 200 });
    const provider = new BaoAccessProvider({ address: server.origin, proof: absent });
    expect(await provider.health()).toEqual({ state: "no_authority" });
  });

  it("reports sealed before looking at the authority when the vault is sealed", async () => {
    server = await vaultServer({ health: { initialized: true, sealed: true }, lookupStatus: 200 });
    const provider = new BaoAccessProvider({ address: server.origin, proof: absent });
    expect(await provider.health()).toEqual({ state: "sealed" });
  });

  it("reports unauthorized when the vault rejects the controller authority", async () => {
    server = await vaultServer({ health: { initialized: true, sealed: false }, lookupStatus: 403 });
    const provider = new BaoAccessProvider({ address: server.origin, proof: () => "rejected" });
    expect(await provider.health()).toEqual({ state: "unauthorized" });
  });

  it("keeps unavailable for a real transport failure", async () => {
    server = await vaultServer({ health: { initialized: true, sealed: false }, lookupStatus: 200 });
    const origin = server.origin;
    await server.close();
    server = undefined;
    const provider = new BaoAccessProvider({ address: origin, proof: absent, timeoutMs: 500 });
    expect(await provider.health()).toEqual({ state: "unavailable" });
  });

  it("keeps unavailable when the authority read fails for another reason", async () => {
    server = await vaultServer({ health: { initialized: true, sealed: false }, lookupStatus: 200 });
    const provider = new BaoAccessProvider({
      address: server.origin,
      proof: () => {
        throw new Error("Unsafe provider authority file");
      },
    });
    expect(await provider.health()).toEqual({ state: "unavailable" });
  });
});

describe("access overview mapping of provider health", () => {
  let fixture: AccessFixture;
  beforeEach(async () => {
    fixture = await accessFixture();
  });
  afterEach(async () => {
    await fixture?.store.close();
  });

  it("passes no_authority through unchanged instead of calling it unavailable", async () => {
    fixture.materialProvider.state = "no_authority";
    const overview = await fixture.broker.overview(fixture.freshOwner());
    expect(overview.provider.state).toBe("no_authority");
  });

  it("maps a thrown health probe to unavailable", async () => {
    fixture.materialProvider.health = () => Promise.reject(new Error("connection refused"));
    const overview = await fixture.broker.overview(fixture.freshOwner());
    expect(overview.provider.state).toBe("unavailable");
  });
});

describe("console wording for the no_authority state", () => {
  it("says the vault answers and the owner must create the identity from their workstation", () => {
    expect(providerLabels.no_authority).toContain("répond");
    expect(providerExplanations.no_authority).toMatch(/répond/);
    expect(providerExplanations.no_authority).toMatch(/identité OpenBao/);
    expect(providerExplanations.no_authority).toMatch(/poste/);
    expect(providerExplanations.no_authority).toMatch(/autorité racine/);
  });

  it("does not describe the vault as unreachable", () => {
    expect(providerLabels.no_authority).not.toMatch(/indisponible/i);
    expect(providerExplanations.no_authority).not.toMatch(/ne répond pas/);
  });

  it("blocks vault actions with a stated reason unless the vault is ready", () => {
    expect(providerActionBlock("ready")).toBeNull();
    expect(providerActionBlock("no_authority")).toMatch(/identité OpenBao/);
    expect(providerActionBlock("sealed")).toMatch(/pas prêt/);
  });
});
