import type { PlatformBuildsView } from "@godseye/contracts";
import type { Finding } from "./incidents-state.js";

/** The released platform job: its failure is the one that blocks a release. */
const RELEASE_JOB = "godseye-platform";
/** A queued build waiting longer than this is treated as a blocked queue. */
export const CI_QUEUE_STALL_MS = 15 * 60 * 1000;

export interface CiHealthResult {
  findings: Finding[];
  coveredKinds: readonly never[];
  coveredKeys: string[];
}

const finding = (
  key: string,
  severity: Finding["severity"],
  subject: string,
  reason: string,
  summary: string,
): Finding => ({
  key,
  kind: "health",
  severity,
  projectId: null,
  environmentId: null,
  allocationId: null,
  subject: subject.slice(0, 60),
  reason,
  summary,
});

/**
 * Turns the observed Jenkins state into incident findings: a failed build, an offline agent, a
 * blocked queue or an unreachable controller. A key is "covered" (so a recovered condition clears
 * its incident) only when the evidence that would prove recovery was actually read.
 */
export function ciHealthFindings(view: PlatformBuildsView): CiHealthResult {
  const result: CiHealthResult = { findings: [], coveredKinds: [], coveredKeys: [] };
  // No binding or local mode is not a CI failure; there is nothing to evaluate.
  if (view.state !== "connected") return result;
  for (const job of view.jobs) {
    const key = `ci:build:${job.name}`;
    if (job.state === "unavailable") continue;
    const latest = job.builds.find((build) => !build.building && build.result !== null);
    if (!latest) continue;
    if (latest.result === "FAILURE") {
      result.findings.push(
        finding(
          key,
          job.name === RELEASE_JOB ? "critical" : "warning",
          job.name,
          "CI_BUILD_FAILED",
          `Latest Jenkins build #${latest.number} of ${job.name} failed`,
        ),
      );
    } else if (latest.result === "SUCCESS") result.coveredKeys.push(key);
  }
  const reachable = view.jobs.some((job) => job.state === "observed");
  if (view.jobs.length > 0 && !reachable) {
    result.findings.push(
      finding(
        "ci:jenkins:unreachable",
        "warning",
        "jenkins",
        "CI_CONTROLLER_UNREADABLE",
        "Jenkins builds cannot be read; CI state is unverified",
      ),
    );
  } else if (reachable) result.coveredKeys.push("ci:jenkins:unreachable");
  const infra = view.infrastructure;
  if (infra?.state === "observed") {
    for (const agent of infra.agents) {
      const key = `ci:agent:${agent.name}`;
      if (agent.online) result.coveredKeys.push(key);
      else
        result.findings.push(
          finding(
            key,
            "warning",
            agent.name,
            "CI_AGENT_OFFLINE",
            `Jenkins agent ${agent.name} is offline; builds cannot run`,
          ),
        );
    }
    const stalled =
      infra.queue.stuck > 0 ||
      (infra.queue.oldestWaitMs !== null && infra.queue.oldestWaitMs > CI_QUEUE_STALL_MS);
    if (stalled)
      result.findings.push(
        finding(
          "ci:queue:stalled",
          "warning",
          "queue",
          "CI_QUEUE_STALLED",
          `Jenkins queue holds ${infra.queue.length} build(s) that are not starting`,
        ),
      );
    else result.coveredKeys.push("ci:queue:stalled");
  }
  return result;
}
