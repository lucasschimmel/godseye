import { execFileSync, spawn } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import {
  chmod,
  chown,
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  rmdir,
  writeFile,
} from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import { CellHelper, type HelperSystem } from "../../../packages/core/src/cell-helper.js";
import { HelperError, parseCellHost } from "../../../packages/core/src/cell-host.js";

/**
 * Entry point of the root cell helper. Two modes:
 * - `--serve` (systemd socket activation, one connection per process): one JSON request line on
 *   stdin, one JSON response line on stdout.
 * - `<verb> <args...>` (operator CLI as root): payload for `file-write` is read from stdin.
 * The host configuration is a root-owned file; the helper refuses to run if it is writable by others.
 */
const HOST_FILE = process.env.GODSEYE_CELL_HOST_FILE ?? "/etc/godseye/pg/host.json";
const OUTPUT_LIMIT = 4 * 1024 * 1024;
const REQUEST_LIMIT = 2 * 1024 * 1024;
const LOCK_DIRECTORY = "/run/godseye-cell-helper.lock";
const STATUS_DIRECTORY = "/var/lib/godseye/pg-backup";
const UUID_SEGMENT = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function loadHost() {
  const info = statSync(HOST_FILE);
  if (info.uid !== 0 || (info.mode & 0o022) !== 0)
    throw new Error("Cell host configuration must be root-owned and not group/world writable");
  return parseCellHost(JSON.parse(readFileSync(HOST_FILE, "utf8")));
}
const idOf = (kind: "-u" | "-g", name: string) =>
  Number(execFileSync("/usr/bin/id", [kind, name], { encoding: "utf8" }).trim());

function nodeSystem(allowedRoots: readonly string[]): HelperSystem {
  const missing = (error: unknown) =>
    (error as NodeJS.ErrnoException).code === "ENOENT" ||
    (error as NodeJS.ErrnoException).code === "ENOTDIR";
  return {
    run: (argv, options) =>
      new Promise((resolve, reject) => {
        const full = options?.user
          ? ["/usr/sbin/runuser", "-u", options.user, "--", ...argv]
          : [...argv];
        const [command, ...args] = full;
        if (!command) return reject(new Error("Invalid command"));
        const child = spawn(command, args, {
          env: { PATH: "/usr/sbin:/usr/bin:/sbin:/bin", LANG: "C.UTF-8", ...options?.env },
          shell: false,
          stdio: ["pipe", "pipe", "pipe"],
        });
        const chunks: Buffer[] = [];
        let size = 0;
        child.stdout.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > OUTPUT_LIMIT) child.kill("SIGKILL");
          else chunks.push(chunk);
        });
        child.once("error", () => resolve({ code: 127, stdout: "" }));
        child.once("close", (code) =>
          resolve({
            code: size > OUTPUT_LIMIT ? 1 : (code ?? 1),
            stdout: Buffer.concat(chunks).toString("utf8"),
          }),
        );
        // Diagnostics of fixed host commands go to the journal, never into the reply.
        child.stderr.on("data", (chunk: Buffer) => process.stderr.write(chunk.subarray(0, 4096)));
        child.stdin.on("error", () => undefined);
        child.stdin.end(options?.stdin ?? "");
      }),
    read: async (path) => {
      try {
        return await readFile(path, "utf8");
      } catch (error) {
        if (missing(error)) return null;
        throw error;
      }
    },
    write: async (path, content, options) => {
      const temporary = `${path}.tmp-${process.pid}`;
      await writeFile(temporary, content, { mode: options.mode });
      await chown(temporary, idOf("-u", options.owner), idOf("-g", options.group));
      await chmod(temporary, options.mode);
      await rename(temporary, path);
    },
    list: async (path) => {
      try {
        return await readdir(path);
      } catch (error) {
        if (missing(error)) return [];
        throw error;
      }
    },
    remove: async (path) => {
      const permitted = allowedRoots.some((root) => {
        if (!path.startsWith(`${root}/`)) return false;
        const [segment = ""] = path.slice(root.length + 1).split("/");
        return UUID_SEGMENT.test(segment.replace(/\.json$/, ""));
      });
      if (!permitted || path.includes(".."))
        throw new Error("Refusing to remove an unexpected path");
      await rm(path, { recursive: true, force: true });
    },
    exclusive: async (work) => {
      for (let attempt = 0; ; attempt++) {
        try {
          await mkdir(LOCK_DIRECTORY, { mode: 0o700 });
          break;
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "EEXIST" || attempt > 120) throw error;
          await delay(500);
        }
      }
      try {
        return await work();
      } finally {
        await rmdir(LOCK_DIRECTORY).catch(() => undefined);
      }
    },
  };
}
async function readLine(limit: number) {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of process.stdin as AsyncIterable<Buffer>) {
    size += chunk.length;
    if (size > limit) throw new Error("Request too large");
    chunks.push(chunk);
    if (chunk.includes(10)) break;
  }
  return Buffer.concat(chunks).toString("utf8").split("\n")[0] ?? "";
}
async function respond(helper: CellHelper, verb: string, args: string[], stdin: string) {
  try {
    return { code: 0, stdout: await helper.execute(verb, args, stdin) };
  } catch (error) {
    // Messages are fixed strings (no paths or secrets); the numeric code carries the semantics.
    process.stderr.write(
      `cell-helper ${verb}: ${error instanceof Error ? error.message : "failed"}\n`,
    );
    return { code: error instanceof HelperError ? error.code : 1, stdout: "" };
  }
}
async function main() {
  const host = loadHost();
  const helper = new CellHelper(
    host,
    nodeSystem([host.mountRoot, host.configRoot, STATUS_DIRECTORY]),
  );
  const [first = "", ...rest] = process.argv.slice(2);
  if (first === "--serve") {
    let request: { verb?: unknown; args?: unknown; stdin?: unknown };
    try {
      request = JSON.parse(await readLine(REQUEST_LIMIT)) as typeof request;
    } catch {
      process.stdout.write(`${JSON.stringify({ code: 64, stdout: "" })}\n`);
      return;
    }
    const valid =
      typeof request.verb === "string" &&
      Array.isArray(request.args) &&
      request.args.every((a) => typeof a === "string") &&
      typeof request.stdin === "string";
    const result = valid
      ? await respond(
          helper,
          request.verb as string,
          request.args as string[],
          request.stdin as string,
        )
      : { code: 64, stdout: "" };
    process.stdout.write(`${JSON.stringify(result)}\n`);
    return;
  }
  const payload = first === "file-write" ? readFileSync(0, "utf8") : "";
  const result = await respond(helper, first, rest, payload);
  process.stdout.write(result.stdout);
  process.exitCode = result.code;
}
await main();
