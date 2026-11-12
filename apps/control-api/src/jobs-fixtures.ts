import type { InfrastructureOptions, JobHandler } from "@godseye/core";

/**
 * Explicit, opt-in simulated handlers for the `local_fixture` engine state. They perform no external
 * effect and prove nothing about a deployed worker runtime; the registry is empty unless enabled.
 */
const handlers: ReadonlyMap<string, JobHandler> = new Map<string, JobHandler>([
  ["fixture.noop", { execute: async () => ({ status: "succeeded", evidenceRef: "fixture:noop" }) }],
  ["fixture.fail", { execute: async () => ({ status: "failed", evidenceRef: "fixture:fail" }) }],
  ["fixture.unknown", { execute: async () => ({ status: "unknown" }) }],
]);

export function jobsOptions(enabled: boolean): InfrastructureOptions["jobs"] {
  return enabled ? { handlers } : undefined;
}
