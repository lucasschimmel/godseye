import type { EffectOutcomeInput, ExecutionContext } from "@godseye/contracts";
import { schema } from "@godseye/store";
import { eq } from "drizzle-orm";
import { DomainError } from "./errors.js";
import { validateLease } from "./foundation-data.js";
import { enqueueOutbox } from "./jobs-outbox.js";
import {
  activeCell,
  definitionView,
  type JobHandlerContext,
  type JobHandlerResult,
  type JobState,
  jobsActor,
  outboxView,
  runView,
} from "./jobs-state.js";
import { write } from "./journal.js";

export const HANDLER_UNAVAILABLE_EVIDENCE = "job:handler-unavailable";
export const TIMEOUT_EVIDENCE = "job:timeout";
const OUTCOMES = new Set(["succeeded", "failed", "unknown"]);

async function loadExecution(state: JobState, context: ExecutionContext, start: boolean) {
  return write(state.store, async (tx) => {
    const [job] = await tx
      .select()
      .from(schema.jobRuns)
      .where(eq(schema.jobRuns.runId, context.runId));
    const command = context.command;
    if (
      !job ||
      command.kind !== "job.operation" ||
      command.definitionRef !== job.definitionId ||
      job.projectId !== context.projectId ||
      job.environmentId !== context.environmentId
    )
      throw new DomainError("FENCED", "Job mapping does not match the execution scope", 409);
    const [definition] = await tx
      .select()
      .from(schema.jobDefinitions)
      .where(eq(schema.jobDefinitions.id, job.definitionId));
    if (
      !definition ||
      definition.projectId !== context.projectId ||
      definition.environmentId !== context.environmentId ||
      job.state === "cancel_requested"
    )
      throw new DomainError("FENCED", "Job definition or run no longer owns this execution", 409);
    if (start) {
      await activeCell(state, tx, jobsActor(job.projectId), job.projectId, job.environmentId);
      await tx
        .update(schema.jobRuns)
        .set({ state: "running", startedAt: job.startedAt ?? state.now(), updatedAt: state.now() })
        .where(eq(schema.jobRuns.id, job.id));
    }
    return { job, definition };
  });
}
function handlerContext(
  state: JobState,
  context: ExecutionContext,
  loaded: Awaited<ReturnType<typeof loadExecution>>,
  signal: AbortSignal,
): JobHandlerContext {
  const { job, definition } = loaded;
  return {
    projectId: job.projectId,
    environmentId: job.environmentId,
    definition: definitionView(definition),
    run: runView(job),
    effectKey: `job:${job.id}`,
    attemptKey: context.effectKey,
    signal,
    outbox: (intent) =>
      write(state.store, async (tx) => {
        // A fenced or expired worker lease cannot create new external intent.
        await validateLease(state.request, tx, context);
        const row = await enqueueOutbox(state, tx, {
          ...intent,
          projectId: job.projectId,
          environmentId: job.environmentId,
          jobRunId: job.id,
        });
        return outboxView(row);
      }),
  };
}
function toOutcome(result: JobHandlerResult): EffectOutcomeInput {
  if (!OUTCOMES.has(result.status)) return { status: "unknown", costMicros: 0 };
  return { status: result.status, evidenceRef: result.evidenceRef, costMicros: 0 };
}
/** Runs a registered fixture handler under bounded time; every uncertain path reports unknown. */
export async function executeJob(
  state: JobState,
  context: ExecutionContext,
  reconcile = false,
): Promise<EffectOutcomeInput> {
  const loaded = await loadExecution(state, context, !reconcile);
  const handler = state.handlers?.get(loaded.definition.handler);
  if (!handler)
    return { status: "failed", evidenceRef: HANDLER_UNAVAILABLE_EVIDENCE, costMicros: 0 };
  if (reconcile && !handler.reconcile) return { status: "unknown", costMicros: 0 };
  const controller = new AbortController();
  state.aborts.set(context.runId, controller);
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<"timeout">((resolve) => {
    timer = setTimeout(() => {
      controller.abort();
      resolve("timeout");
    }, state.timeoutMs(loaded.definition.limits.timeoutSeconds));
  });
  try {
    const hc = handlerContext(state, context, loaded, controller.signal);
    const run = reconcile && handler.reconcile ? handler.reconcile(hc) : handler.execute(hc);
    const result = await Promise.race([run, timeout]);
    if (result === "timeout")
      return loaded.definition.effectPolicy === "protected"
        ? { status: "unknown", costMicros: 0 }
        : { status: "failed", evidenceRef: TIMEOUT_EVIDENCE, costMicros: 0 };
    return toOutcome(result);
  } catch {
    return { status: "unknown", costMicros: 0 };
  } finally {
    clearTimeout(timer);
    state.aborts.delete(context.runId);
  }
}
export async function fenceJob(state: JobState, context: ExecutionContext) {
  state.aborts.get(context.runId)?.abort();
}
