import type { ChildProcess, Serializable } from "node:child_process";
import { z } from "zod";

export interface RpcTransport {
  send(message: unknown): void;
  subscribe(listener: (message: unknown) => void): () => void;
  closed(listener: () => void): () => void;
}
const Message = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("request"),
      id: z.number().int().positive(),
      method: z.string().regex(/^[a-z][a-z.-]{0,63}$/),
      payload: z.json(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("response"),
      id: z.number().int().positive(),
      ok: z.boolean(),
      result: z.json().optional(),
      code: z
        .string()
        .regex(/^[A-Z_]{1,64}$/)
        .optional(),
    })
    .strict(),
]);
export class RpcError extends Error {
  constructor(readonly code: string) {
    super(`Private worker channel: ${code}`);
  }
}
interface Pending {
  timer: NodeJS.Timeout;
  resolve(value: unknown): void;
  reject(error: Error): void;
}
/** Capability-bound local IPC. Timed-out calls retain capacity until the actual response or disconnect. */
export function createRpcPeer(
  transport: RpcTransport,
  options: {
    timeoutMs?: number;
    maxPending?: number;
    maxBytes?: number;
    onRequest(method: string, payload: unknown): Promise<unknown>;
    onFailure?(): void;
  },
) {
  const timeoutMs = options.timeoutMs ?? 15_000,
    maxPending = options.maxPending ?? 64;
  const maxBytes = options.maxBytes ?? 524_288;
  if (
    [timeoutMs, maxPending, maxBytes].some(
      (value) => !Number.isSafeInteger(value) || value < 1 || value > 2_147_483_647,
    )
  )
    throw new RpcError("INVALID_CONFIGURATION");
  let nextId = 0,
    lastReceived = 0,
    inbound = 0,
    stopped = false;
  const pending = new Map<number, Pending>();
  const send = (value: unknown) => {
    if (Buffer.byteLength(JSON.stringify(value)) > maxBytes)
      throw new RpcError("MESSAGE_TOO_LARGE");
    transport.send(value);
  };
  const close = () => {
    if (stopped) return;
    stopped = true;
    unsubscribe();
    unclose();
    for (const entry of pending.values()) {
      clearTimeout(entry.timer);
      entry.reject(new RpcError("DISCONNECTED"));
    }
    pending.clear();
  };
  const fail = () => {
    close();
    options.onFailure?.();
  };
  async function receive(raw: unknown) {
    if (stopped) return;
    if (Buffer.byteLength(JSON.stringify(raw)) > maxBytes) return fail();
    const parsed = Message.safeParse(raw);
    if (!parsed.success) return fail();
    const message = parsed.data;
    if (message.kind === "response") {
      const entry = pending.get(message.id);
      if (!entry) return fail();
      pending.delete(message.id);
      clearTimeout(entry.timer);
      if (message.ok) entry.resolve(message.result);
      else entry.reject(new RpcError(message.code ?? "WORKER_ERROR"));
      return;
    }
    // IPC preserves ordering; a repeated/lower sequence cannot replay even after bounded history is pruned.
    if (!Number.isSafeInteger(message.id) || message.id <= lastReceived || inbound >= maxPending)
      return fail();
    lastReceived = message.id;
    inbound++;
    try {
      const result = await options.onRequest(message.method, message.payload);
      if (!stopped) send({ kind: "response", id: message.id, ok: true, result: result ?? null });
    } catch (error) {
      const code =
        error instanceof Error &&
        "code" in error &&
        typeof error.code === "string" &&
        /^[A-Z_]{1,64}$/.test(error.code)
          ? error.code
          : "WORKER_ERROR";
      if (!stopped) send({ kind: "response", id: message.id, ok: false, code });
    } finally {
      inbound--;
    }
  }
  const unsubscribe = transport.subscribe((message) => {
    void receive(message).catch(fail);
  });
  const unclose = transport.closed(fail);
  return {
    close,
    get pending() {
      return pending.size;
    },
    get active() {
      return inbound;
    },
    request(method: string, payload: unknown): Promise<unknown> {
      if (stopped) return Promise.reject(new RpcError("DISCONNECTED"));
      if (pending.size >= maxPending) return Promise.reject(new RpcError("CAPACITY_EXHAUSTED"));
      if (!Number.isSafeInteger(nextId + 1))
        return Promise.reject(new RpcError("SEQUENCE_EXHAUSTED"));
      const id = ++nextId;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new RpcError("DEADLINE_EXCEEDED")), timeoutMs);
        pending.set(id, { timer, resolve, reject });
        try {
          send(Message.parse({ kind: "request", id, method, payload }));
        } catch (error) {
          pending.delete(id);
          clearTimeout(timer);
          reject(error);
        }
      });
    },
  };
}

export function processRpcTransport(endpoint: ChildProcess | NodeJS.Process): RpcTransport {
  const failures = new Set<() => void>();
  return {
    send(message) {
      if (!endpoint.send) throw new RpcError("DISCONNECTED");
      endpoint.send(message as Serializable, undefined, undefined, (error) => {
        if (error) for (const fail of failures) fail();
      });
    },
    subscribe(listener) {
      endpoint.on("message", listener);
      return () => {
        endpoint.off("message", listener);
      };
    },
    closed(listener) {
      failures.add(listener);
      endpoint.on("disconnect", listener);
      endpoint.on("error", listener);
      return () => {
        failures.delete(listener);
        endpoint.off("disconnect", listener);
        endpoint.off("error", listener);
      };
    },
  };
}
