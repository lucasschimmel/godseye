import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  type CellHostExecutor,
  HELPER_NOT_FOUND,
  HelperError,
  type HelperVerb,
  parseCellHost,
} from "../packages/core/src/cell-host.js";
import { compileDatabaseProfile } from "../packages/core/src/database-policy.js";
import {
  hostQualification,
  ServerPostgresTransport,
} from "../packages/core/src/database-server-transport.js";
import { ServerPgBackRestTransport } from "../packages/core/src/recovery-server-transport.js";
import { fixtureProfile } from "./pg-helpers.js";

const HEALTHY_PROBE = [
  "FILESYSTEM=xfs",
  "PRJQUOTA=on",
  "UNIT=ok",
  "CERTIFICATE_HELPER=ok",
  "POSTGRES=postgres (PostgreSQL) 18.7 (Debian 18.7-1.pgdg13+2)",
  "PGBACKREST=pgBackRest 2.60.0",
  "",
].join("\n");

class FakeHost implements CellHostExecutor {
  readonly calls: { verb: HelperVerb; args: string[] }[] = [];
  readonly files = new Map<string, string>();
  probe = HEALTHY_PROBE;
  controlData = "Database system identifier:           7400000000000001\n";
  unitState = "active\n";
  storage = "";
  async call(verb: HelperVerb, args: readonly string[], options?: { stdin?: string }) {
    this.calls.push({ verb, args: [...args] });
    const [allocation = "", kind = ""] = args;
    if (verb === "file-write") this.files.set(`${allocation}/${kind}`, options?.stdin ?? "");
    if (verb === "file-read") {
      const content = this.files.get(`${allocation}/${kind}`);
      if (content === undefined) throw new HelperError("missing", HELPER_NOT_FOUND);
      return content;
    }
    if (verb === "cells-list")
      return [...this.files.keys()]
        .filter((key) => key.endsWith("/cell-env"))
        .map((key) => key.split("/")[0])
        .join("\n");
    if (verb === "host-probe") return this.probe;
    if (verb === "pg-controldata") return this.controlData;
    if (verb === "storage-inspect") return this.storage;
    if (verb === "unit" && kind === "state") return this.unitState;
    return "";
  }
  verbs() {
    return this.calls.map((c) => c.verb);
  }
  file(allocation: string, kind: string) {
    return this.files.get(`${allocation}/${kind}`) ?? "";
  }
}
const hostConfig = parseCellHost({
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
const gib = (n: number) => n * 1024 ** 3;

describe("ServerPostgresTransport", () => {
  it("requests hard-limited data and WAL storage plus the local repository limit", async () => {
    const host = new FakeHost();
    const { scope, profile } = scopeFor();

    await transport(host).create(scope, profile);

    expect(host.calls.find((c) => c.verb === "storage-create")?.args).toEqual([
      scope.allocationId,
      String(profile.storage.dataQuotaGiB),
      String(profile.storage.walQuotaGiB),
      "16",
    ]);
  });
  it("initialises the cluster only after storage and configuration exist", async () => {
    const host = new FakeHost();
    const { scope, profile } = scopeFor();

    await transport(host).create(scope, profile);

    const verbs = host.verbs();
    expect(verbs.indexOf("storage-create")).toBeLessThan(verbs.indexOf("file-write"));
    expect(verbs.indexOf("file-write")).toBeLessThan(verbs.indexOf("initdb"));
  });
  it("creates the backup stanza offline right after initdb so archiving works from the first start", async () => {
    const host = new FakeHost();
    const { scope, profile } = scopeFor();

    await transport(host).create(scope, profile);

    const last = host.calls.at(-1);
    expect(last?.verb).toBe("pgbackrest");
    expect(last?.args.slice(-2)).toEqual(["--no-online", "stanza-create"]);
  });
  it("binds the listener to the private bridge address", async () => {
    const host = new FakeHost();
    const { scope, profile } = scopeFor();

    await transport(host).create(scope, profile);

    const conf = host.file(scope.allocationId, "config");
    expect(conf).toContain("listen_addresses = '10.77.0.1'");
    expect(conf).toContain("archive_mode = 'on'");
  });
  it("renders HBA with TLS-only host rules and no trust", async () => {
    const host = new FakeHost();
    const { scope, profile } = scopeFor();

    await transport(host).create(scope, profile);

    const hba = host.file(scope.allocationId, "hba");
    expect(hba).toContain("hostssl");
    expect(hba).not.toMatch(/\btrust\b/);
  });
  it("keeps the archive cipher in the root-only environment file and out of other files", async () => {
    const host = new FakeHost();
    const { scope, profile } = scopeFor();

    await transport(host).create(scope, profile);

    const leaked = [...host.files]
      .filter(([key]) => !key.endsWith("/archive-env"))
      .some(([, content]) => content.includes("c".repeat(43)));
    expect(leaked).toBe(false);
  });
  it("assigns distinct ports to successive cells", async () => {
    const host = new FakeHost();
    const first = scopeFor();
    const second = scopeFor();

    await transport(host).create(first.scope, first.profile);
    await transport(host).create(second.scope, second.profile);

    const port = (id: string) => host.file(id, "cell-env").match(/PORT=(\d+)/)?.[1];
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
  it("reports quota and ownership from XFS project quotas rather than from names", async () => {
    const host = new FakeHost();
    const { scope, profile } = scopeFor();
    const t = transport(host);
    await t.create(scope, profile);
    const base = `/srv/godseye/pg/${scope.allocationId}`;
    host.storage = [
      `${profile.dataVolume}\t${base}/data\t${gib(profile.storage.dataQuotaGiB)}\t4096`,
      `${profile.walVolume}\t${base}/wal\t${gib(profile.storage.walQuotaGiB)}\t4096`,
      "",
    ].join("\n");

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
  it("reports an unenforced quota when the project limit is zero", async () => {
    const host = new FakeHost();
    const { scope, profile } = scopeFor();
    const t = transport(host);
    await t.create(scope, profile);
    host.unitState = "inactive\n";
    const base = `/srv/godseye/pg/${scope.allocationId}`;
    host.storage = `${profile.dataVolume}\t${base}/data\t0\t0\n${profile.walVolume}\t${base}/wal\t0\t0\n`;

    const inspection = await t.inspect(scope, null);

    expect(inspection?.quotaEnforced).toBe(false);
  });
  it("does not claim ownership of a volume mounted somewhere unexpected", async () => {
    const host = new FakeHost();
    const { scope, profile } = scopeFor();
    const t = transport(host);
    await t.create(scope, profile);
    host.storage = `${profile.dataVolume}\t/elsewhere/data\t${gib(profile.storage.dataQuotaGiB)}\t0\n${profile.walVolume}\t/elsewhere/wal\t${gib(profile.storage.walQuotaGiB)}\t0\n`;

    const inspection = await t.inspect(scope, null);

    expect(inspection?.independentInstance).toBe(false);
  });
  it("enables weekly, daily and archive-check timers only after PostgreSQL is ready", async () => {
    const host = new FakeHost();
    const { scope, profile } = scopeFor();
    const t = transport(host);
    await t.create(scope, profile);
    host.calls.length = 0;

    await t.start(scope, null);

    expect(host.verbs().slice(-2)).toEqual(["pg-isready", "timers"]);
    expect(host.calls.at(-1)?.args).toEqual([scope.allocationId, "enable"]);
  });
  it("returns null for an unknown allocation", async () => {
    await expect(transport(new FakeHost()).inspect(scopeFor().scope, null)).resolves.toBeNull();
  });
  it("disables the timers before stopping the allocation's own systemd instance", async () => {
    const host = new FakeHost();
    const { scope } = scopeFor();

    await transport(host).stop(scope, `godseye-pg@${scope.allocationId}.service`);

    expect(host.calls.map((c) => `${c.verb}:${c.args[1]}`)).toEqual([
      "timers:disable",
      "unit:stop",
      "unit:disable",
    ]);
  });
  it("refuses to stop a different unit", async () => {
    const { scope } = scopeFor();

    await expect(transport(new FakeHost()).stop(scope, "godseye-pg@other.service")).rejects.toThrow(
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
  it("withholds attestation when project quotas are not enabled on the volume", async () => {
    const host = new FakeHost();
    host.probe = HEALTHY_PROBE.replace("PRJQUOTA=on", "PRJQUOTA=off");

    await expect(hostQualification(hostConfig, host, binding)()).resolves.toBeNull();
  });
  it("withholds attestation when the volume is not XFS", async () => {
    const host = new FakeHost();
    host.probe = HEALTHY_PROBE.replace("FILESYSTEM=xfs", "FILESYSTEM=ext4");

    await expect(hostQualification(hostConfig, host, binding)()).resolves.toBeNull();
  });
  it("withholds attestation for an older pgBackRest", async () => {
    const host = new FakeHost();
    host.probe = HEALTHY_PROBE.replace("2.60.0", "2.55.1");

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
  it("points the stanza at the off-host S3 repository under a per-cell path", async () => {
    const s3Host = parseCellHost({
      mountRoot: "/srv/godseye/pg",
      bindAddress: "10.77.0.1",
      servername: "pg.cells.internal",
      portRange: [15432, 15434],
      repositoryQuotaGiB: 0,
      s3Repository: {
        bucket: "example-backups",
        endpoint: "s3.example.test",
        region: "eu-central-003",
        pathPrefix: "/cells",
      },
    });
    const host = new FakeHost();
    const { scope, profile } = scopeFor();
    await new ServerPostgresTransport({
      host: s3Host,
      executor: host,
      archiveCipher: async () => "c".repeat(43),
      sleep: async () => {},
    }).create(scope, profile);

    const config = host.file(scope.allocationId, "pgbackrest-conf");

    expect(config).toContain("repo1-type=s3");
    expect(config).toContain(`repo1-path=/cells/${scope.allocationId}`);
    expect(host.calls.find((c) => c.verb === "storage-create")?.args.at(-1)).toBe("0");
  });
});
