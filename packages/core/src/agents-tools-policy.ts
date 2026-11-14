import {
  AgentProfileConfiguration,
  type AgentTaskToolSelection,
  type AgentToolPolicy,
} from "@godseye/contracts";
import type { AgentState, ProfileRow } from "./agents-state.js";
import { DomainError } from "./errors.js";

export function validateProfileToolPolicy(
  limits: ProfileRow["limits"],
  policy: AgentToolPolicy | null,
) {
  AgentProfileConfiguration.parse({
    model: "gpt-6-luna",
    limits,
    ...(policy ? { toolPolicy: policy } : {}),
  });
  if (
    (!policy && (limits.maxRequests !== 1 || limits.maxTurns !== 1)) ||
    (policy &&
      (limits.maxRequests < 2 ||
        limits.maxTurns !== limits.maxRequests ||
        policy.timeoutSeconds > limits.timeoutSeconds))
  )
    throw new DomainError(
      "INVALID_INPUT",
      "Model continuation requires a consistent owner tool policy",
      422,
    );
}
export function validateTaskToolGrant(
  state: AgentState,
  profile: ProfileRow,
  grant?: AgentTaskToolSelection,
) {
  if (!grant) return;
  const ceiling = profile.toolPolicy;
  if (
    !ceiling ||
    grant.maxModelRequests > profile.limits.maxRequests ||
    grant.policy.tools.some((tool) => !ceiling.tools.includes(tool))
  )
    throw new DomainError("FORBIDDEN", "Task tools exceed the owner profile policy", 403);
  for (const key of [
    "maxCalls",
    "timeoutSeconds",
    "maxReadBytes",
    "maxWriteBytes",
    "maxWorkspaceBytes",
    "maxOutputBytes",
  ] as const)
    if (grant.policy[key] > ceiling[key])
      throw new DomainError("FORBIDDEN", "Task limits exceed the owner profile policy", 403);
  if (!state.toolExecutor?.qualified || !state.toolExecutor.supports(grant))
    throw new DomainError("CAPABILITY_UNAVAILABLE", "Isolated task tools are unavailable", 503);
}
