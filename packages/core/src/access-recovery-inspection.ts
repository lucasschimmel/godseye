import type { ExecutionContext } from "@godseye/contracts";
import { type DatabaseAccess, schema } from "@godseye/store";
import { eq } from "drizzle-orm";
import type { AccessTaskUse } from "./access-redemption.js";
import type { AccessState } from "./access-state.js";
import { DomainError } from "./errors.js";
import { currentEpoch, environmentFor, planFor, runFor } from "./foundation-data.js";
import { validateGrant } from "./foundation-grants.js";
import { assertPlanIntegrity } from "./foundation-queue.js";
import { fingerprint } from "./journal.js";
import {
  RECOVERY_ADAPTER_ID,
  RECOVERY_DESTINATION,
  recoveryPreparationFor,
  recoveryScope,
} from "./recovery-state.js";

/** Private info-only material authority. Never revives a mutation grant or authorizes a provider mutation. */
export async function validateRecoveryInspectionMaterial(
  state: AccessState,
  tx: DatabaseAccess,
  context: ExecutionContext,
  use: AccessTaskUse,
) {
  const { run, operation } = await runFor(tx, context.runId);
  if (operation.status === "running")
    return validateGrant(state.foundationState, tx, context, { ...use, actorId: context.workerId });
  const actor = { id: context.workerId, kind: "service" as const, projectIds: [context.projectId] };
  await environmentFor(tx, actor, context.projectId, context.environmentId);
  const plan = await planFor(tx, actor, context.planId);
  assertPlanIntegrity(plan);
  const command = context.command;
  if (
    operation.status !== "reconciling" ||
    plan.adapterId !== RECOVERY_ADAPTER_ID ||
    command.kind !== "database.recovery" ||
    fingerprint(plan.command) !== fingerprint(command) ||
    run.planId !== context.planId ||
    run.projectId !== context.projectId ||
    run.environmentId !== context.environmentId ||
    run.workerId !== context.workerId ||
    run.fence !== context.fence ||
    run.epoch !== context.epoch ||
    run.grantId !== context.grantId ||
    !run.leaseExpiresAt ||
    run.leaseExpiresAt <= state.now() ||
    (await currentEpoch(tx, context.environmentId)) !== context.epoch ||
    use.costMicros !== 0 ||
    use.tool !== `recovery.${command.intent}` ||
    use.destination !== RECOVERY_DESTINATION
  )
    throw new DomainError("FENCED", "Read-only recovery material authority differs", 409);
  const preparation = await recoveryPreparationFor(tx, command.manifestRef);
  const [step] = await tx
    .select()
    .from(schema.recoverySteps)
    .where(eq(schema.recoverySteps.runId, context.runId));
  const [effect] = await tx
    .select()
    .from(schema.effects)
    .where(eq(schema.effects.runId, context.runId));
  const [recovery] = await tx
    .select()
    .from(schema.recoveryRuns)
    .where(eq(schema.recoveryRuns.runId, context.runId));
  if (
    command.manifestHash !== preparation.hash ||
    preparation.sourceEnvironmentId !== context.environmentId ||
    preparation.projectId !== context.projectId ||
    !step ||
    step.scopeHash !== fingerprint(await recoveryScope(tx, preparation, context.epoch)) ||
    effect?.effectKey !== context.effectKey ||
    effect.fingerprint !== plan.hash ||
    !recovery ||
    recovery.preparationId !== preparation.id ||
    recovery.epoch !== context.epoch ||
    recovery.allocationId !== preparation.allocationId
  )
    throw new DomainError("FENCED", "Read-only recovery material journal differs", 409);
}
