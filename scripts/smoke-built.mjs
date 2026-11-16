import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { LOCAL_DEFAULTS } from "../packages/contracts/src/config.ts";

const options = { deadlineMs: 15_000, pollMs: 200 };
const reservation = createServer();
reservation.listen(0, LOCAL_DEFAULTS.host);
await once(reservation, "listening");
const address = reservation.address();
if (!address || typeof address === "string") throw new Error("Cannot reserve a local test port");
await new Promise((done) => reservation.close(done));
const dataDir = await mkdtemp(join(tmpdir(), "godseye-built-"));
const absolute = resolve(dataDir);
if (!absolute.startsWith(`${resolve(tmpdir())}${sep}godseye-built-`)) {
  throw new Error("Refusing cleanup outside the smoke-test directory");
}
const child = spawn(process.execPath, ["dist/control-api/server.mjs"], {
  env: {
    ...process.env,
    GODSEYE_MODE: "local",
    NODE_ENV: "development",
    GODSEYE_API_PORT: String(address.port),
    GODSEYE_DATA_DIR: join(dataDir, "control"),
    GODSEYE_STATE_DIR: join(dataDir, "state"),
    GODSEYE_DATABASE_URL: "",
  },
  stdio: ["ignore", "ignore", "inherit"],
});
const exited = once(child, "exit");
let healthy = false;
try {
  const deadline = Date.now() + options.deadlineMs;
  while (Date.now() < deadline && child.exitCode === null && child.signalCode === null) {
    const response = await fetch(
      `http://${LOCAL_DEFAULTS.host}:${address.port}${LOCAL_DEFAULTS.apiBase}/health`,
      { signal: AbortSignal.timeout(options.pollMs) },
    ).catch(() => undefined);
    if (response?.ok) {
      const status = await response.json();
      healthy = status.mode === "local" && status.serverConnected === false;
      break;
    }
    await delay(options.pollMs);
  }
  if (!healthy) throw new Error("Built API did not become healthy before the deadline");
  console.info(
    "Built API smoke passed: local health is reachable, remote server remains disconnected",
  );
} finally {
  if (child.exitCode === null && child.signalCode === null) child.kill("SIGTERM");
  await exited;
  await rm(absolute, { recursive: true, force: true });
}
