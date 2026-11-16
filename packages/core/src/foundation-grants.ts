import type { ExecutionContext } from "@godseye/contracts";
import { type DatabaseAccess, schema } from "@godseye/store";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { DomainError, parseInput } from "./errors.js";
import { type FoundationState, validateLease } from "./foundation-data.js";
import { write } from "./journal.js";
import { type Actor, assertProjectAccess } from "./policy.js";

const GrantUse = z
  .object({
    actorId: z.string().min(1).max(128),
    tool: z.string().min(1).max(64),
    destination: z.string().min(1).max(253),
    costMicros: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  })
  .strict();
export async function heartbeat(state: FoundationState, context: ExecutionContext) {
  return write(state.store, async (tx) => {
    await validateLease(state, tx, context);
    const expiresAt = new Date(state.now().getTime() + state.leaseMs);
    await tx
      .update(schema.executionRuns)
      .set({ leaseExpiresAt: expiresAt })
      .where(eq(schema.executionRuns.id, context.runId));
    await tx
      .update(schema.taskGrants)
      .set({ expiresAt })
      .where(eq(schema.taskGrants.id, context.grantId));
  });
}
export async function getGrant(state: FoundationState, actor: Actor, grantId: string) {
  const [grant] = await state.store.db
    .select()
    .from(schema.taskGrants)
    .where(eq(schema.taskGrants.id, grantId));
  if (!grant) throw new DomainError("NOT_FOUND", "Task grant not found", 404);
  const [run] = await state.store.db
    .select()
    .from(schema.executionRuns)
    .where(eq(schema.executionRuns.id, grant.runId));
  if (!run) throw new DomainError("JOURNAL_INCONSISTENT", "Grant execution is missing", 500);
  assertProjectAccess(actor, run.projectId);
  return grant;
}
export async function authorizeGrant(
  state: FoundationState,
  context: ExecutionContext,
  input: z.infer<typeof GrantUse>,
) {
  const data = parseInput(GrantUse, input);
  return write(state.store, async (tx) => {
    const grant = await validateGrant(state, tx, context, data);
    await tx
      .update(schema.taskGrants)
      .set({ usedMicros: grant.usedMicros + data.costMicros })
      .where(eq(schema.taskGrants.id, context.grantId));
  });
}
/** Reusable trusted in-transaction dispatch gate; does not charge or extend a lease. */
export async function validateGrant(
  state: FoundationState,
  tx: DatabaseAccess,
  context: ExecutionContext,
  input: z.infer<typeof GrantUse>,
) {
  const data = parseInput(GrantUse, input);
  await validateLease(state, tx, context);
  const [grant] = await tx
    .select()
    .from(schema.taskGrants)
    .where(eq(schema.taskGrants.id, context.grantId));
  if (
    !grant ||
    grant.revokedAt ||
    grant.actorId !== data.actorId ||
    grant.environmentId !== context.environmentId ||
    grant.epoch !== context.epoch ||
    grant.fence !== context.fence ||
    grant.expiresAt.getTime() <= state.now().getTime() ||
    !grant.tools.includes(data.tool) ||
    !grant.destinations.includes(data.destination)
  )
    throw new DomainError(
      "FORBIDDEN",
      "Task grant does not authorize this actor, tool or destination",
      403,
    );
  if (grant.usedMicros + data.costMicros > grant.maxCostMicros)
    throw new DomainError("BUDGET_EXCEEDED", "Task grant budget is exhausted", 409);
  return grant;
}
