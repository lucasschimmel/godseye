import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { type CellHostExecutor, parseCellHost } from "../packages/core/src/cell-host.js";
import { compileDatabaseProfile } from "../packages/core/src/database-policy.js";
import {
  hostQualification,
  ServerPostgresTransport,
} from "../packages/core/src/database-server-transport.js";
import { ServerPgBackRestTransport } from "../packages/core/src/recovery-server-transport.js";
import { fixtureProfile } from "./pg-helpers.js";

class FakeHost implements CellHostExecutor {
  readonly commands: string[][] = [];
  readonly files = new Map<string, string>();
  readonly outputs = new Map<string, string>();
  poolHealth = "ONLINE";
  async run(argv: readonly string[]) {
    this.commands.push([...argv]);
    const key = argv.join(" ");
    if (argv.includes("list") && argv.includes("health")) return `${this.poolHealth}\n`;
    if (argv.at(-1) === "--version") return "postgres (PostgreSQL) 18.6\n";
    if (argv.at(-1) === "version") return "pgBackRest 2.60\n";
    for (const [needle, output] of this.outputs) if (key.includes(needle)) return output;
    return "";
  }
  async writeFile(path: string, content: string) {
    this.files.set(path, content);
  }
  async readFile(path: string) {
    return this.files.get(path) ?? null;
  }
  async listDirectory(path: string) {
    const prefix = `${path}/`;
    return [
      ...new Set(
        [...this.files.keys()]
          .filter((f) => f.startsWith(prefix))
          .map((f) => f.slice(prefix.length).split("/")[0] ?? ""),
      ),
    ];
  }
  async removeFile(path: string) {
    this.files.delete(path);
  }
}
const hostConfig = parseCellHost({
  zfsParent: "tank/godseye/pg",
  mountRoot: "/srv/godseye/pg",
  bindAddress: "10.77.0.1",
  clientIpv4Cidr: "10.77.0.0/24",
  servername: "pg.cells.internal",
  portRange: [15432, 15434],
});
function scopeFor(allocationId = randomUUID()) {
  const projectId = randomUUID();
  const environmentId = randomUUID();
  return {
    scope: {
      allocationId,
      projectId,
      environmentId,
      preparationHash: "h",
      generation: 1,
      epoch: 1,
    },
    profile: compileDatabaseProfile(fixtureProfile, { allocationId, projectId, environmentId }),
  };
}
const transport = (host: FakeHost) =>
  new ServerPostgresTransport({
    host: hostConfig,
    executor: host,
    archiveCipher: async () => "c".repeat(43),
    sleep: async () => {},
  });

describe("ServerPostgresTransport", () => {
  it("creates independent quota-bound datasets and a private-bridge listener", async () => {
    const host = new FakeHost();
    const { scope, profile } = scopeFor();

    await transport(host).create(scope, profile);

    const zfs = host.commands.filter((c) => c.includes("create"));
    expect(zfs.map((c) => c.find((a) => a.startsWith("quota=")))).toEqual([
      `quota=${profile.storage.dataQuotaGiB}G`,
      `quota=${profile.storage.walQuotaGiB}G`,
      "quota=16G",
    ]);
    const initdb = host.commands.find((c) => c[0]?.endsWith("/initdb"));
    expect(initdb).toContain("-X");
    const conf = host.files.get(`/etc/godseye/pg/${scope.allocationId}/postgresql.conf`) ?? "";
    expect(conf).toContain("listen_addresses = '10.77.0.1'");
    expect(conf).toContain("archive_mode = 'on'");
  });
  it("renders HBA with TLS-only host rules and no trust", async () => {
    const host = new FakeHost();
    const { scope, profile } = scopeFor();

    await transport(host).create(scope, profile);

    const hba = host.files.get(`/etc/godseye/pg/${scope.allocationId}/pg_hba.conf`) ?? "";
    expect(hba).toContain("hostssl");
    expect(hba).not.toMatch(/\btrust\b/);
  });
  it("assigns distinct ports to successive cells", async () => {
    const host = new FakeHost();
    const first = scopeFor();
    const second = scopeFor();

    await transport(host).create(first.scope, first.profile);
    await transport(host).create(second.scope, second.profile);

    const port = (id: string) =>
      host.files.get(`/etc/godseye/pg/${id}/cell.env`)?.match(/PORT=(\d+)/)?.[1];
    expect([port(first.scope.allocationId), port(second.scope.allocationId)]).toEqual([
      "15432",
      "15433",
    ]);
  });
  it("refuses to adopt existing cell state", async () => {
    const host = new FakeHost();
    const { scope, profile } = scopeFor();
    await transport(host).create(scope, profile);

    await expect(transport(host).create(scope, profile)).rejects.toThrow("refusing to adopt");
  });
  it("rejects a profile whose allocation differs from the scope", async () => {
    const host = new FakeHost();
    const { profile } = scopeFor();

    await expect(transport(host).create(scopeFor().scope, profile)).rejects.toThrow("differs");
  });
  it("reports quota and ownership from ZFS rather than from names", async () => {
    const host = new FakeHost();
    const { scope, profile } = scopeFor();
    const t = transport(host);
    await t.create(scope, profile);
    const gib = (n: number) => n * 1024 ** 3;
    host.outputs.set("pg_controldata", "Database system identifier:           7400000000000001\n");
    host.outputs.set("ActiveState", "active\n");
    host.outputs.set(
      `${scope.allocationId}/data`,
      `quota\t${gib(profile.storage.dataQuotaGiB)}\nmountpoint\t/srv/godseye/pg/${scope.allocationId}/data\ngodseye:volume\t${profile.dataVolume}\n`,
    );
    host.outputs.set(
      `${scope.allocationId}/wal`,
      `quota\t${gib(profile.storage.walQuotaGiB)}\nmountpoint\t/srv/godseye/pg/${scope.allocationId}/wal\ngodseye:volume\t${profile.walVolume}\n`,
    );

    const inspection = await t.inspect(scope, null);

    expect(inspection).toMatchObject({
      running: true,
      quotaEnforced: true,
      independentInstance: true,
      privateNetwork: true,
      dataVolume: profile.dataVolume,
      systemIdentifier: "7400000000000001",
    });
  });
  it("reports an unenforced quota when ZFS has none", async () => {
    const host = new FakeHost();
    const { scope, profile } = scopeFor();
    const t = transport(host);
    await t.create(scope, profile);
    host.outputs.set("pg_controldata", "Database system identifier:           1\n");
    host.outputs.set("ActiveState", "inactive\n");
    host.outputs.set(scope.allocationId, "quota\t0\nmountpoint\t/x\ngodseye:volume\tv\n");

    const inspection = await t.inspect(scope, null);

    expect(inspection?.quotaEnforced).toBe(false);
  });
  it("returns null for an unknown allocation", async () => {
    await expect(transport(new FakeHost()).inspect(scopeFor().scope, null)).resolves.toBeNull();
  });
  it("stops through the allocation's own systemd instance only", async () => {
    const host = new FakeHost();
    const { scope } = scopeFor();

    await transport(host).stop(scope, `godseye-pg@${scope.allocationId}.service`);

    expect(host.commands.map((c) => c.at(-1))).toEqual(
      Array(2).fill(`godseye-pg@${scope.allocationId}.service`),
    );
    await expect(transport(host).stop(scope, "godseye-pg@other.service")).rejects.toThrow(
      "differs",
    );
  });
});

describe("hostQualification", () => {
  const binding = { providerId: "p", targetId: "t", version: "18/2.60", generation: "g" };
  it("attests a healthy host with an expiry", async () => {
    const proof = await hostQualification(
      hostConfig,
      new FakeHost(),
      binding,
      () => new Date("2026-11-15T00:00:00Z"),
    )();

    expect(proof?.expiresAt).toBe("2026-11-15T00:05:00.000Z");
  });
  it("withholds attestation when the ZFS pool is not online", async () => {
    const host = new FakeHost();
    host.poolHealth = "DEGRADED";

    await expect(hostQualification(hostConfig, host, binding)()).resolves.toBeNull();
  });
});

describe("ServerPgBackRestTransport", () => {
  it("derives one stanza binding per source cell from the host layout", async () => {
    const host = new FakeHost();
    const { scope, profile } = scopeFor();
    await transport(host).create(scope, profile);

    const binding = await new ServerPgBackRestTransport(hostConfig, host).binding({
      projectId: scope.projectId,
      sourceAllocationId: scope.allocationId,
      repositoryId: randomUUID(),
    } as never);

    expect(binding).toMatchObject({
      pgData: `/srv/godseye/pg/${scope.allocationId}/data`,
      repositoryPath: `/srv/godseye/pg/${scope.allocationId}/repo`,
      pgPort: 15432,
    });
  });
});
