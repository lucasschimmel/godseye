/** Explicit operator foreground bootstrap; never called by model/tool admission. */
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";

const commandTimeoutMs = 10_000;
const options = process.argv.slice(2);
const repair = options.includes("--start-user-manager");
const lifetimeOption = options.find((value) => value.startsWith("--lifetime-seconds="));
const lifetimeSeconds = lifetimeOption ? Number(lifetimeOption.split("=")[1]) : 8 * 60 * 60;
if (!Number.isInteger(lifetimeSeconds) || lifetimeSeconds < 1 || lifetimeSeconds > 8 * 60 * 60)
  throw new Error("Operator lifetime must be between 1 second and 8 hours");
const maximumLifetimeMs = lifetimeSeconds * 1000;
const remaining = options.filter(
  (value) => value !== "--start-user-manager" && value !== lifetimeOption,
);
if (process.platform !== "win32" || remaining.length > 1)
  throw new Error(
    "Use on Windows: node scripts/hermes-tools-bootstrap.mjs [Ubuntu] [--start-user-manager]",
  );
const distro = remaining[0] ?? "Ubuntu";
if (!/^[A-Za-z0-9_.-]{1,64}$/.test(distro)) throw new Error("Invalid WSL distribution");
const environment = Object.fromEntries(
  ["PATH", "Path", "SystemRoot", "WINDIR", "TEMP", "TMP", "USERPROFILE", "LOCALAPPDATA"]
    .filter((name) => process.env[name] !== undefined)
    .map((name) => [name, process.env[name]]),
);

function command(args) {
  return new Promise((accept, reject) => {
    const child = spawn("wsl.exe", ["-d", distro, ...args], {
      env: environment,
      windowsHide: true,
    });
    const chunks = [];
    let bytes = 0;
    const timer = setTimeout(() => child.kill(), commandTimeoutMs);
    child.stdout.on("data", (chunk) => {
      bytes += chunk.length;
      if (bytes > 8192) child.kill();
      else chunks.push(chunk);
    });
    child.stderr.resume();
    child.once("error", () => {
      clearTimeout(timer);
      reject(new Error("Local WSL bootstrap command unavailable"));
    });
    child.once("close", (code) => {
      clearTimeout(timer);
      if (code === 0 && bytes <= 8192) accept(Buffer.concat(chunks).toString("utf8").trim());
      else reject(new Error("Local WSL bootstrap command refused or timed out"));
    });
    child.stdin.end();
  });
}

// A private inherited pipe is a lifetime capability: closing this CLI also releases
// the foreground WSL holder. No retained numeric PID is read or killed.
const holderProgram = `import os,select,sys; assert os.getuid()==1000; print('READY',flush=True); select.select([sys.stdin],[],[],${lifetimeSeconds})`;
const holder = spawn(
  "wsl.exe",
  ["-d", distro, "--exec", "/usr/bin/python3", "-I", "-B", "-c", holderProgram],
  {
    env: environment,
    windowsHide: true,
    stdio: ["pipe", "pipe", "pipe"],
  },
);
holder.stderr.resume();
let holderExited = false;
let readyTimeout;
const ready = new Promise((accept, reject) => {
  let text = "";
  readyTimeout = setTimeout(
    () => reject(new Error("Foreground WSL holder did not become ready")),
    commandTimeoutMs,
  );
  holder.stdout.on("data", (chunk) => {
    text += chunk.toString("utf8");
    if (text.length > 128) reject(new Error("Invalid foreground WSL holder response"));
    else if (text === "READY\n") {
      clearTimeout(readyTimeout);
      accept();
    }
  });
  holder.once("error", () => reject(new Error("Foreground WSL holder unavailable")));
  holder.once("close", () => {
    holderExited = true;
    clearTimeout(readyTimeout);
    reject(new Error("Foreground WSL holder stopped"));
  });
});

async function main() {
  await ready;
  const state = await command([
    "--exec",
    "systemctl",
    "show",
    "user@1000.service",
    "--property=ActiveState",
    "--value",
  ]);
  if (state !== "active") {
    if (!repair)
      throw new Error(
        "User manager unavailable. Explicit operator activation requires --start-user-manager",
      );
    if (state !== "inactive" && state !== "failed")
      throw new Error("User manager is transitioning; bootstrap refused");
    if (state === "failed")
      await command(["-u", "root", "--exec", "systemctl", "reset-failed", "user@1000.service"]);
    await command(["-u", "root", "--exec", "systemctl", "start", "user@1000.service"]);
  }
  const inspectProgram =
    "import json,os,pathlib,subprocess; assert os.getuid()==1000; p=pathlib.Path('/sys/fs/cgroup/user.slice/user-1000.slice/user@1000.service'); assert p.is_dir() and os.access(p,os.W_OK); assert {'cpu','memory','pids'}<=set((p/'cgroup.controllers').read_text().split()); assert pathlib.Path('/run/user/1000/bus').is_socket(); print(json.dumps({'state':'available','uid':1000,'delegatedControllers':['cpu','memory','pids']}))";
  const metadata = await command(["--exec", "/usr/bin/python3", "-I", "-B", "-c", inspectProgram]);
  if (holderExited) throw new Error("Foreground WSL holder stopped during bootstrap");
  console.log(metadata);
  console.log(
    `Foreground local tools bootstrap is active for at most ${lifetimeSeconds} seconds. Keep this process open while using tools; press Enter or Ctrl+C to release it.`,
  );
  const input = createInterface({ input: process.stdin });
  await new Promise((accept) => {
    const timer = setTimeout(accept, maximumLifetimeMs);
    const finish = () => {
      clearTimeout(timer);
      accept();
    };
    input.once("line", finish);
    input.once("close", finish);
    process.once("SIGINT", finish);
    process.once("SIGTERM", finish);
    holder.once("close", finish);
  });
  input.close();
}

try {
  await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : "Local tools bootstrap refused");
  process.exitCode = 1;
} finally {
  clearTimeout(readyTimeout);
  holder.stdin.end();
}
