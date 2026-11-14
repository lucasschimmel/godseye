import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const workspace = resolve(fileURLToPath(new URL("..", import.meta.url)));
const action = process.argv[2] ?? "install";
if (!["install", "status", "smoke"].includes(action) || process.argv.length > 3)
  throw new Error("Usage: node scripts/install-hermes.mjs [install|status|smoke]");

// Child environment never inherits provider keys, Python preload paths or tool authority.
const environment = Object.fromEntries(
  ["SystemRoot", "WINDIR", "PATH", "Path", "TEMP", "TMP", "LOCALAPPDATA", "USERPROFILE"]
    .filter((key) => process.env[key])
    .map((key) => [key, process.env[key]]),
);
function execute(binary, arguments_, input = "", timeout = 1_200_000) {
  return new Promise((accept, reject) => {
    const child = spawn(binary, arguments_, { env: environment, windowsHide: true });
    let output = "";
    const timer = setTimeout(() => child.kill(), timeout);
    child.stdout.on("data", (chunk) => {
      output += chunk.toString();
      if (Buffer.byteLength(output) > 1_048_576) child.kill();
    });
    // Upstream diagnostics can contain external authority; only our bounded JSON is exposed.
    child.stderr.on("data", () => {});
    child.once("error", () => {
      clearTimeout(timer);
      reject(new Error("Hermes local installer could not start"));
    });
    child.once("close", (code) => {
      clearTimeout(timer);
      if (code === 0) accept(output.trim());
      else {
        let safe = "Hermes local installer failed; inspect its local status before retrying";
        try {
          const parsed = JSON.parse(output);
          if (typeof parsed.error === "string" && /^[A-Za-z0-9 .:/_-]{1,240}$/.test(parsed.error))
            safe = parsed.error;
        } catch {
          // Malformed child output is deliberately replaced with a fixed safe error.
        }
        reject(new Error(safe));
      }
    });
    child.stdin.end(input);
  });
}

if (process.platform === "win32") {
  const distro =
    process.env.GODSEYE_HERMES_WSL_DISTRO ?? process.env.GODSEYE_PG_WSL_DISTRO ?? "Ubuntu";
  const linux = async (path) =>
    execute("wsl", ["-d", distro, "--exec", "wslpath", "-u", path.replaceAll("\\", "/")]);
  const root = await linux(workspace);
  const script = await linux(resolve(workspace, "scripts/install-hermes.py"));
  process.stdout.write(
    `${await execute("wsl", ["-d", distro, "--exec", "python3", script], JSON.stringify({ workspace: root, action }))}\n`,
  );
} else if (process.platform === "linux") {
  process.stdout.write(
    `${await execute("python3", [resolve(workspace, "scripts/install-hermes.py")], JSON.stringify({ workspace, action }))}\n`,
  );
} else throw new Error("The Hermes local installer supports Linux x64 or WSL2 Ubuntu x64");
