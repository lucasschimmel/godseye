import { execFile, spawn } from "node:child_process";
import { resolve } from "node:path";
import { promisify } from "node:util";

const workspace = resolve(process.cwd());
const distro =
  process.env.GODSEYE_HERMES_WSL_DISTRO ?? process.env.GODSEYE_PG_WSL_DISTRO ?? "Ubuntu";
if (process.argv.length !== 2 || !/^[A-Za-z0-9_.-]{1,64}$/.test(distro))
  throw new Error("Invalid local Hermes runtime installation arguments");
const environment = Object.fromEntries(
  ["PATH", "Path", "SystemRoot", "WINDIR", "TEMP", "TMP", "USERPROFILE", "LOCALAPPDATA"]
    .filter((name) => process.env[name] !== undefined)
    .map((name) => [name, process.env[name]]),
);
const localPath = async (path) =>
  process.platform === "win32"
    ? (
        await promisify(execFile)(
          "wsl.exe",
          ["-d", distro, "--exec", "/usr/bin/wslpath", "-u", path],
          { env: environment, timeout: 30000, windowsHide: true },
        )
      ).stdout.trim()
    : path;
const root = await localPath(workspace);
const script = await localPath(resolve(workspace, "scripts/hermes_runtime_install.py"));
const child = spawn(
  process.platform === "win32" ? "wsl.exe" : "/usr/bin/python3",
  process.platform === "win32" ? ["-d", distro, "--exec", "/usr/bin/python3", script] : [script],
  { env: environment, windowsHide: true, stdio: "pipe" },
);
let output = "";
child.stdout.on("data", (chunk) => {
  output += String(chunk);
  if (output.length > 16384) child.kill();
});
child.stderr.resume();
child.stdin.end(JSON.stringify({ workspace: root }));
const code = await new Promise((accept) => child.once("close", accept));
if (code !== 0)
  throw new Error("Hermes execution runtime installation refused; inspect retained state");
const value = JSON.parse(output);
if (value.status !== "installed") throw new Error("Hermes execution runtime is unavailable");
process.stdout.write(`${JSON.stringify(value)}\n`);
