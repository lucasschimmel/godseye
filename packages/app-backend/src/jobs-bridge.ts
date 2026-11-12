import { randomUUID } from "node:crypto";
import {
  type ApplicationJobEnvelopeInput,
  ApplicationJobEnvelope as ApplicationJobEnvelopeSchema,
} from "@godseye/contracts";
import { and, asc, count, eq, isNotNull, isNull, lt } from "drizzle-orm";
import { ApplicationError } from "./contracts.js";
import { jobEvents } from "./schema.js";
import { type ApplicationState, guardApplication } from "./state.js";
import type { ApplicationAccess } from "./store.js";

export type ApplicationJobEnvelope = ApplicationJobEnvelopeInput;
export interface ApplicationJobTransport {
  /** Resolve only after durable acceptance; receivers must deduplicate the envelope id. */
  send(event: ApplicationJobEnvelopeInput, signal: AbortSignal): Promise<void>;
  settled?(event: ApplicationJobEnvelopeInput, signal: AbortSignal): Promise<boolean>;
}
export interface ApplicationJobsOptions {
  transport: ApplicationJobTransport;
  timeoutMs?: number;
  maxPending?: number;
  retentionDays?: number;
}
async function observeBridgeCall<T>(
  state: ApplicationState,
  work: (signal: AbortSignal) => Promise<T>,
  signal?: AbortSignal,
): Promise<{ observed: true; value: T } | { observed: false }> {
  const abort = new AbortController();
  const actual = Promise.resolve().then(() => work(abort.signal));
  state.jobBridgeFlight = actual;
  void actual
    .finally(() => {
      if (state.jobBridgeFlight === actual) state.jobBridgeFlight = undefined;
    })
    .catch(() => undefined);
  let timer: NodeJS.Timeout | undefined;
  let cancel: (() => void) | undefined;
  const deadline = new Promise<{ observed: false }>((resolve) => {
    cancel = () => {
      abort.abort();
      resolve({ observed: false });
    };
    timer = setTimeout(cancel, state.jobs?.timeoutMs ?? 10_000);
    signal?.addEventListener("abort", cancel, { once: true });
    if (signal?.aborted) cancel();
  });
  try {
    return await Promise.race([
      actual.then(
        (value) => ({ observed: true as const, value }),
        () => ({ observed: false as const }),
      ),
      deadline,
    ]);
  } finally {
    clearTimeout(timer);
    if (cancel) signal?.removeEventListener("abort", cancel);
  }
}
export async function enqueueApplicationJobEvent(
  state: ApplicationState,
  tx: ApplicationAccess,
  input: { key: string; userId: string; type: string; payload: unknown },
  epoch: number,
) {
  if (!state.jobs) return;
  if (Buffer.byteLength(JSON.stringify(input.payload) ?? "") > state.limits.eventBytes)
    throw new ApplicationError("EVENT_TOO_LARGE", "Application event exceeds its byte limit", 413);
  const [previous] = await tx.select().from(jobEvents).where(eq(jobEvents.eventKey, input.key));
  if (previous) {
    if (
      previous.envelope.userId !== input.userId ||
      previous.envelope.eventType !== input.type ||
      JSON.stringify(previous.envelope.payload) !== JSON.stringify(input.payload)
    )
      throw new ApplicationError(
        "IDEMPOTENCY_CONFLICT",
        "Application event key input changed",
        409,
      );
    return;
  }
  const [pending] = await tx
    .select({ total: count() })
    .from(jobEvents)
    .where(isNull(jobEvents.settledAt));
  if ((pending?.total ?? 0) >= (state.jobs.maxPending ?? 1000))
    throw new ApplicationError(
      "JOB_EVENT_CAPACITY",
      "Pending application job events reached their bound",
      429,
    );
  const envelope = ApplicationJobEnvelopeSchema.parse({
    id: randomUUID(),
    ...state.scope,
    producerId: state.store.id,
    epoch,
    eventType: input.type,
    userId: input.userId,
    payload: input.payload,
    occurredAt: state.now().toISOString(),
  });
  await tx
    .insert(jobEvents)
    .values({ id: envelope.id, eventKey: input.key, envelope, createdAt: state.now() });
}

/** Single in-flight sender per runtime. A deadline fences acknowledgement, not physical completion. */
export async function flushApplicationJobs(
  state: ApplicationState,
  options: { signal?: AbortSignal; limit?: number } = {},
) {
  const epoch = await guardApplication(state);
  const pending = async () =>
    (
      await state.store.db
        .select({ total: count() })
        .from(jobEvents)
        .where(isNull(jobEvents.deliveredAt))
    )[0]?.total ?? 0;
  const jobs = state.jobs;
  if (!jobs || state.jobBridgeActive || state.jobBridgeFlight)
    return { delivered: 0, pending: await pending() };
  const limit = options.limit ?? 50;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 200)
    throw new ApplicationError("INVALID_INPUT", "Job event batch must be between one and 200", 422);
  state.jobBridgeActive = true;
  try {
    const inspectSettled = jobs.transport.settled?.bind(jobs.transport);
    if (inspectSettled) {
      const accepted = await state.store.db
        .select()
        .from(jobEvents)
        .where(and(isNotNull(jobEvents.deliveredAt), isNull(jobEvents.settledAt)))
        .orderBy(asc(jobEvents.createdAt), asc(jobEvents.id))
        .offset(state.jobBridgeSettleOffset)
        .limit(limit);
      state.jobBridgeSettleOffset =
        accepted.length < limit ? 0 : state.jobBridgeSettleOffset + accepted.length;
      for (const row of accepted) {
        if (options.signal?.aborted) break;
        const result = await observeBridgeCall(
          state,
          (signal) => inspectSettled(structuredClone(row.envelope), signal),
          options.signal,
        );
        if (!result.observed) return { delivered: 0, pending: await pending() };
        if (result.value)
          await state.store.exclusive(() =>
            state.store.transaction(async (tx) => {
              await guardApplication(state, epoch);
              await tx
                .update(jobEvents)
                .set({ settledAt: state.now() })
                .where(eq(jobEvents.id, row.id));
            }),
          );
      }
      const cutoff = new Date(state.now().getTime() - (jobs.retentionDays ?? 30) * 86_400_000);
      await state.store.exclusive(() =>
        state.store.transaction(async (tx) => {
          await guardApplication(state, epoch);
          await tx.delete(jobEvents).where(lt(jobEvents.settledAt, cutoff));
        }),
      );
    }
    const rows = await state.store.db
      .select()
      .from(jobEvents)
      .where(isNull(jobEvents.deliveredAt))
      .orderBy(asc(jobEvents.createdAt))
      .limit(limit);
    let delivered = 0;
    for (const row of rows) {
      if (options.signal?.aborted) break;
      await guardApplication(state, epoch);
      // Captured source epochs are not silently upgraded after recovery or revocation.
      if (row.envelope.epoch !== epoch) break;
      const accepted = await observeBridgeCall(
        state,
        (signal) => jobs.transport.send(structuredClone(row.envelope), signal),
        options.signal,
      );
      if (!accepted.observed) break;
      await state.store.exclusive(() =>
        state.store.transaction(async (tx) => {
          await guardApplication(state, epoch);
          await tx
            .update(jobEvents)
            .set({ deliveredAt: state.now() })
            .where(eq(jobEvents.id, row.id));
          await guardApplication(state, epoch);
        }),
      );
      delivered++;
    }
    return { delivered, pending: await pending() };
  } finally {
    state.jobBridgeActive = false;
  }
}

export async function readApplicationJobEvent(state: ApplicationState, id: string) {
  const epoch = await guardApplication(state);
  const [row] = await state.store.db.select().from(jobEvents).where(eq(jobEvents.id, id));
  await guardApplication(state, epoch);
  return row ? structuredClone(ApplicationJobEnvelopeSchema.parse(row.envelope)) : undefined;
}
