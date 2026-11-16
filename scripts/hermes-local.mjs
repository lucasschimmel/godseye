import { execFile, spawn } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const deadlineMs = 30_000;
const outputLimitBytes = 262_144;
const workspace = resolve(fileURLToPath(new URL("..", import.meta.url)));
const actions = new Set(["catalog", "prepare", "profiles", "inspect", "verify", "promote"]);
const flags = new Map([
  ["--project", "projectId"],
  ["--environment", "environmentId"],
  ["--role", "role"],
  ["--model", "model"],
  ["--profile", "profileId"],
  ["--revision", "revision"],
  ["--expected-revision", "expectedRevision"],
]);

export function parseArguments(args) {
  const [action, ...rest] = args;
  if (!actions.has(action) || rest.length % 2) throw new Error("Invalid local Hermes command");
  const request = { action };
  for (let index = 0; index < rest.length; index += 2) {
    const field = flags.get(rest[index]);
    const value = rest[index + 1];
    if (!field || !value || value.startsWith("--") || Object.hasOwn(request, field))
      throw new Error("Invalid local Hermes option");
    request[field] = value;
  }
  return request;
}

export function hostEnvironment(environment = process.env) {
  const allowed = ["PATH", "SystemRoot", "WINDIR", "TEMP", "TMP", "USERPROFILE", "LOCALAPPDATA"];
  return Object.fromEntries(
    allowed
      .filter((name) => environment[name] !== undefined)
      .map((name) => [name, environment[name]]),
  );
}

async function run(args) {
  if (args.length === 1 && args[0] === "--help") {
    process.stdout.write(
      "Local Hermes preparation only (no model, tools or run admission).\n" +
        "hermes:local catalog | profiles\n" +
        "hermes:local prepare --project UUID --environment UUID --role operations|security|research-marketing [--model MODEL]\n" +
        "hermes:local inspect|verify --profile UUID [--revision SHA256]\n" +
        "hermes:local promote --profile UUID --revision SHA256 --expected-revision CURRENT_SHA256\n" +
        "Install separately with hermes:install. Profiles are local declarations, not project ownership or execution grants.\n",
    );
    return;
  }
  const request = parseArguments(args);
  const distro =
    process.env.GODSEYE_HERMES_WSL_DISTRO ?? process.env.GODSEYE_PG_WSL_DISTRO ?? "Ubuntu";
  if (!/^[A-Za-z0-9_.-]{1,64}$/.test(distro)) throw new Error("Invalid local WSL distribution");
  const environment = hostEnvironment();
  const linuxPath = async (path) =>
    process.platform === "win32"
      ? (
          await promisify(execFile)(
            "wsl.exe",
            ["-d", distro, "--exec", "/usr/bin/wslpath", "-u", path],
            {
              env: environment,
              timeout: deadlineMs,
              windowsHide: true,
            },
          )
        ).stdout.trim()
      : path;
  const localWorkspace = await linuxPath(workspace);
  const script = await linuxPath(resolve(workspace, "scripts/hermes_local.py"));
  const child = spawn(
    process.platform === "win32" ? "wsl.exe" : "/usr/bin/python3",
    process.platform === "win32" ? ["-d", distro, "--exec", "/usr/bin/python3", script] : [script],
    { env: environment, windowsHide: true, stdio: "pipe", cwd: workspace },
  );
  let output = "";
  let overflow = false;
  child.stdout.on("data", (chunk) => {
    if (overflow) return;
    output += chunk.toString();
    if (Buffer.byteLength(output) > outputLimitBytes) {
      output = "";
      overflow = true;
      child.kill();
    }
  });
  child.stderr.resume(); // Never forward upstream/private exception content.
  const result = new Promise((accept, reject) => {
    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error("Local Hermes setup deadline exceeded; inspect before retrying"));
    }, deadlineMs);
    child.once("error", () => {
      clearTimeout(timeout);
      reject(new Error("Local Hermes host is unavailable"));
    });
    child.once("close", (code) => {
      clearTimeout(timeout);
      if (code !== 0 || overflow)
        reject(new Error("Local Hermes setup refused; inspect retained state"));
      else accept(output);
    });
  });
  child.stdin.on("error", () => child.kill());
  child.stdin.end(JSON.stringify({ ...request, workspace: localWorkspace }));
  const value = JSON.parse(await result);
  if (!value || typeof value !== "object" || Array.isArray(value) || value.error)
    throw new Error("Invalid local Hermes setup response");
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  run(process.argv.slice(2)).catch(() => {
    process.stderr.write(
      "Local Hermes setup failed; use --help and inspect retained state before retrying.\n",
    );
    process.exitCode = 1;
  });
}
