import { createHash } from "node:crypto";
import {
  AttemptOutcome,
  type CodingObservation,
  CodingResult,
  type EffectOutcomeInput,
  type ExecutionContext,
} from "@godseye/contracts";
import { schema } from "@godseye/store";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import {
  CODING_DESTINATION,
  CODING_TOOL,
  type CodingState,
  codingActor,
  codingScope,
  codingTaskFor,
  preparationFor,
  providerRequest,
  updateCodingTask,
  validateCodingQualification,
} from "./coding-state.js";
import { DomainError } from "./errors.js";
import { currentEpoch, runFor, validateLease } from "./foundation-data.js";
import { write } from "./journal.js";
import { assertOrchestrationDispatch } from "./orchestration-authority.js";
import { attemptReporter } from "./usage-attempts.js";

const Observation = z
  .object({
    state: z.enum(["succeeded", "failed", "cancelled", "unknown"]),
    stopped: z.boolean(),
    attempts: z.array(AttemptOutcome).max(64).optional(),
    grantsRevoked: z.boolean(),
    workspace: z.enum(["retained", "released", "quarantined"]),
    result: CodingResult.optional(),
    reason: z.string().max(160).optional(),
  })
  .strict();
export async function codingExecutionTask(
  state: CodingState,
  context: ExecutionContext,
  readOnly = false,
) {
  return write(state.store, async (tx) => {
    await validateLease(state.request, tx, context, readOnly);
    if (context.command.kind !== "coding.run")
      throw new DomainError("FENCED", "Not a coding command", 409);
    const { task } = await codingTaskFor(tx, context.command.taskId);
    const preparation = await preparationFor(tx, task.preparationId);
    if (
      task.runId !== context.runId ||
      task.projectId !== context.projectId ||
      task.environmentId !== context.environmentId ||
      preparation.id !== context.command.preparationId ||
      preparation.hash !== context.command.preparationHash
    )
      throw new DomainError("FENCED", "Coding task mapping changed", 409);
    if (!readOnly) {
      if (task.state === "cancel_requested" || task.cleanupState === "revoked")
        throw new DomainError("FENCED", "Coding task was cancelled", 409);
      await codingScope(
        state,
        tx,
        codingActor(task.projectId),
        preparation,
        preparation.repositoryHash,
      );
    }
    return { task, preparation };
  });
}
function validateResult(
  result: z.infer<typeof CodingResult>,
  taskId: string,
  worktreeId: string,
  p: Awaited<ReturnType<typeof preparationFor>>,
) {
  if (
    result.taskId !== taskId ||
    result.worktreeId !== worktreeId ||
    result.preparationHash !== p.hash ||
    result.commitSha !== p.commitSha ||
    Buffer.byteLength(result.summary, "utf8") > p.limits.maxOutputBytes
  )
    throw new DomainError("PROVIDER_REJECTED", "Coding result scope or size mismatch", 502);
  for (const artifact of [result.patch, ...result.tests.map((test) => test.log)]) {
    if (!artifact) continue;
    const bytes = Buffer.byteLength(artifact.content, "utf8");
    if (
      bytes !== artifact.bytes ||
      bytes > (artifact.kind === "patch" ? p.limits.maxPatchBytes : p.limits.maxOutputBytes) ||
      createHash("sha256").update(artifact.content).digest("hex") !== artifact.sha256
    )
      throw new DomainError("PROVIDER_REJECTED", "Coding artifact digest or size mismatch", 502);
  }
  if (
    (result.patch && result.patch.kind !== "patch") ||
    result.tests.some(
      (test) => test.profile !== p.testProfile || (test.log && test.log.kind !== "test-log"),
    )
  )
    throw new DomainError("PROVIDER_REJECTED", "Coding evidence kind mismatch", 502);
  if (result.preview.state !== (p.previewRequested ? "unavailable" : "not-requested"))
    throw new DomainError("PROVIDER_REJECTED", "Coding preview evidence mismatch", 502);
}
async function observe(
  state: CodingState,
  context: ExecutionContext,
  raw: CodingObservation,
  readOnly: boolean,
): Promise<EffectOutcomeInput> {
  const observation = Observation.parse(raw);
  for (const outcome of raw.attempts ?? [])
    await attemptReporter(state.store, context.runId, state.now).outcome(
      AttemptOutcome.parse(outcome),
    );
  const { task, preparation } = await codingExecutionTask(state, context, readOnly);
  if (observation.result)
    validateResult(observation.result, task.id, task.worktree.id, preparation);
  const closed =
    observation.stopped &&
    observation.grantsRevoked &&
    observation.workspace !== "quarantined" &&
    observation.state !== "unknown";
  const status = await write(state.store, async (tx) => {
    await validateLease(state.request, tx, context, readOnly);
    const { task: latest } = await codingTaskFor(tx, task.id);
    const { run, operation } = await runFor(tx, context.runId);
    const [cancellation] = await tx
      .select({ key: schema.foundationRequests.key })
      .from(schema.foundationRequests)
      .where(
        and(
          eq(schema.foundationRequests.resourceId, context.runId),
          eq(schema.foundationRequests.kind, "execution.cancel"),
        ),
      )
      .limit(1);
    const deadline = Date.parse(providerRequest(task, preparation).deadline);
    let revoked =
      Boolean(cancellation) ||
      operation.errorCode === "CANCELLED_WITH_UNCERTAIN_EFFECT" ||
      state.now().getTime() >= deadline ||
      latest.state === "cancel_requested" ||
      latest.cleanupState === "revoked" ||
      run.epoch !== (await currentEpoch(tx, latest.environmentId));
    try {
      await assertOrchestrationDispatch(tx, context.command, state.now);
      await codingScope(
        state,
        tx,
        codingActor(task.projectId),
        preparation,
        preparation.repositoryHash,
      );
    } catch (error) {
      if (!(error instanceof DomainError)) throw error;
      revoked = true;
    }
    const checksPassed =
      preparation.testProfile === "none" ||
      observation.result?.tests.some((test) => test.status === "passed");
    const next = closed
      ? revoked
        ? "cancelled"
        : observation.state === "succeeded" && (!observation.result || !checksPassed)
          ? "failed"
          : observation.state
      : revoked
        ? "cancel_requested"
        : "unknown";
    await updateCodingTask(state, tx, latest, {
      state: next,
      cleanupState: closed ? "stopped" : "quarantined",
      worktree: { ...latest.worktree, disposition: closed ? observation.workspace : "quarantined" },
      reason: closed ? null : "PHYSICAL_CLEANUP_UNCONFIRMED",
    });
    if (closed && !revoked && observation.result)
      await tx
        .update(schema.codingTasks)
        .set({ result: observation.result })
        .where(eq(schema.codingTasks.id, task.id));
    if (!readOnly) {
      await state.foundation.assertDispatch(tx, context, {
        actorId: context.workerId,
        tool: CODING_TOOL,
        destination: CODING_DESTINATION,
        costMicros: 0,
      });
      if (
        state.aborts.get(task.id)?.signal.aborted ||
        state.now().getTime() >= Date.parse(providerRequest(task, preparation).deadline)
      )
        throw new DomainError("FENCED", "Coding authority expired while accepting evidence", 409);
    }
    if (readOnly) {
      await validateLease(state.request, tx, context, true);
      if (!revoked && state.now().getTime() >= deadline)
        throw new DomainError("FENCED", "Coding evidence expired during reconciliation", 409);
    }
    if (readOnly) {
      try {
        await assertOrchestrationDispatch(tx, context.command, state.now);
      } catch (error) {
        if (!(error instanceof DomainError)) throw error;
        const masked = closed ? "cancelled" : "cancel_requested";
        await tx
          .update(schema.codingTasks)
          .set({
            metadata: {
              ...latest,
              state: masked,
              cleanupState: closed ? "stopped" : "quarantined",
              worktree: {
                ...latest.worktree,
                disposition: closed ? observation.workspace : "quarantined",
              },
              updatedAt: state.now().toISOString(),
            },
            result: null,
          })
          .where(eq(schema.codingTasks.id, task.id));
        return masked;
      }
    }
    return next;
  });
  return {
    status: closed ? (status === "succeeded" ? "succeeded" : "failed") : "unknown",
    costMicros: preparation.limits.maxCostMicros,
    evidenceRef: `coding:${task.id}:${status}`,
  };
}
export async function executeCoding(
  state: CodingState,
  context: ExecutionContext,
  readOnly = false,
): Promise<EffectOutcomeInput> {
  const { task, preparation } = await codingExecutionTask(state, context, readOnly);
  const provider = state.provider;
  if (!provider) return { status: "unknown", costMicros: preparation.limits.maxCostMicros };
  const request = providerRequest(task, preparation);
  if (readOnly || task.submissionIntended)
    return observe(
      state,
      context,
      await provider.inspect(request, AbortSignal.timeout(10000)),
      true,
    );
  if (state.calls.has(task.id))
    return { status: "unknown", costMicros: preparation.limits.maxCostMicros };
  const abort = new AbortController();
  state.aborts.set(task.id, abort);
  const assertActive = async () => {
    if (abort.signal.aborted || state.now().getTime() >= Date.parse(request.deadline))
      throw new DomainError("FENCED", "Coding deadline or cancellation passed", 409);
    await codingExecutionTask(state, context);
    await write(state.store, (tx) =>
      state.foundation.assertDispatch(tx, context, {
        actorId: context.workerId,
        tool: CODING_TOOL,
        destination: CODING_DESTINATION,
        costMicros: 0,
      }),
    );
    if (abort.signal.aborted || state.now().getTime() >= Date.parse(request.deadline))
      throw new DomainError("FENCED", "Coding deadline or cancellation passed", 409);
  };
  const qualification = validateCodingQualification(
    state,
    preparation,
    await provider.preflight(preparation, AbortSignal.timeout(10000)),
  );
  await assertActive();
  await write(state.store, async (tx) => {
    await validateLease(state.request, tx, context);
    const { task: latest } = await codingTaskFor(tx, task.id);
    if (latest.submissionIntended || latest.state === "cancel_requested")
      throw new DomainError("FENCED", "Coding submission already intended or cancelled", 409);
    validateCodingQualification(state, preparation, qualification);
    await updateCodingTask(state, tx, latest, {
      submissionIntended: true,
      state: "running",
      cleanupState: "pending",
      worktree: { ...latest.worktree, disposition: "active" },
    });
  });
  const timer = setTimeout(
    () => abort.abort(),
    Math.max(1, Date.parse(request.deadline) - state.now().getTime()),
  );
  await assertActive();
  validateCodingQualification(state, preparation, qualification);
  const actual = provider.submit(request, {
    signal: abort.signal,
    assertActive,
    attempts: attemptReporter(state.store, context.runId, state.now, context),
  });
  state.calls.set(task.id, actual);
  try {
    const observation = await Promise.race([
      actual,
      new Promise<CodingObservation>((resolve) =>
        abort.signal.addEventListener(
          "abort",
          () =>
            resolve({
              state: "unknown",
              stopped: false,
              grantsRevoked: false,
              workspace: "quarantined",
            }),
          { once: true },
        ),
      ),
    ]);
    return await observe(state, context, observation, false);
  } finally {
    clearTimeout(timer);
    void actual
      .finally(() => {
        if (state.calls.get(task.id) === actual) state.calls.delete(task.id);
        if (state.aborts.get(task.id) === abort) state.aborts.delete(task.id);
      })
      .catch(() => undefined);
  }
}
export async function stopCoding(state: CodingState, taskId: string) {
  state.aborts.get(taskId)?.abort();
  const { task } = await codingTaskFor(state.store.db, taskId);
  if (!task.submissionIntended || !state.provider) return;
  const preparation = await preparationFor(state.store.db, task.preparationId);
  await state.provider.stop(providerRequest(task, preparation), AbortSignal.timeout(10000));
}
