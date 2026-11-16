import { FOUNDATION_DEFAULTS } from "@godseye/contracts";
import { schema } from "@godseye/store";
import { and, eq, inArray, lt } from "drizzle-orm";
import type { FoundationState } from "./foundation-data.js";
import { write } from "./journal.js";
import { type Actor, assertOwner } from "./policy.js";

export async function prune(state: FoundationState, actor: Actor) {
  assertOwner(actor);
  return write(state.store, async (tx) => {
    const requestDeadline = new Date(
      state.now().getTime() - FOUNDATION_DEFAULTS.idempotencyRetentionMs,
    );
    const effectDeadline = new Date(
      state.now().getTime() - state.restoreWindowMs - FOUNDATION_DEFAULTS.idempotencyRetentionMs,
    );
    const requests = await tx
      .delete(schema.foundationRequests)
      .where(lt(schema.foundationRequests.terminalAt, requestDeadline))
      .returning();
    const terminal = await tx
      .select()
      .from(schema.executionRuns)
      .where(lt(schema.executionRuns.terminalAt, effectDeadline));
    let effects = 0;
    for (const run of terminal) {
      const deleted = await tx
        .delete(schema.effects)
        .where(
          and(
            eq(schema.effects.runId, run.id),
            lt(schema.effects.updatedAt, effectDeadline),
            inArray(schema.effects.status, ["succeeded", "failed"]),
          ),
        )
        .returning();
      effects += deleted.length;
    }
    return { idempotency: requests.length, effects };
  });
}
