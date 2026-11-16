import type { JobState } from "./jobs-state.js";

export const OUTBOX_CALL_CAPACITY = 50;
export const outboxCallKey = (environmentId: string, destination: string) =>
  `${environmentId}:${destination}`;
export const outboxCallAvailable = (state: JobState, key: string) =>
  state.outboxCalls.size < OUTBOX_CALL_CAPACITY && !state.outboxCalls.has(key);

/** A deadline fences observation, not the external effect; retain its slot until it really settles. */
export async function boundedOutboxCall<T>(
  state: JobState,
  key: string,
  work: (signal: AbortSignal) => Promise<T>,
  signal?: AbortSignal,
): Promise<T | undefined> {
  if (signal?.aborted || !outboxCallAvailable(state, key)) return undefined;
  state.outboxCalls.add(key);
  const controller = new AbortController();
  let timer: NodeJS.Timeout | undefined;
  let stop = () => {};
  const stopped = new Promise<undefined>((resolve) => {
    stop = () => {
      controller.abort();
      resolve(undefined);
    };
    timer = setTimeout(stop, state.dispatchTimeoutMs);
    signal?.addEventListener("abort", stop, { once: true });
  });
  const pending = Promise.resolve()
    .then(() => (controller.signal.aborted ? undefined : work(controller.signal)))
    // Provider exceptions are uncertain; never expose provider material or blindly retry them.
    .catch(() => undefined)
    .finally(() => state.outboxCalls.delete(key));
  try {
    return await Promise.race([pending, stopped]);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", stop);
  }
}
