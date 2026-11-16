import { execFile } from "node:child_process";
import { resolve } from "node:path";
import { promisify } from "node:util";

const execute = promisify(execFile);
export interface RunscLabResult {
  runtime: string;
  platform: string;
  hostKernel: string;
  guestKernel: string;
  nonRootUid: boolean;
  gvisorMarker: boolean;
  ownFixtureVisible: boolean;
  crossRootDenied: boolean;
  readOnlyDenied: boolean;
  tmpfsBound: boolean;
  hostIpv4Denied: boolean;
  hostIpv6Denied: boolean;
  networkProbesExecuted: boolean;
  hostIpv4ControlReachable: boolean;
  hostIpv6ControlReachable: boolean;
  cgroupLimitsQualified: boolean;
  persistentDataQuotaQualified: boolean;
  dockerNetworkQualified: boolean;
  checksumValidated: boolean;
  signatureVerified: boolean;
}

/** This is an explicitly requested real laboratory, never an automatic runtime fallback. */
export async function runscLaboratory(): Promise<RunscLabResult> {
  const root = resolve(process.cwd());
  let executable: string;
  let args: string[];
  if (process.platform === "win32") {
    const converted = await execute("wsl.exe", ["-d", "Ubuntu", "--exec", "wslpath", "-u", root], {
      timeout: 15_000,
      maxBuffer: 16_384,
    });
    const linuxRoot = converted.stdout.trim();
    executable = "wsl.exe";
    args = ["-d", "Ubuntu", "--exec", "python3", `${linuxRoot}/tests/runsc-lab.py`, linuxRoot];
  } else if (process.platform === "linux") {
    executable = "python3";
    args = [resolve(root, "tests/runsc-lab.py"), root];
  } else {
    throw new Error(
      "Explicit infrastructure lab requires Linux x64 or Windows WSL Ubuntu; no skip/fallback",
    );
  }
  try {
    const result = await execute(executable, args, { timeout: 90_000, maxBuffer: 65_536 });
    return JSON.parse(result.stdout.trim()) as RunscLabResult;
  } catch (error) {
    const output =
      error && typeof error === "object" && "stdout" in error ? String(error.stdout) : "";
    let reason = "Ensure Linux/user namespaces or WSL Ubuntu and run bun run runsc:install";
    try {
      const parsed = JSON.parse(output) as { error?: unknown };
      if (typeof parsed.error === "string") reason = parsed.error;
    } catch {
      // Preserve a fixed actionable error when the native helper could not emit its bounded JSON.
      reason = "Ensure Linux/user namespaces or WSL Ubuntu and run bun run runsc:install";
    }
    throw new Error(`Explicit gVisor laboratory failed: ${reason}`);
  }
}
