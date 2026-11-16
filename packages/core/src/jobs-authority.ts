import type { CreateExecutionPlanInput } from "@godseye/contracts";
import { type DatabaseAccess, schema } from "@godseye/store";
import { eq } from "drizzle-orm";
import { DomainError } from "./errors.js";
import {
  activeCell,
  JOBS_ADAPTER_ID,
  JOBS_DESTINATION,
  JOBS_SCHEDULER_ID,
  JOBS_TOOL,
  type JobState,
  jobsActor,
} from "./jobs-state.js";
import { fingerprint } from "./journal.js";
import type { Actor } from "./policy.js";

/** The scheduler may only trigger an unpaused definition inside the exact cell it was registered in. */
export async function jobsDelegatedAuthority(
  state: JobState,
  tx: DatabaseAccess,
  plan: CreateExecutionPlanInput,
  _phase: "create" | "enqueue" | "approval",
  actor?: Actor,
) {
  const command = plan.command;
  if (plan.adapterId !== JOBS_ADAPTER_ID || command.kind !== "job.operation") return false;
  if (
    command.intent !== "trigger" ||
    (actor &&
      (actor.id !== JOBS_SCHEDULER_ID ||
        actor.kind !== "service" ||
        actor.projectIds.length !== 1 ||
        actor.projectIds[0] !== plan.projectId))
  )
    return false;
  const [definition] = await tx
    .select()
    .from(schema.jobDefinitions)
    .where(eq(schema.jobDefinitions.id, command.definitionRef));
  if (
    !definition ||
    definition.paused ||
    definition.projectId !== plan.projectId ||
    definition.environmentId !== plan.environmentId ||
    plan.targetId !== plan.environmentId ||
    plan.maxCostMicros !== 0 ||
    fingerprint(plan.tools) !== fingerprint([JOBS_TOOL]) ||
    fingerprint(plan.destinations) !== fingerprint([JOBS_DESTINATION])
  )
    return false;
  try {
    await activeCell(state, tx, jobsActor(plan.projectId), plan.projectId, plan.environmentId);
  } catch (error) {
    if (!(error instanceof DomainError)) throw error;
    return false;
  }
  return true;
}
