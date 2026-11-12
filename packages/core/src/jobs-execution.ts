import {
  ApplicationJobEnvelope,
  type EffectOutcomeInput,
  type ExecutionContext,
} from "@godseye/contracts";
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
import { fingerprint, write } from "./journal.js";

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
    const [applicationEvent] = job.payloadRef
      ? await tx
          .select()
          .from(schema.applicationJobEvents)
          .where(eq(schema.applicationJobEvents.id, job.payloadRef))
      : [];
    if (
      applicationEvent &&
      (applicationEvent.projectId !== job.projectId ||
        applicationEvent.environmentId !== job.environmentId)
    )
      throw new DomainError("FENCED", "Application event does not match job scope", 409);
    return { job, definition, applicationEvent };
  });
}
function handlerContext(
  state: JobState,
  context: ExecutionContext,
  loaded: Awaited<ReturnType<typeof loadExecution>>,
  signal: AbortSignal,
  readOnlyReconciliation: boolean,
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
    assertReconciliation: () =>
      write(state.store, async (tx) => {
        if (!readOnlyReconciliation || signal.aborted)
          throw new DomainError("FENCED", "No active read-only reconciliation lease", 409);
        await validateLease(state.request, tx, context, true);
        await activeCell(state, tx, jobsActor(job.projectId), job.projectId, job.environmentId);
      }),
    assertActive: () =>
      write(state.store, async (tx) => {
        await validateLease(state.request, tx, context);
        await activeCell(state, tx, jobsActor(job.projectId), job.projectId, job.environmentId);
        const [current] = await tx
          .select()
          .from(schema.jobDefinitions)
          .where(eq(schema.jobDefinitions.id, definition.id));
        if (signal.aborted || !current || current.paused || current.hash !== definition.hash)
          throw new DomainError(
            "FENCED",
            "Job execution authority changed before physical dispatch",
            409,
          );
      }),
    outbox: (intent) =>
      write(state.store, async (tx) => {
        // A fenced or expired worker lease cannot create new external intent.
        await validateLease(state.request, tx, context);
        if (signal.aborted)
          throw new DomainError("FENCED", "Job execution deadline or cancellation has passed", 409);
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
    const work = async () => {
      const hc = handlerContext(state, context, loaded, controller.signal, reconcile);
      if (loaded.applicationEvent) {
        const receipt = loaded.applicationEvent;
        if (
          state.applicationPayloadLoads.has(receipt.environmentId) ||
          state.applicationPayloadLoads.size >= 50
        )
          throw new DomainError(
            "CAPACITY_EXHAUSTED",
            "Cell payload acquisition is still active",
            429,
          );
        const actual = Promise.resolve().then(() =>
          state.applicationEventLoader?.(
            {
              projectId: receipt.projectId,
              environmentId: receipt.environmentId,
              producerId: receipt.producerId,
            },
            receipt.id,
          ),
        );
        state.applicationPayloadLoads.set(receipt.environmentId, actual);
        void actual
          .finally(() => {
            if (state.applicationPayloadLoads.get(receipt.environmentId) === actual)
              state.applicationPayloadLoads.delete(receipt.environmentId);
          })
          .catch(() => undefined);
        const event = ApplicationJobEnvelope.parse(await actual);
        if (fingerprint(event) !== receipt.hash)
          throw new DomainError("FENCED", "Cell payload no longer matches its accepted event", 409);
        hc.event = structuredClone(event);
      }
      // A read-only probe has its own fenced reconciliation lease, never a renewed mutation grant.
      await write(state.store, (tx) => validateLease(state.request, tx, context, reconcile));
      if (controller.signal.aborted)
        throw new DomainError("FENCED", "Job deadline or cancellation has passed", 409);
      return reconcile && handler.reconcile ? handler.reconcile(hc) : handler.execute(hc);
    };
    const result = await Promise.race([work(), timeout]);
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
