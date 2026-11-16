import { spawn } from "node:child_process";
import { LOCAL_DEFAULTS } from "../packages/contracts/src/config.ts";

const env = {
  ...process.env,
  GODSEYE_MODE: "local",
  GODSEYE_API_PORT: process.env.GODSEYE_API_PORT ?? String(LOCAL_DEFAULTS.apiPort),
  GODSEYE_CONSOLE_PORT: process.env.GODSEYE_CONSOLE_PORT ?? String(LOCAL_DEFAULTS.consolePort),
};
const children = [
  spawn(process.execPath, ["--import", "tsx", "apps/control-api/src/server.ts"], {
    env,
    stdio: "inherit",
  }),
  spawn(
    process.execPath,
    ["node_modules/vite/bin/vite.js", "--config", "apps/console/vite.config.ts"],
    { env, stdio: "inherit" },
  ),
];
let closing = false;
function stop(code = 0) {
  if (closing) return;
  closing = true;
  process.exitCode = code;
  for (const child of children) child.kill("SIGTERM");
}
for (const child of children) {
  child.once("error", () => stop(1));
  child.once("exit", (code) => stop(code ?? 1));
}
for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, () => stop());
