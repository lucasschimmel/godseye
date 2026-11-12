import { type ApplicationEventView, EventView } from "@godseye/app-backend/contracts";
import { type ApplicationTransport, GodseyeHttpError } from "./transport.js";

export type GodseyeEventMessage =
  | { kind: "event"; cursor: string; event: ApplicationEventView }
  | { kind: "refetch"; reason: string }
  | { kind: "revoked"; reason: string };
export interface EventSubscriptionOptions {
  cursor?: string;
  signal: AbortSignal;
  reconnect?: boolean;
}
/** Incremental SSE parser with a byte bound, cancellation and no implicit durable acknowledgment. */
export async function* parseApplicationEvents(
  response: Response,
  signal: AbortSignal,
): AsyncGenerator<GodseyeEventMessage> {
  if (!response.headers.get("content-type")?.startsWith("text/event-stream"))
    throw new GodseyeHttpError("INVALID_EVENT_STREAM", response.status);
  const reader = response.body?.getReader();
  if (!reader) return;
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let buffer = "";
  const abort = () => {
    void reader.cancel().catch(() => undefined);
  };
  signal.addEventListener("abort", abort, { once: true });
  try {
    while (!signal.aborted) {
      const part = await reader.read();
      if (part.done) break;
      buffer += decoder.decode(part.value, { stream: true });
      if (new TextEncoder().encode(buffer).byteLength > 131072)
        throw new GodseyeHttpError("EVENT_FRAME_TOO_LARGE", response.status);
      let delimiter = buffer.search(/\r?\n\r?\n/);
      while (delimiter >= 0) {
        const frame = buffer.slice(0, delimiter);
        const separator = /^(?:\r?\n){2}/.exec(buffer.slice(delimiter));
        buffer = buffer.slice(delimiter + (separator?.[0].length ?? 2));
        let type = "message",
          cursor = "";
        const data: string[] = [];
        for (const line of frame.split(/\r?\n/)) {
          if (line.startsWith("event:")) type = line.slice(6).trimStart();
          else if (line.startsWith("id:")) cursor = line.slice(3).trimStart();
          else if (line.startsWith("data:")) data.push(line.slice(5).trimStart());
        }
        if (data.length) {
          let value: unknown;
          try {
            value = JSON.parse(data.join("\n"));
          } catch {
            throw new GodseyeHttpError("INVALID_EVENT_STREAM", response.status);
          }
          if (type === "domain") {
            if (!/^v1\.\d+\.[A-Za-z0-9_-]{43}$/.test(cursor))
              throw new GodseyeHttpError("INVALID_EVENT_CURSOR", response.status);
            const parsed = EventView.safeParse(value);
            if (!parsed.success)
              throw new GodseyeHttpError("INVALID_EVENT_STREAM", response.status);
            yield { kind: "event", cursor, event: parsed.data };
          } else if (type === "refetch" || type === "revoked") {
            const reason =
              value &&
              typeof value === "object" &&
              "reason" in value &&
              typeof value.reason === "string"
                ? value.reason
                : "unknown";
            yield { kind: type, reason };
            return;
          }
        }
        delimiter = buffer.search(/\r?\n\r?\n/);
      }
    }
  } finally {
    signal.removeEventListener("abort", abort);
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}
function delay(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve) => {
    const finish = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", finish);
      resolve();
    };
    const timer = setTimeout(finish, ms);
    if (signal.aborted) finish();
    else signal.addEventListener("abort", finish, { once: true });
  });
}
export function applicationEvents(transport: ApplicationTransport, reconnectMs = 1000) {
  if (!Number.isSafeInteger(reconnectMs) || reconnectMs < 10 || reconnectMs > 60000)
    throw new Error("SDK reconnect delay is out of range");
  return {
    async *subscribe(options: EventSubscriptionOptions): AsyncGenerator<GodseyeEventMessage> {
      let cursor = options.cursor;
      while (!options.signal.aborted) {
        try {
          const response = await transport.send("/events", {
            signal: options.signal,
            headers: cursor ? { "Last-Event-ID": cursor } : {},
          });
          for await (const message of parseApplicationEvents(response, options.signal)) {
            yield message;
            // Advance only when the consumer requests the next message after observing this one.
            if (message.kind === "event") cursor = message.cursor;
            else return;
          }
        } catch (error) {
          if (options.signal.aborted) return;
          if (error instanceof GodseyeHttpError || options.reconnect === false) throw error;
        }
        if (options.reconnect === false) return;
        await delay(reconnectMs, options.signal);
      }
    },
  };
}
