import { spawn } from "node:child_process";

// An inherited IPC channel is the lifecycle capability. The guardian owns the actual engine handle;
// neither a stale PID nor an application-selected process identifier is used for termination.
let engine;
let stopping = false;
let initialized = false;
function stop() {
  if (stopping) return;
  stopping = true;
  if (!engine || engine.exitCode !== null || engine.signalCode !== null) {
    if (process.connected) process.disconnect();
    return;
  }
  engine.once("close", () => {
    if (process.connected) process.disconnect();
  });
  engine.kill("SIGTERM");
  const deadline = setTimeout(() => {
    if (engine.exitCode === null && engine.signalCode === null) engine.kill("SIGKILL");
  }, 5000);
  engine.once("close", () => clearTimeout(deadline));
}
process.on("message", (message) => {
  if (message?.kind === "stop") return stop();
  if (
    initialized ||
    message?.kind !== "start" ||
    typeof message.binary !== "string" ||
    !Array.isArray(message.args) ||
    message.args.some((value) => typeof value !== "string")
  ) {
    process.exitCode = 1;
    return stop();
  }
  initialized = true;
  engine = spawn(message.binary, message.args, {
    cwd: process.cwd(),
    env: process.env,
    stdio: "ignore",
    windowsHide: true,
  });
  engine.once("error", () => {
    process.exitCode = 1;
    stop();
  });
  engine.once("close", (code) => {
    if (!stopping) process.exitCode = code || 1;
    if (process.connected) process.disconnect();
  });
});
process.once("disconnect", stop);
for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, stop);
if (!process.connected) process.exitCode = 1;
