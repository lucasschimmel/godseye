import { schema } from "@godseye/store";
import { and, asc, eq, inArray } from "drizzle-orm";
import { DomainError } from "./errors.js";
import { type JobState, jobEnvironmentFilter } from "./jobs-state.js";
import { fingerprint, write } from "./journal.js";

/** Durable owner-authorized requests are consumed by the supervisor; no application code runs in HTTP. */
export async function consumeJobReconciliations(state: JobState) {
  if (state.detached) return;
  const rows = await state.store.db
    .select()
    .from(schema.jobReconcileRequests)
    .where(
      and(
        inArray(schema.jobReconcileRequests.state, ["pending", "processing"]),
        jobEnvironmentFilter(state, schema.jobReconcileRequests.environmentId),
      ),
    )
    .orderBy(asc(schema.jobReconcileRequests.createdAt))
    .limit(20);
  for (const request of rows) {
    await write(state.store, async (tx) => {
      const [job] = await tx
        .select()
        .from(schema.jobRuns)
        .where(eq(schema.jobRuns.id, request.jobRunId));
      if (
        !job ||
        job.runId !== request.foundationRunId ||
        job.projectId !== request.projectId ||
        job.environmentId !== request.environmentId
      )
        throw new DomainError(
          "FENCED",
          "Queued reconciliation no longer matches its original run",
          409,
        );
      await tx
        .update(schema.jobReconcileRequests)
        .set({ state: "processing" })
        .where(eq(schema.jobReconcileRequests.key, request.key));
    });
    try {
      await state.foundation.reconcile(
        { id: request.actorId, kind: "owner", projectIds: [] },
        request.foundationRunId,
        `job-probe:${fingerprint(request.key)}`,
      );
    } catch (error) {
      // HOLD is a parked request, never renewed execution authority or an automatic effect replay.
      if (error instanceof DomainError && ["RECOVERY_HOLD", "DELIVERY_HOLD"].includes(error.code))
        continue;
      if (!(error instanceof DomainError && error.code === "INVALID_TRANSITION")) throw error;
    }
    await write(state.store, async (tx) => {
      await tx
        .update(schema.jobReconcileRequests)
        .set({ state: "complete", completedAt: state.now() })
        .where(eq(schema.jobReconcileRequests.key, request.key));
    });
  }
}
