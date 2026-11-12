import { execFile, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { lstat, readFile, realpath, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { tsImport } from "tsx/esm/api";
import { z } from "zod";

const execute = promisify(execFile);
const workspace = resolve(fileURLToPath(new URL("..", import.meta.url)));
const timeout = 180_000;
const actions = new Set(["start", "stop"]);
const args = process.argv.slice(2);
if (args.includes("--help")) {
  process.stdout.write(
    "Persistent local services: node scripts/jobs-services.mjs start --directory .local/jobs-services --cells cells.json --platform platform.json\nStop (keeps data): node scripts/jobs-services.mjs stop --directory .local/jobs-services\nRequires signed project-local PostgreSQL18.6 and Redis8.0.5 tools. No system services/global installs. Private control.json/storage.json are generated without printing their contents.\n",
  );
  process.exit(0);
}
const action = args.shift();
const flags = new Map();
while (args.length) {
  const key = args.shift();
  const value = args.shift();
  if (!new Set(["--directory", "--cells", "--platform"]).has(key) || !value || flags.has(key))
    throw new Error("Invalid jobs-services arguments; use --help");
  flags.set(key, value);
}
if (!actions.has(action) || !flags.has("--directory"))
  throw new Error("Explicit action and private --directory are required");
const directory = resolve(workspace, flags.get("--directory"));
const local = join(workspace, ".local");
const beneath = relative(local, directory);
if (!beneath || beneath.startsWith("..") || isAbsolute(beneath))
  throw new Error("Services directory must be a strict child of this workspace's .local directory");
await safeParents(directory);
const { privateDirectory } = await tsImport(
  "../apps/control-api/src/identity/runtime.ts",
  import.meta.url,
);
await privateDirectory(directory);
const marker = createHash("sha256").update(`${workspace}\n${directory}`).digest("hex");
const scope = z.object({ projectId: z.string().uuid(), environmentId: z.string().uuid() });
let cells;
if (action === "start") {
  if (!flags.has("--cells") || !flags.has("--platform"))
    throw new Error("Start requires explicit existing cell and independent platform configuration");
  const apps = z
    .array(scope)
    .min(1)
    .max(20)
    .parse(await input(flags.get("--cells")));
  const platform = scope.parse(await input(flags.get("--platform")));
  cells = [...apps, platform];
  if (new Set(cells.map((cell) => cell.environmentId)).size !== cells.length)
    throw new Error("Platform and application environments must be distinct");
}
const distro = process.env.GODSEYE_PG_WSL_DISTRO ?? "Ubuntu";
const linuxPath = async (path) =>
  process.platform === "win32"
    ? (
        await execute(
          "wsl",
          ["-d", distro, "--exec", "wslpath", "-u", path.replaceAll("\\", "/")],
          {
            timeout,
            windowsHide: true,
          },
        )
      ).stdout.trim()
    : path;
const request = {
  action,
  marker,
  cells,
  postgresTool: await linuxPath(join(workspace, "artifacts/tools/postgres/18.6/root")),
  redisTool: await linuxPath(join(workspace, "artifacts/tools/redis/8.0.5/root")),
};
const script = await linuxPath(join(workspace, "scripts/jobs-services.py"));
const child = spawn(
  process.platform === "win32" ? "wsl" : "python3",
  process.platform === "win32" ? ["-d", distro, "--exec", "python3", script] : [script],
  { windowsHide: true, stdio: "pipe" },
);
let output = "";
child.stdout.on("data", (chunk) => {
  output += chunk.toString();
  if (output.length > 65536) child.kill();
});
child.stderr.resume();
child.stdin.end(JSON.stringify(request));
const raw = await new Promise((accept, reject) => {
  const timer = setTimeout(() => {
    child.kill();
    reject(new Error("Local services command deadline exceeded; inspect owned state before retry"));
  }, timeout);
  child.once("error", () => {
    clearTimeout(timer);
    reject(new Error("Local services host could not start"));
  });
  child.once("close", (code) => {
    clearTimeout(timer);
    if (code !== 0) reject(new Error("Local services host failed; source state was retained"));
    else accept(JSON.parse(output));
  });
});
if (action === "start") {
  const result = z
    .object({
      control: z.object({ databaseUrl: z.string() }).strict(),
      storage: z.array(scope.extend({ postgresUri: z.string(), redisUri: z.string() }).strict()),
    })
    .strict()
    .parse(raw);
  await save("control.json", result.control);
  await save("storage.json", result.storage);
  process.stdout.write(`Local PostgreSQL/Redis started. Private bindings: ${directory}\n`);
} else process.stdout.write("Owned local PostgreSQL/Redis stopped; all data retained.\n");

async function safeParents(target) {
  let current = target;
  while (true) {
    try {
      const info = await lstat(current);
      if (
        !info.isDirectory() ||
        info.isSymbolicLink() ||
        resolve(await realpath(current)) !== current
      )
        throw new Error("Linked or unsafe services directory");
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
    }
    if (current === workspace) return;
    const parent = dirname(current);
    if (parent === current) throw new Error("Services directory escaped workspace");
    current = parent;
  }
}
async function input(path) {
  const target = resolve(workspace, path);
  const info = await lstat(target);
  if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || info.size > 65536)
    throw new Error("Unsafe cell configuration file");
  return JSON.parse(await readFile(target, "utf8"));
}
async function save(name, value) {
  const target = join(directory, name);
  try {
    const info = await lstat(target);
    if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1)
      throw new Error("Unsafe private binding file");
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
  }
  await writeFile(target, `${JSON.stringify(value)}\n`, { mode: 0o600 });
  await privateDirectory(directory);
}
