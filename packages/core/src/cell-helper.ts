import {
  type CellFileKind,
  type CellHost,
  type CellLayout,
  cellLayout,
  HELPER_NOT_FOUND,
  HELPER_VERBS,
  HelperError,
  type HelperVerb,
  parseEnv,
} from "./cell-host.js";

/**
 * Root-side implementation of the cell host verbs (the only privileged code of the cell design).
 * Every verb uses fixed binaries and paths derived from the root-owned host configuration plus a
 * validated allocation UUID. There is no shell, no generic command and no caller-chosen path.
 */
export interface HelperSystem {
  run(
    argv: readonly string[],
    options?: { user?: string; env?: Readonly<Record<string, string>>; stdin?: string },
  ): Promise<{ code: number; stdout: string }>;
  read(path: string): Promise<string | null>;
  write(
    path: string,
    content: string,
    options: { mode: number; owner: string; group: string },
  ): Promise<void>;
  list(path: string): Promise<string[]>;
  /** Recursive removal of a path below an already validated root. */
  remove(path: string): Promise<void>;
  /** Serializes verbs that allocate storage identities. */
  exclusive<T>(work: () => Promise<T>): Promise<T>;
}

const EXIT = { usage: 64, unavailable: 69, config: 70, exists: 73, busy: 75 } as const;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const MAX_PAYLOAD = 1024 * 1024;
const PROJECT_ID_BASE = 41000;
const PROJID = "/etc/projid";
const PROJECTS = "/etc/projects";
const STATUS_DIRECTORY = "/var/lib/godseye/pg-backup";
const XFS_QUOTA = "/usr/sbin/xfs_quota";
const SYSTEMCTL = "/usr/bin/systemctl";
const FIND_MOUNT = "/usr/bin/findmnt";
const HELPER_UNITS = ["full", "diff", "check"] as const;

interface FileSpec {
  path: (layout: CellLayout, host: CellHost) => string;
  mode: number;
  owner: (host: CellHost) => string;
  group: (host: CellHost) => string;
  read: boolean;
  write: boolean;
  /** Refuse to replace identity material that the running cell already depends on. */
  once?: boolean;
  /** The parent directory must already exist (storage directories); otherwise it is created. */
  parentExists?: boolean;
}
const root = () => "root";
const FILES: Record<CellFileKind, FileSpec> = {
  "cell-env": {
    path: (l) => l.envFile,
    mode: 0o644,
    owner: root,
    group: root,
    read: true,
    write: true,
  },
  config: {
    path: (l) => l.configFile,
    mode: 0o640,
    owner: root,
    group: (h) => h.serviceUser,
    read: true,
    write: true,
  },
  hba: {
    path: (l) => l.hbaFile,
    mode: 0o640,
    owner: root,
    group: (h) => h.serviceUser,
    read: true,
    write: true,
  },
  ident: {
    path: (l) => l.identFile,
    mode: 0o640,
    owner: root,
    group: (h) => h.serviceUser,
    read: true,
    write: true,
  },
  "pgbackrest-conf": {
    path: (l) => l.pgBackRestConfig,
    mode: 0o640,
    owner: root,
    group: (h) => h.serviceUser,
    read: true,
    write: true,
  },
  "archive-env": {
    path: (l) => l.archiveEnvFile,
    mode: 0o600,
    owner: root,
    group: root,
    read: false,
    write: true,
    once: true,
  },
  "admin-pass": {
    path: (l) => l.adminPasswordFile,
    mode: 0o440,
    owner: (h) => h.controlUser,
    group: (h) => h.serviceUser,
    read: true,
    write: true,
    once: true,
  },
  "auto-conf": {
    path: (l) => `${l.dataPath}/postgresql.auto.conf`,
    mode: 0o600,
    owner: (h) => h.serviceUser,
    group: (h) => h.serviceUser,
    read: false,
    write: true,
    parentExists: true,
  },
  "recovery-signal": {
    path: (l) => `${l.dataPath}/recovery.signal`,
    mode: 0o600,
    owner: (h) => h.serviceUser,
    group: (h) => h.serviceUser,
    read: false,
    write: true,
    parentExists: true,
  },
  "backup-status": {
    path: (l) => `${STATUS_DIRECTORY}/${l.allocationId}.json`,
    mode: 0o640,
    owner: (h) => h.serviceUser,
    group: (h) => h.controlUser,
    read: true,
    write: false,
  },
};
const PGBACKREST_COMMANDS = new Set(["backup", "check", "info", "restore", "stanza-create"]);
const PGBACKREST_FLAGS = new Set([
  "--repo=1",
  "--no-online",
  "--log-level-console=off",
  "--log-level-file=off",
  "--no-expire-auto",
  "--output=json",
  "--type=full",
  "--type=diff",
  "--type=time",
  "--target-action=pause",
  "--archive-mode=off",
]);
function fail(code: number, message: string): never {
  throw new HelperError(message, code);
}
const allocation = (value: string | undefined) =>
  value !== undefined && UUID.test(value) ? value : fail(EXIT.usage, "invalid allocation");
const gib = (value: string | undefined, min: number) => {
  const parsed = Number(value);
  return /^\d{1,4}$/.test(value ?? "") && parsed >= min && parsed <= 4096
    ? parsed
    : fail(EXIT.usage, "invalid size");
};
const entries = (text: string | null) =>
  (text ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"));

export class CellHelper {
  private readonly handlers: Record<
    HelperVerb,
    (args: readonly string[], stdin: string) => Promise<string>
  > = {
    "host-probe": () => this.host_probe(),
    "cells-list": () => this.cells_list(),
    "file-read": (a) => this.file_read(a),
    "file-write": (a, i) => this.file_write(a, i),
    "storage-create": (a) => this.storage_create(a),
    "storage-resize": (a) => this.storage_resize(a),
    "storage-inspect": (a) => this.storage_inspect(a),
    "storage-empty": (a) => this.storage_empty(a),
    "cell-dirs": (a) => this.cell_dirs(a),
    cert: (a) => this.cert(a),
    initdb: (a) => this.initdb(a),
    unit: (a) => this.unit(a),
    timers: (a) => this.timers(a),
    "pg-isready": (a) => this.pg_isready(a),
    "pg-controldata": (a) => this.pg_controldata(a),
    pgbackrest: (a) => this.pgbackrest(a),
    destroy: (a) => this.destroy(a),
  };
  constructor(
    private readonly host: CellHost,
    private readonly system: HelperSystem,
  ) {}
  async execute(verb: string, args: readonly string[], stdin = ""): Promise<string> {
    if (!(HELPER_VERBS as readonly string[]).includes(verb)) fail(EXIT.usage, "unknown verb");
    if (args.length > 64 || args.some((a) => a.length > 4096 || a.includes("\0")))
      fail(EXIT.usage, "invalid arguments");
    if (stdin.length > MAX_PAYLOAD || stdin.includes("\0")) fail(EXIT.usage, "invalid payload");
    return this.handlers[verb as HelperVerb](args, stdin);
  }
  // ---------------------------------------------------------------- helpers
  private layout(value: string | undefined) {
    return cellLayout(this.host, allocation(value));
  }
  private async need(argv: readonly string[], options?: Parameters<HelperSystem["run"]>[1]) {
    const result = await this.system.run(argv, options);
    if (result.code !== 0) fail(1, "host command failed");
    return result.stdout;
  }
  private async mountReport() {
    const result = await this.system.run([
      FIND_MOUNT,
      "-n",
      "-o",
      "FSTYPE,OPTIONS",
      "--mountpoint",
      this.host.mountRoot,
    ]);
    const [fstype = "", options = ""] = result.stdout.trim().split(/\s+/);
    const quota = result.code === 0 && /(^|,)(prjquota|pquota)(,|$)/.test(options);
    return { fstype: result.code === 0 ? fstype : "", quota };
  }
  private async assertQuotaMount() {
    const mount = await this.mountReport();
    if (mount.fstype !== "xfs" || !mount.quota)
      fail(EXIT.config, "cell storage is not an XFS mount with project quotas");
  }
  private projectNames(layout: CellLayout) {
    return {
      data: `pgdata-${layout.suffix}`,
      wal: `pgwal-${layout.suffix}`,
      repo: `pgrepo-${layout.suffix}`,
    } as const;
  }
  private async registry() {
    const [projid, projects] = await Promise.all([
      this.system.read(PROJID),
      this.system.read(PROJECTS),
    ]);
    const ids = new Map<string, number>();
    for (const line of entries(projid)) {
      const [name = "", id = ""] = line.split(":");
      if (/^\d+$/.test(id)) ids.set(name, Number(id));
    }
    const paths = new Map<number, string>();
    for (const line of entries(projects)) {
      const [id = "", path = ""] = line.split(":");
      if (/^\d+$/.test(id)) paths.set(Number(id), path);
    }
    return { projid: projid ?? "", projects: projects ?? "", ids, paths };
  }
  private async quota(command: string) {
    return this.need([XFS_QUOTA, "-x", "-c", command, this.host.mountRoot]);
  }
  private async cellExists(layout: CellLayout) {
    return (await this.system.read(layout.envFile)) !== null;
  }
  // ------------------------------------------------------------------ verbs
  async host_probe() {
    const mount = await this.mountReport();
    const ok = async (argv: string[]) =>
      (await this.system.run(argv)).code === 0 ? "ok" : "missing";
    const line = async (argv: string[]) => {
      const result = await this.system.run(argv);
      return result.code === 0 ? (result.stdout.trim().split("\n")[0] ?? "") : "unavailable";
    };
    return `${[
      `FILESYSTEM=${mount.fstype || "none"}`,
      `PRJQUOTA=${mount.quota ? "on" : "off"}`,
      `UNIT=${await ok([SYSTEMCTL, "cat", "godseye-pg@.service"])}`,
      `CERTIFICATE_HELPER=${await ok(["/usr/bin/test", "-x", this.host.certificateHelper])}`,
      `POSTGRES=${await line([`${this.host.postgresBinDirectory}/postgres`, "--version"])}`,
      `PGBACKREST=${await line([this.host.pgBackRestExecutable, "version"])}`,
    ].join("\n")}\n`;
  }
  async cells_list() {
    const found: string[] = [];
    for (const name of await this.system.list(this.host.configRoot))
      if (
        UUID.test(name) &&
        (await this.system.read(`${this.host.configRoot}/${name}/cell.env`)) !== null
      )
        found.push(name);
    return `${found.sort().join("\n")}\n`;
  }
  private spec(kind: string | undefined) {
    const spec = FILES[kind as CellFileKind];
    return spec ?? fail(EXIT.usage, "invalid file kind");
  }
  async file_read(args: readonly string[]) {
    const layout = this.layout(args[0]);
    const spec = this.spec(args[1]);
    if (!spec.read) fail(EXIT.usage, "file kind is not readable");
    return (
      (await this.system.read(spec.path(layout, this.host))) ?? fail(HELPER_NOT_FOUND, "missing")
    );
  }
  async file_write(args: readonly string[], stdin: string) {
    const layout = this.layout(args[0]);
    const spec = this.spec(args[1]);
    if (!spec.write) fail(EXIT.usage, "file kind is not writable");
    const path = spec.path(layout, this.host);
    if (spec.once && (await this.system.read(path)) !== null)
      fail(EXIT.exists, "file already exists");
    if (spec.parentExists) {
      if (!(await this.dataExists(layout))) fail(EXIT.config, "cell data directory is missing");
    } else {
      await this.need([
        "/usr/bin/install",
        "-d",
        "-m",
        "0750",
        "-o",
        "root",
        "-g",
        this.host.serviceUser,
        layout.configDirectory,
      ]);
    }
    await this.system.write(path, stdin, {
      mode: spec.mode,
      owner: spec.owner(this.host),
      group: spec.group(this.host),
    });
    return "";
  }
  private async dataExists(layout: CellLayout) {
    return (await this.system.run(["/usr/bin/test", "-d", layout.dataPath])).code === 0;
  }
  async storage_create(args: readonly string[]) {
    const layout = this.layout(args[0]);
    const sizes = { data: gib(args[1], 1), wal: gib(args[2], 1), repo: gib(args[3], 0) };
    await this.assertQuotaMount();
    return this.system.exclusive(async () => {
      const names = this.projectNames(layout);
      const registry = await this.registry();
      if (Object.values(names).some((n) => registry.ids.has(n)))
        fail(EXIT.exists, "storage already exists");
      const base = `${this.host.mountRoot}/${layout.allocationId}`;
      const volumes = (
        ["data", "wal", ...(sizes.repo > 0 ? (["repo"] as const) : [])] as const
      ).map((kind, index) => ({
        kind,
        name: names[kind],
        dir: `${base}/${kind}`,
        id: Math.max(PROJECT_ID_BASE, ...registry.ids.values()) + 1 + index,
      }));
      try {
        await this.need([
          "/usr/bin/install",
          "-d",
          "-m",
          "0750",
          "-o",
          "root",
          "-g",
          this.host.serviceUser,
          base,
        ]);
        for (const volume of volumes)
          await this.need([
            "/usr/bin/install",
            "-d",
            "-m",
            "0700",
            "-o",
            this.host.serviceUser,
            "-g",
            this.host.serviceUser,
            volume.dir,
          ]);
        const idLines = volumes.map((v) => `${v.name}:${v.id}\n`).join("");
        const pathLines = volumes.map((v) => `${v.id}:${v.dir}\n`).join("");
        await this.system.write(PROJID, registry.projid + idLines, {
          mode: 0o644,
          owner: "root",
          group: "root",
        });
        await this.system.write(PROJECTS, registry.projects + pathLines, {
          mode: 0o644,
          owner: "root",
          group: "root",
        });
        for (const volume of volumes) {
          await this.quota(`project -s ${volume.name}`);
          await this.quota(
            `limit -p bhard=${sizes[volume.kind]}g bsoft=${sizes[volume.kind]}g ${volume.name}`,
          );
        }
      } catch (error) {
        await this.system.write(PROJID, registry.projid, {
          mode: 0o644,
          owner: "root",
          group: "root",
        });
        await this.system.write(PROJECTS, registry.projects, {
          mode: 0o644,
          owner: "root",
          group: "root",
        });
        await this.system.remove(base);
        throw error;
      }
      return "";
    });
  }
  async storage_resize(args: readonly string[]) {
    const layout = this.layout(args[0]);
    if (args[1] !== "repo") fail(EXIT.usage, "only the repository limit can be resized");
    const size = gib(args[2], 1);
    await this.assertQuotaMount();
    const name = this.projectNames(layout).repo;
    if (!(await this.registry()).ids.has(name)) fail(HELPER_NOT_FOUND, "missing");
    await this.quota(`limit -p bhard=${size}g bsoft=${size}g ${name}`);
    return "";
  }
  async storage_inspect(args: readonly string[]) {
    const layout = this.layout(args[0]);
    await this.assertQuotaMount();
    const registry = await this.registry();
    const names = Object.values(this.projectNames(layout)).filter((n) => registry.ids.has(n));
    if (!names.length) fail(HELPER_NOT_FOUND, "missing");
    const report = new Map<string, { used: number; hard: number }>();
    for (const line of (await this.quota("report -p -b -N")).split("\n")) {
      const [name = "", used = "", , hard = ""] = line.trim().split(/\s+/);
      if (/^\d+$/.test(used) && /^\d+$/.test(hard))
        report.set(name, { used: Number(used), hard: Number(hard) });
    }
    return names
      .map((name) => {
        const id = registry.ids.get(name) ?? 0;
        const entry = report.get(name) ?? report.get(`#${id}`) ?? { used: 0, hard: 0 };
        return `${name}\t${registry.paths.get(id) ?? ""}\t${entry.hard * 1024}\t${entry.used * 1024}\n`;
      })
      .join("");
  }
  async storage_empty(args: readonly string[]) {
    const layout = this.layout(args[0]);
    for (const dir of [layout.dataPath, layout.walPath])
      if ((await this.system.list(dir)).length) fail(1, "not empty");
    return "empty\n";
  }
  async cell_dirs(args: readonly string[]) {
    const layout = this.layout(args[0]);
    const user = this.host.serviceUser;
    await this.need([
      "/usr/bin/install",
      "-d",
      "-m",
      "0750",
      "-o",
      "root",
      "-g",
      user,
      layout.configDirectory,
    ]);
    for (const dir of [layout.pgBackRestInclude, layout.pgBackRestLog])
      await this.need(["/usr/bin/install", "-d", "-m", "0750", "-o", user, "-g", user, dir]);
    // pgBackRest lock path and PostgreSQL socket directory; the unit's RuntimeDirectory= adopts it.
    // Needed before the first start because the stanza is created offline at provisioning.
    await this.need([
      "/usr/bin/install",
      "-d",
      "-m",
      "0751",
      "-o",
      user,
      "-g",
      user,
      layout.socketDirectory,
    ]);
    return "";
  }
  async cert(args: readonly string[]) {
    const layout = this.layout(args[0]);
    const servername = args[1] ?? "";
    if (!/^[a-z0-9.-]+$/.test(servername) || servername !== this.host.servername)
      fail(EXIT.usage, "invalid servername");
    await this.need([
      this.host.certificateHelper,
      layout.allocationId,
      servername,
      layout.tlsDirectory,
    ]);
    return "";
  }
  async initdb(args: readonly string[]) {
    const layout = this.layout(args[0]);
    if (!(await this.cellExists(layout))) fail(HELPER_NOT_FOUND, "missing");
    if ((await this.system.read(`${layout.dataPath}/PG_VERSION`)) !== null)
      fail(EXIT.exists, "cluster already initialised");
    await this.need(
      [
        `${this.host.postgresBinDirectory}/initdb`,
        "-D",
        layout.dataPath,
        "-X",
        layout.walPath,
        "-U",
        layout.bootstrapRole,
        `--pwfile=${layout.adminPasswordFile}`,
        "--auth-local=scram-sha-256",
        "--auth-host=reject",
        "--data-checksums",
        "--encoding=UTF8",
        "--locale=C.UTF-8",
      ],
      { user: this.host.serviceUser },
    );
    return "";
  }
  async unit(args: readonly string[]) {
    const layout = this.layout(args[0]);
    const action = args[1];
    if (!(await this.cellExists(layout))) fail(HELPER_NOT_FOUND, "missing");
    if (action === "state") {
      const result = await this.system.run([
        SYSTEMCTL,
        "show",
        "--property=ActiveState",
        "--value",
        layout.unit,
      ]);
      return result.stdout;
    }
    if (!["enable", "start", "stop", "disable"].includes(action ?? ""))
      fail(EXIT.usage, "invalid action");
    await this.need([SYSTEMCTL, action ?? "", layout.unit]);
    return "";
  }
  async timers(args: readonly string[]) {
    const layout = this.layout(args[0]);
    const action = args[1];
    if (action !== "enable" && action !== "disable") fail(EXIT.usage, "invalid action");
    if (!(await this.cellExists(layout))) fail(HELPER_NOT_FOUND, "missing");
    for (const kind of HELPER_UNITS)
      await this.need([
        SYSTEMCTL,
        action,
        "--now",
        `godseye-pg-backup-${kind}@${layout.allocationId}.timer`,
      ]);
    return "";
  }
  private async port(layout: CellLayout) {
    const port = parseEnv(await this.system.read(layout.envFile)).PORT;
    return /^\d{4,5}$/.test(port ?? "") ? (port as string) : fail(HELPER_NOT_FOUND, "missing");
  }
  async pg_isready(args: readonly string[]) {
    const layout = this.layout(args[0]);
    await this.need(
      [
        `${this.host.postgresBinDirectory}/pg_isready`,
        "-h",
        layout.socketDirectory,
        "-p",
        await this.port(layout),
        "-q",
      ],
      { user: this.host.serviceUser },
    );
    return "";
  }
  async pg_controldata(args: readonly string[]) {
    const layout = this.layout(args[0]);
    return this.need([`${this.host.postgresBinDirectory}/pg_controldata`, layout.dataPath], {
      user: this.host.serviceUser,
    });
  }
  /** Validates every pgBackRest argument against the exact shapes the recovery policy emits. */
  private pgBackRestArguments(layout: CellLayout, args: readonly string[]) {
    const mount = this.host.mountRoot.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const destination = (kind: "data" | "wal", path: string) => {
      const found = new RegExp(`^${mount}/([0-9a-f-]{36})/${kind}$`).exec(path);
      return found !== null && UUID.test(found[1] ?? "");
    };
    const command = args.at(-1) ?? "";
    if (!PGBACKREST_COMMANDS.has(command)) fail(EXIT.usage, "unsupported pgBackRest command");
    for (const arg of args.slice(0, -1)) {
      const [name = "", ...rest] = arg.split("=");
      const value = rest.join("=");
      const valid =
        PGBACKREST_FLAGS.has(arg) ||
        arg === `--config=${layout.pgBackRestConfig}` ||
        arg === `--config-include-path=${layout.pgBackRestInclude}` ||
        arg === `--stanza=g_${layout.suffix}` ||
        (name === "--pg1-path" && destination("data", value)) ||
        (name === "--link-map" &&
          value.startsWith("pg_wal=") &&
          destination("wal", value.slice(7))) ||
        (name === "--set" && /^\d{8}-\d{6}F(?:_\d{8}-\d{6}[DI])?$/.test(value)) ||
        (name === "--target" &&
          /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d+)?\+00$/.test(value)) ||
        (name === "--target-timeline" && /^\d{1,10}$/.test(value));
      if (!valid) fail(EXIT.usage, "unsupported pgBackRest argument");
    }
    return args;
  }
  async pgbackrest(args: readonly string[]) {
    const layout = this.layout(args[0]);
    const validated = this.pgBackRestArguments(layout, args.slice(1));
    const env: Record<string, string> = { PATH: "/usr/bin:/bin", LANG: "C.UTF-8" };
    const sources = [`${this.host.configRoot}/b2.env`, layout.archiveEnvFile];
    for (const source of sources)
      for (const [key, value] of Object.entries(parseEnv(await this.system.read(source))))
        if (/^PGBACKREST_REPO1_(CIPHER_PASS|S3_KEY|S3_KEY_SECRET)$/.test(key)) env[key] = value;
    const password = (await this.system.read(layout.adminPasswordFile))?.trim();
    if (password) env.PGPASSWORD = password;
    return this.need([this.host.pgBackRestExecutable, ...validated], {
      user: this.host.serviceUser,
      env,
    });
  }
  async destroy(args: readonly string[]) {
    const layout = this.layout(args[0]);
    const state = (
      await this.system.run([SYSTEMCTL, "show", "--property=ActiveState", "--value", layout.unit])
    ).stdout.trim();
    if (state === "active" || state === "activating" || state === "deactivating")
      fail(EXIT.busy, "cell is running");
    await this.system.run([SYSTEMCTL, "disable", layout.unit]);
    for (const kind of HELPER_UNITS)
      await this.system.run([
        SYSTEMCTL,
        "disable",
        "--now",
        `godseye-pg-backup-${kind}@${layout.allocationId}.timer`,
      ]);
    await this.system.exclusive(async () => {
      const registry = await this.registry();
      const names = Object.values(this.projectNames(layout));
      const owned = new Set(names.map((n) => registry.ids.get(n)).filter((n) => n !== undefined));
      for (const name of names)
        if (registry.ids.has(name))
          await this.system.run([
            XFS_QUOTA,
            "-x",
            "-c",
            `limit -p bsoft=0 bhard=0 ${name}`,
            this.host.mountRoot,
          ]);
      await this.system.remove(`${this.host.mountRoot}/${layout.allocationId}`);
      const keep = (line: string, test: (parts: string[]) => boolean) => !test(line.split(":"));
      await this.system.write(
        PROJID,
        registry.projid
          .split("\n")
          .filter((l) => keep(l, ([n = ""]) => (names as string[]).includes(n)))
          .join("\n"),
        { mode: 0o644, owner: "root", group: "root" },
      );
      await this.system.write(
        PROJECTS,
        registry.projects
          .split("\n")
          .filter((l) => keep(l, ([i = ""]) => owned.has(Number(i))))
          .join("\n"),
        { mode: 0o644, owner: "root", group: "root" },
      );
    });
    await this.system.remove(layout.configDirectory);
    await this.system.remove(`${STATUS_DIRECTORY}/${layout.allocationId}.json`);
    return "";
  }
}
