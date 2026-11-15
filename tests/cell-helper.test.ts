import { describe, expect, it } from "vitest";
import { CellHelper, type HelperSystem } from "../packages/core/src/cell-helper.js";
import { HELPER_NOT_FOUND, HelperError, parseCellHost } from "../packages/core/src/cell-host.js";

const ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OTHER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const SUFFIX = ID.replaceAll("-", "");
const host = parseCellHost({
  mountRoot: "/srv/godseye/pg",
  bindAddress: "10.77.0.1",
  servername: "pg.cells.internal",
  portRange: [15432, 15440],
});

class FakeSystem implements HelperSystem {
  readonly commands: { argv: string[]; user?: string; env?: Record<string, string> }[] = [];
  readonly files = new Map<string, string>();
  readonly removed: string[] = [];
  mount = "xfs rw,noatime,prjquota";
  unitState = "inactive\n";
  report = "";
  async run(
    argv: readonly string[],
    options?: { user?: string; env?: Readonly<Record<string, string>> },
  ) {
    this.commands.push({
      argv: [...argv],
      ...(options?.user ? { user: options.user } : {}),
      ...(options?.env ? { env: { ...options.env } } : {}),
    });
    if (argv[0]?.endsWith("findmnt"))
      return { code: this.mount ? 0 : 1, stdout: `${this.mount}\n` };
    if (argv[3]?.startsWith("report")) return { code: 0, stdout: this.report };
    if (argv.includes("show")) return { code: 0, stdout: this.unitState };
    if (argv.at(-1) === "--version") return { code: 0, stdout: "postgres (PostgreSQL) 18.7\n" };
    if (argv.at(-1) === "version") return { code: 0, stdout: "pgBackRest 2.60.0\n" };
    return { code: 0, stdout: "" };
  }
  async read(path: string) {
    return this.files.get(path) ?? null;
  }
  async write(path: string, content: string) {
    this.files.set(path, content);
  }
  async list(path: string) {
    const prefix = `${path}/`;
    return [
      ...new Set(
        [...this.files.keys()]
          .filter((key) => key.startsWith(prefix))
          .map((key) => key.slice(prefix.length).split("/")[0] ?? ""),
      ),
    ];
  }
  async remove(path: string) {
    this.removed.push(path);
  }
  async exclusive<T>(work: () => Promise<T>) {
    return work();
  }
  quotaCommands() {
    return this.commands
      .filter((c) => c.argv[0]?.endsWith("xfs_quota"))
      .map((c) => c.argv[3] ?? "");
  }
}
const run = (system: FakeSystem, verb: string, args: string[], stdin = "") =>
  new CellHelper(host, system).execute(verb, args, stdin);
const code = async (work: Promise<unknown>) =>
  work.then(
    () => 0,
    (error: unknown) => (error instanceof HelperError ? error.code : -1),
  );

describe("CellHelper input validation", () => {
  it("rejects a verb outside the fixed set", async () => {
    await expect(code(run(new FakeSystem(), "shell", [ID]))).resolves.toBe(64);
  });
  it("rejects an allocation that is not a lowercase UUID", async () => {
    await expect(code(run(new FakeSystem(), "unit", ["../../etc", "start"]))).resolves.toBe(64);
  });
  it("rejects arguments containing a NUL byte", async () => {
    await expect(code(run(new FakeSystem(), "unit", [ID, "start\0"]))).resolves.toBe(64);
  });
  it("does not allow reading the cipher environment file", async () => {
    await expect(code(run(new FakeSystem(), "file-read", [ID, "archive-env"]))).resolves.toBe(64);
  });
  it("does not allow writing the backup status record", async () => {
    await expect(
      code(run(new FakeSystem(), "file-write", [ID, "backup-status"], "{}")),
    ).resolves.toBe(64);
  });
});

describe("CellHelper files", () => {
  it("reports a missing file with the not-found code", async () => {
    await expect(code(run(new FakeSystem(), "file-read", [ID, "cell-env"]))).resolves.toBe(
      HELPER_NOT_FOUND,
    );
  });
  it("refuses to replace identity material the cell already uses", async () => {
    const system = new FakeSystem();
    await run(system, "file-write", [ID, "admin-pass"], "first\n");

    await expect(code(run(system, "file-write", [ID, "admin-pass"], "second\n"))).resolves.toBe(73);
  });
  it("lists only provisioned cells", async () => {
    const system = new FakeSystem();
    system.files.set(`/etc/godseye/pg/${ID}/cell.env`, "PORT=15432\n");
    system.files.set(`/etc/godseye/pg/${OTHER}/postgresql.conf`, "x");
    system.files.set("/etc/godseye/pg/host.json", "{}");

    expect((await run(system, "cells-list", [])).trim()).toBe(ID);
  });
});

describe("CellHelper storage", () => {
  it("refuses to create storage unless the volume is XFS with project quotas", async () => {
    const system = new FakeSystem();
    system.mount = "ext4 rw,relatime";

    await expect(code(run(system, "storage-create", [ID, "3", "1", "0"]))).resolves.toBe(70);
  });
  it("sets one hard limit per volume sized from the request", async () => {
    const system = new FakeSystem();

    await run(system, "storage-create", [ID, "3", "1", "16"]);

    expect(system.quotaCommands().filter((c) => c.startsWith("limit"))).toEqual([
      `limit -p bhard=3g bsoft=3g pgdata-${SUFFIX}`,
      `limit -p bhard=1g bsoft=1g pgwal-${SUFFIX}`,
      `limit -p bhard=16g bsoft=16g pgrepo-${SUFFIX}`,
    ]);
  });
  it("omits the local repository volume when its size is zero", async () => {
    const system = new FakeSystem();

    await run(system, "storage-create", [ID, "3", "1", "0"]);

    expect(system.files.get("/etc/projid")).not.toContain("pgrepo");
  });
  it("assigns distinct project identifiers to successive cells", async () => {
    const system = new FakeSystem();

    await run(system, "storage-create", [ID, "3", "1", "0"]);
    await run(system, "storage-create", [OTHER, "3", "1", "0"]);

    const ids = (system.files.get("/etc/projid") ?? "")
      .split("\n")
      .filter(Boolean)
      .map((line) => line.split(":")[1]);
    expect(new Set(ids).size).toBe(4);
  });
  it("refuses to create the same storage twice", async () => {
    const system = new FakeSystem();
    await run(system, "storage-create", [ID, "3", "1", "0"]);

    await expect(code(run(system, "storage-create", [ID, "3", "1", "0"]))).resolves.toBe(73);
  });
  it("rejects a size outside the accepted range", async () => {
    await expect(code(run(new FakeSystem(), "storage-create", [ID, "0", "1", "0"]))).resolves.toBe(
      64,
    );
  });
  it("reports the enforced hard limit and the mount of each volume", async () => {
    const system = new FakeSystem();
    await run(system, "storage-create", [ID, "3", "1", "0"]);
    system.report = `pgdata-${SUFFIX}  2048  3145728  3145728  00 [--------]\npgwal-${SUFFIX}  16  1048576  1048576  00 [--------]\n`;

    const lines = (await run(system, "storage-inspect", [ID])).trim().split("\n");

    expect(lines[0]).toBe(
      `pgdata-${SUFFIX}\t/srv/godseye/pg/${ID}/data\t${3 * 1024 ** 3}\t${2048 * 1024}`,
    );
  });
});

describe("CellHelper pgBackRest", () => {
  const base = [
    `--config=/etc/godseye/pg/${ID}/pgbackrest.conf`,
    `--config-include-path=/etc/godseye/pg/${ID}/pgbackrest.conf.d`,
    `--stanza=g_${SUFFIX}`,
    "--repo=1",
  ];
  const system = () => {
    const fake = new FakeSystem();
    fake.files.set(
      `/etc/godseye/pg/${ID}/archive.env`,
      `PGBACKREST_REPO1_CIPHER_PASS=${"c".repeat(43)}\n`,
    );
    fake.files.set(
      "/etc/godseye/pg/b2.env",
      "PGBACKREST_REPO1_S3_KEY=k\nPGBACKREST_REPO1_S3_KEY_SECRET=s\nOTHER=x\n",
    );
    fake.files.set(`/etc/godseye/pg/${ID}/admin.pass`, "adminpass\n");
    return fake;
  };
  it("runs an allowed backup as the service user with credentials from root-owned files only", async () => {
    const fake = system();

    await run(fake, "pgbackrest", [ID, ...base, "--type=full", "--no-expire-auto", "backup"]);

    const call = fake.commands.at(-1);
    expect(call?.user).toBe("postgres");
    expect(Object.keys(call?.env ?? {}).sort()).toEqual([
      "LANG",
      "PATH",
      "PGBACKREST_REPO1_CIPHER_PASS",
      "PGBACKREST_REPO1_S3_KEY",
      "PGBACKREST_REPO1_S3_KEY_SECRET",
      "PGPASSWORD",
    ]);
  });
  it("accepts the offline stanza creation used at provisioning", async () => {
    await expect(
      code(run(system(), "pgbackrest", [ID, ...base, "--no-online", "stanza-create"])),
    ).resolves.toBe(0);
  });
  it("keeps secrets out of the executed argument vector", async () => {
    const fake = system();

    await run(fake, "pgbackrest", [ID, ...base, "check"]);

    expect(fake.commands.at(-1)?.argv.join(" ")).not.toContain("c".repeat(43));
  });
  it("rejects an option that could change the command or the repository", async () => {
    const fake = system();

    await expect(
      code(run(fake, "pgbackrest", [ID, ...base, "--repo1-path=/", "check"])),
    ).resolves.toBe(64);
  });
  it("rejects a configuration path that belongs to another cell", async () => {
    const fake = system();
    const foreign = base.map((a) => a.replace(`/pg/${ID}/`, `/pg/${OTHER}/`));

    await expect(code(run(fake, "pgbackrest", [ID, ...foreign, "check"]))).resolves.toBe(64);
  });
  it("rejects a command outside backup, check, info, restore and stanza-create", async () => {
    await expect(code(run(system(), "pgbackrest", [ID, ...base, "expire"]))).resolves.toBe(64);
  });
  it("accepts a restore into another allocation's data and WAL directories", async () => {
    const fake = system();
    const restore = [
      ...base,
      `--pg1-path=/srv/godseye/pg/${OTHER}/data`,
      `--link-map=pg_wal=/srv/godseye/pg/${OTHER}/wal`,
      "--set=20261115-120000F",
      "--type=time",
      "--target=2026-11-15 12:30:00+00",
      "--target-timeline=1",
      "--target-action=pause",
      "--archive-mode=off",
      "restore",
    ];

    await expect(code(run(fake, "pgbackrest", [ID, ...restore]))).resolves.toBe(0);
  });
  it("rejects a restore target outside the cell storage root", async () => {
    const restore = [...base, "--pg1-path=/var/lib/postgresql/17/main", "restore"];

    await expect(code(run(system(), "pgbackrest", [ID, ...restore]))).resolves.toBe(64);
  });
});

describe("CellHelper lifecycle", () => {
  it("refuses to destroy a running cell", async () => {
    const fake = new FakeSystem();
    fake.unitState = "active\n";

    await expect(code(run(fake, "destroy", [ID]))).resolves.toBe(75);
  });
  it("only removes paths derived from the allocation", async () => {
    const fake = new FakeSystem();
    await run(fake, "storage-create", [ID, "3", "1", "0"]);

    await run(fake, "destroy", [ID]);

    expect(fake.removed).toEqual([
      `/srv/godseye/pg/${ID}`,
      `/etc/godseye/pg/${ID}`,
      `/var/lib/godseye/pg-backup/${ID}.json`,
    ]);
  });
  it("probes the host for filesystem, quota mount and tool versions", async () => {
    const probe = await run(new FakeSystem(), "host-probe", []);

    expect(probe).toContain("FILESYSTEM=xfs\nPRJQUOTA=on\n");
  });
});
