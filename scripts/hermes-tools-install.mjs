/** Explicit operator setup; no global packages or host configuration. */
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const workspace = resolve(fileURLToPath(new URL("..", import.meta.url)));
const distro = process.argv[2] ?? "Ubuntu";
if (!/^[A-Za-z0-9_.-]{1,64}$/.test(distro) || process.argv.length > 3)
  throw new Error("Invalid WSL distribution");
const environment = Object.fromEntries(
  ["PATH", "Path", "SystemRoot", "WINDIR", "TEMP", "TMP", "USERPROFILE", "LOCALAPPDATA"]
    .filter((name) => process.env[name] !== undefined)
    .map((name) => [name, process.env[name]]),
);
let nativeWorkspace = workspace;
if (process.platform === "win32") {
  nativeWorkspace = await new Promise((accept, reject) => {
    const child = spawn("wsl.exe", ["-d", distro, "--exec", "wslpath", "-u", workspace], {
      env: environment,
      windowsHide: true,
    });
    let text = "";
    child.stdout.on("data", (chunk) => {
      text += String(chunk);
      if (text.length > 8192) child.kill();
    });
    child.stderr.resume();
    child.once("error", () => reject(new Error("Local tools setup path unavailable")));
    child.once("close", (code) =>
      code === 0 && text.length <= 8192
        ? accept(text.trim())
        : reject(new Error("Local tools setup path refused")),
    );
    child.stdin.end();
  });
}
const child = spawn(
  process.platform === "win32" ? "wsl.exe" : "/usr/bin/python3",
  process.platform === "win32"
    ? [
        "-d",
        distro,
        "--exec",
        "/usr/bin/python3",
        `${nativeWorkspace}/scripts/hermes_tools_install.py`,
        nativeWorkspace,
      ]
    : [`${nativeWorkspace}/scripts/hermes_tools_install.py`, nativeWorkspace],
  { env: environment, windowsHide: true, stdio: "inherit" },
);
child.once("error", () => {
  console.error("Local tools setup unavailable");
  process.exitCode = 1;
});
child.once("close", (code) => {
  process.exitCode = code ?? 1;
});
