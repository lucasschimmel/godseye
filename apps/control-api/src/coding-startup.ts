import { existsSync } from "node:fs";
import { isAbsolute } from "node:path";
import type { CodingOptions } from "@godseye/core";
import { configuredCodingProvider } from "./coding-provider.js";
import { NOT_CONFIGURED_FOR_PROFILE, unavailableCodingProvider } from "./coding-transport.js";

const INVALID_CONFIGURATION = "Private coding runtime configuration is unavailable or invalid";

/**
 * Coding setup is optional; failure never disables independent owner administration or recovery.
 * A Linux host without any private transport configuration reports the explicit
 * `unavailable: not-configured-for-profile` state instead of probing for a local boundary.
 */
export async function codingStartupOptions(
  environment: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): Promise<CodingOptions> {
  const file = environment.GODSEYE_CODING_BINDINGS_FILE;
  // A tmpfs-rendered file is absent while OpenBao is sealed; treat it exactly as unconfigured.
  if (!file || (isAbsolute(file) && !existsSync(file)))
    return platform === "win32"
      ? {}
      : { provider: unavailableCodingProvider(NOT_CONFIGURED_FOR_PROFILE) };
  try {
    return await configuredCodingProvider(environment, { platform });
  } catch (error) {
    if (!(error instanceof Error) || error.message !== INVALID_CONFIGURATION) throw error;
    return {
      provider: unavailableCodingProvider(
        "Private coding configuration is invalid or unavailable; owner administration remains available",
      ),
    };
  }
}
