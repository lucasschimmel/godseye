import { type ChildProcess, fork } from "node:child_process";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { type WorkerSettings, workerEnvironment } from "./config.js";
import { createRpcPeer, processRpcTransport } from "./ipc.js";

export interface WorkerChild {
  peer: ReturnType<typeof createRpcPeer>;
  child: ChildProcess;
  producerId: string;
  handlers: string[];
  senders: { destination: string; dedupesByEffectKey: boolean; inspect: boolean }[];
  close(): Promise<void>;
}
async function settledWithin(work: Promise<unknown>, timeoutMs: number) {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      work.then(() => true),
      new Promise<false>((resolve) => {
        timer = setTimeout(() => resolve(false), timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
export async function startWorkerChild(
  settings: WorkerSettings,
  options: {
    onRequest(method: string, payload: unknown): Promise<unknown>;
    onFailure(): void;
    kind?: "application" | "platform";
  },
): Promise<WorkerChild> {
  const source = import.meta.url.endsWith(".ts");
  const entry = options.kind === "platform" ? "platform" : "worker";
  const child = fork(
    fileURLToPath(new URL(`./${entry}.${source ? "ts" : "mjs"}`, import.meta.url)),
    [],
    {
      execPath: process.execPath,
      execArgv: source ? ["--import", "tsx"] : [],
      env: workerEnvironment(),
      serialization: "json",
      stdio: ["ignore", "ignore", "ignore", "ipc"],
    },
  );
  let closing: Promise<void> | undefined,
    expectedExit = false;
  const peer = createRpcPeer(processRpcTransport(child), {
    timeoutMs: 86_460_000,
    onRequest: options.onRequest,
    onFailure() {
      if (!expectedExit) options.onFailure();
    },
  });
  const worker: WorkerChild = {
    peer,
    child,
    producerId: "",
    handlers: [],
    senders: [],
    close() {
      closing ??= (async () => {
        expectedExit = true;
        if (child.exitCode === null && child.signalCode === null) {
          const done = once(child, "exit");
          try {
            await settledWithin(peer.request("close", null), 5000);
          } catch {
            /* A disconnected worker is fenced; cleanup still terminates its owned processes. */
          }
          if (!(await settledWithin(done, 5000))) {
            child.kill("SIGTERM");
            if (!(await settledWithin(done, 1000))) {
              child.kill("SIGKILL");
              if (!(await settledWithin(done, 5000))) {
                peer.close();
                throw new Error("Application worker termination could not be confirmed");
              }
            }
          }
        }
        peer.close();
      })();
      return closing;
    },
  };
  child.once("exit", () => {
    if (!expectedExit) options.onFailure();
  });
  try {
    let timer: NodeJS.Timeout | undefined;
    const raw = await (async () => {
      try {
        return await Promise.race([
          peer.request("initialize", settings),
          new Promise<never>((_resolve, reject) => {
            timer = setTimeout(
              () => reject(new Error("Cell initialization deadline exceeded")),
              60_000,
            );
          }),
        ]);
      } finally {
        clearTimeout(timer);
      }
    })();
    const ready = z
      .object({
        producerId: z.string().uuid(),
        handlers: z.array(z.string()).min(1).max(100),
        pid: z.number().int().positive(),
        senders: z
          .array(
            z
              .object({
                destination: z.string().regex(/^[a-z][a-z0-9.-]{0,63}$/),
                dedupesByEffectKey: z.boolean(),
                inspect: z.boolean(),
              })
              .strict(),
          )
          .max(100)
          .default([]),
      })
      .strict()
      .parse(raw);
    if (ready.pid !== child.pid) throw new Error("Application worker process identity mismatch");
    worker.producerId = ready.producerId;
    worker.handlers = ready.handlers;
    worker.senders = ready.senders;
    return worker;
  } catch (error) {
    await worker.close();
    throw error;
  }
}
