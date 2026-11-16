import { execFile } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execute = promisify(execFile);
const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const script = resolve(root, "scripts/install-redis.py");
const cache = resolve(root, "artifacts/tools/redis/8.0.5");
const options = { timeout: 300_000, maxBuffer: 1_048_576, windowsHide: true };

// Project-local extraction only; never installs packages or starts a system service.
if (process.platform === "win32") {
  const distro = process.env.GODSEYE_PG_WSL_DISTRO ?? "Ubuntu";
  const linuxPath = async (path) =>
    (
      await execute(
        "wsl",
        ["-d", distro, "--exec", "wslpath", "-u", path.replaceAll("\\", "/")],
        options,
      )
    ).stdout.trim();
  const result = await execute(
    "wsl",
    ["-d", distro, "--exec", "python3", await linuxPath(script), await linuxPath(cache)],
    options,
  );
  process.stdout.write(result.stdout);
} else if (process.platform === "linux") {
  process.stdout.write((await execute("python3", [script, cache], options)).stdout);
} else {
  throw new Error("The native Redis laboratory supports Ubuntu amd64, directly or through WSL");
}
