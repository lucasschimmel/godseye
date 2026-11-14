import type { CodingProvider } from "@godseye/contracts";
import type { CodingOptions } from "@godseye/core";
import { configuredCodingProvider } from "./coding-provider.js";

const unavailableConfiguration: CodingProvider = {
  qualified: false,
  capabilities: () =>
    (["codex", "claude-code"] as const).map((runner) => ({
      runner,
      available: false,
      version: null,
      reason:
        "Private coding configuration is invalid or unavailable; owner administration remains available",
      isolation: "disposable-kvm",
      billing: "unavailable",
      auth: "task-scoped-broker",
    })),
  verifySource: async () => {
    throw new Error("Coding configuration unavailable");
  },
  preflight: async () => {
    throw new Error("Coding configuration unavailable");
  },
  submit: async () => ({
    state: "unknown",
    stopped: false,
    grantsRevoked: false,
    workspace: "quarantined",
  }),
  inspect: async () => ({
    state: "unknown",
    stopped: false,
    grantsRevoked: false,
    workspace: "quarantined",
  }),
  stop: async () => ({
    state: "unknown",
    stopped: false,
    grantsRevoked: false,
    workspace: "quarantined",
  }),
};

/** Coding setup is optional; failure never disables independent owner administration or recovery. */
export async function codingStartupOptions(
  environment: NodeJS.ProcessEnv = process.env,
): Promise<CodingOptions> {
  try {
    return await configuredCodingProvider(environment);
  } catch (error) {
    if (
      !(error instanceof Error) ||
      error.message !== "Private coding runtime configuration is unavailable or invalid"
    )
      throw error;
    return { provider: unavailableConfiguration };
  }
}
