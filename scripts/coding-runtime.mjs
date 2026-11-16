/** Explicit workspace-local asset setup or fake-API qualification; never enables a coding provider. */
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const workspace = resolve(fileURLToPath(new URL("..", import.meta.url)));
export function codingRuntimeArguments(args) {
  const [action, runner, distro = "Ubuntu"] = args;
  if (
    args.length > 3 ||
    !["install-kvm", "install-cli", "qualify"].includes(action) ||
    (action === "qualify" ? !["codex", "claude-code"].includes(runner) : runner !== "assets") ||
    !/^[A-Za-z0-9_.-]{1,64}$/.test(distro)
  )
    throw new Error("Invalid coding setup arguments");
  return { action, runner, distro };
}
const environment = () =>
  Object.fromEntries(
    ["PATH", "Path", "SystemRoot", "WINDIR", "TEMP", "TMP", "USERPROFILE", "LOCALAPPDATA"]
      .filter((name) => process.env[name] !== undefined)
      .map((name) => [name, process.env[name]]),
  );
async function linuxWorkspace(distro) {
  if (process.platform !== "win32") return workspace;
  return await new Promise((accept, reject) => {
    const child = spawn("wsl.exe", ["-d", distro, "--exec", "/usr/bin/wslpath", "-u", workspace], {
      env: environment(),
      windowsHide: true,
    });
    let output = "";
    const timer = setTimeout(() => child.kill(), 10000);
    child.stdout.on("data", (chunk) => {
      output += String(chunk);
      if (output.length > 8192) child.kill();
    });
    child.stderr.resume();
    child.once("error", () => {
      clearTimeout(timer);
      reject(new Error("Coding Linux workspace unavailable"));
    });
    child.once("close", (code) => {
      clearTimeout(timer);
      if (code === 0 && output.length <= 8192 && output.trim().startsWith("/"))
        accept(output.trim());
      else reject(new Error("Coding Linux workspace unavailable"));
    });
    child.stdin.end();
  });
}
export async function runCodingSetup(args) {
  const { action, runner, distro } = codingRuntimeArguments(args);
  const native = await linuxWorkspace(distro);
  const commands = {
    "install-kvm": [
      `${native}/scripts/coding_guest_install.py`,
      `${native}/artifacts/tools/coding-kvm/10.2.1`,
    ],
    "install-cli": [
      `${native}/scripts/coding_cli_install.py`,
      `${native}/artifacts/tools/coding-cli`,
    ],
    qualify: [`${native}/scripts/coding_guest_qualify.py`, native, runner],
  };
  return await new Promise((accept, reject) => {
    const command = process.platform === "win32" ? "wsl.exe" : "/usr/bin/python3";
    const argv =
      process.platform === "win32"
        ? ["-d", distro, "--exec", "/usr/bin/python3", "-I", ...commands[action]]
        : ["-I", ...commands[action]];
    const child = spawn(command, argv, { env: environment(), windowsHide: true, stdio: "inherit" });
    child.once("error", () => reject(new Error("Coding setup unavailable")));
    child.once("close", (code) => accept(code ?? 1));
  });
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runCodingSetup(process.argv.slice(2))
    .then((code) => {
      process.exitCode = code;
    })
    .catch(() => {
      process.stderr.write("Coding setup unavailable; no provider was enabled.\n");
      process.exitCode = 1;
    });
}
