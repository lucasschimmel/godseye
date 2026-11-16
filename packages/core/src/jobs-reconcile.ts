import { type JobRunView, ReconcileJobRun, type ReconcileJobRunInput } from "@godseye/contracts";
import { schema } from "@godseye/store";
import { eq } from "drizzle-orm";
import { DomainError, parseInput } from "./errors.js";
import { assertFresh } from "./foundation-data.js";
import { definitionFor, type JobState, jobRunFor, runView } from "./jobs-state.js";
import { syncJobRuns } from "./jobs-sync.js";
import { appendAudit, fingerprint, write } from "./journal.js";
import { type Actor, assertOwner } from "./policy.js";

/**
 * Owner reconciliation of an uncertain protected run through the Foundation journal and the handler's
 * read-only probe. The effect is never re-executed; an unprovable effect stays unknown.
 */
export async function reconcileJobRun(
  state: JobState,
  actor: Actor,
  id: string,
  input: ReconcileJobRunInput,
  key: string,
): Promise<JobRunView> {
  assertOwner(actor);
  assertFresh(actor, state.request);
  const data = parseInput(ReconcileJobRun, input);
  if (state.detached)
    return write(state.store, async (tx) => {
      if (!/^[A-Za-z0-9._:-]{16,128}$/.test(key))
        throw new DomainError(
          "INVALID_IDEMPOTENCY_KEY",
          "A valid idempotency key is required",
          400,
        );
      const digest = fingerprint({ actorId: actor.id, id, ...data });
      const [previous] = await tx
        .select()
        .from(schema.jobReconcileRequests)
        .where(eq(schema.jobReconcileRequests.key, key));
      if (previous) {
        if (previous.fingerprint !== digest)
          throw new DomainError(
            "IDEMPOTENCY_CONFLICT",
            "This key identifies another reconciliation",
            409,
          );
        return runView(await jobRunFor(tx, actor, previous.jobRunId));
      }
      const row = await jobRunFor(tx, actor, id);
      const definition = await definitionFor(tx, actor, row.definitionId);
      if (definition.effectPolicy !== "protected" || !row.runId)
        throw new DomainError(
          "INVALID_TRANSITION",
          "Only dispatched protected runs need reconciliation",
          409,
        );
      if (row.state !== data.expectedState)
        throw new DomainError("REVISION_CONFLICT", "Job run is not in the expected state", 409);
      await tx.insert(schema.jobReconcileRequests).values({
        key,
        jobRunId: row.id,
        foundationRunId: row.runId,
        projectId: row.projectId,
        environmentId: row.environmentId,
        actorId: actor.id,
        fingerprint: digest,
        state: "pending",
        createdAt: state.now(),
      });
      await appendAudit(
        tx,
        actor,
        row.projectId,
        "job.run_reconcile_queued",
        `Queued owner-authorized read-only reconciliation for ${row.id} (${data.evidenceRef})`,
      );
      return runView(row);
    });
  const job = await write(state.store, async (tx) => {
    const row = await jobRunFor(tx, actor, id);
    const definition = await definitionFor(tx, actor, row.definitionId);
    if (definition.effectPolicy !== "protected")
      throw new DomainError("INVALID_TRANSITION", "Only protected runs need reconciliation", 409);
    if (row.state !== data.expectedState)
      throw new DomainError("REVISION_CONFLICT", "Job run is not in the expected state", 409);
    if (!row.runId) throw new DomainError("INVALID_TRANSITION", "Run was never dispatched", 409);
    await appendAudit(
      tx,
      actor,
      row.projectId,
      "job.run_reconcile_requested",
      `Owner requested read-only reconciliation of job run ${row.id} (${data.evidenceRef})`,
    );
    return row;
  });
  await state.foundation.reconcile(actor, job.runId ?? "", key);
  await syncJobRuns(state);
  return runView(await jobRunFor(state.store.db, actor, id));
}
