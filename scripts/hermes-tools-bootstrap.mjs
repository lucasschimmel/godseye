/** Explicit operator foreground bootstrap; never called by model/tool admission. Windows/WSL2 or native Linux. */
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import {
  bootstrapEnvironment,
  commandSpec,
  holderProgram,
  inspectProgram,
  parseBootstrapOptions,
  USER_MANAGER_UNIT,
} from "./hermes-tools-bootstrap-lib.mjs";

const commandTimeoutMs = 10_000;
const settings = parseBootstrapOptions(process.argv.slice(2), process.platform);
const { repair, lifetimeSeconds } = settings;
const maximumLifetimeMs = lifetimeSeconds * 1000;
const environment = bootstrapEnvironment(settings.platform, process.env);

function command(spec) {
  return new Promise((accept, reject) => {
    const child = spawn(spec.command, spec.args, { env: environment, windowsHide: true });
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
      reject(new Error("Local bootstrap command unavailable"));
    });
    child.once("close", (code) => {
      clearTimeout(timer);
      if (code === 0 && bytes <= 8192) accept(Buffer.concat(chunks).toString("utf8").trim());
      else reject(new Error("Local bootstrap command refused or timed out"));
    });
    child.stdin.end();
  });
}

// A private inherited pipe is a lifetime capability: closing this CLI also releases
// the foreground holder. No retained numeric PID is read or killed.
const holderSpec = commandSpec(settings, {
  argv: ["/usr/bin/python3", "-I", "-B", "-c", holderProgram(lifetimeSeconds)],
});
const holder = spawn(holderSpec.command, holderSpec.args, {
  env: environment,
  windowsHide: true,
  stdio: ["pipe", "pipe", "pipe"],
});
holder.stderr.resume();
let holderExited = false;
let readyTimeout;
const ready = new Promise((accept, reject) => {
  let text = "";
  readyTimeout = setTimeout(
    () => reject(new Error("Foreground holder did not become ready")),
    commandTimeoutMs,
  );
  holder.stdout.on("data", (chunk) => {
    text += chunk.toString("utf8");
    if (text.length > 128) reject(new Error("Invalid foreground holder response"));
    else if (text === "READY\n") {
      clearTimeout(readyTimeout);
      accept();
    }
  });
  holder.once("error", () => reject(new Error("Foreground holder unavailable")));
  holder.once("close", () => {
    holderExited = true;
    clearTimeout(readyTimeout);
    reject(new Error("Foreground holder stopped"));
  });
});

async function main() {
  await ready;
  const state = await command(
    commandSpec(settings, {
      argv: ["/usr/bin/systemctl", "show", USER_MANAGER_UNIT, "--property=ActiveState", "--value"],
    }),
  );
  if (state !== "active") {
    if (!repair)
      throw new Error(
        "User manager unavailable. Explicit operator activation requires --start-user-manager",
      );
    if (state !== "inactive" && state !== "failed")
      throw new Error("User manager is transitioning; bootstrap refused");
    if (state === "failed")
      await command(
        commandSpec(settings, {
          asRoot: true,
          argv: ["/usr/bin/systemctl", "reset-failed", USER_MANAGER_UNIT],
        }),
      );
    await command(
      commandSpec(settings, {
        asRoot: true,
        argv: ["/usr/bin/systemctl", "start", USER_MANAGER_UNIT],
      }),
    );
  }
  const metadata = await command(
    commandSpec(settings, { argv: ["/usr/bin/python3", "-I", "-B", "-c", inspectProgram()] }),
  );
  if (holderExited) throw new Error("Foreground holder stopped during bootstrap");
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
