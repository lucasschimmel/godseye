import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { resolve } from "node:path";
import {
  AgentTaskToolSelection,
  AgentToolAllocationObservation,
  AgentToolAllocationRequest,
  AgentToolExecutionRequest,
  type AgentToolExecutor,
  type AgentToolExecutorContext,
  AgentToolObservation,
} from "@godseye/contracts";

const unknown = (): AgentToolAllocationObservation => ({
  state: "unknown",
  receipt: null,
  stopped: false,
});
function canonical(value: unknown): string {
  const normalize = (item: unknown): unknown =>
    Array.isArray(item)
      ? item.map(normalize)
      : item !== null && typeof item === "object"
        ? Object.fromEntries(
            Object.entries(item)
              .sort(([left], [right]) => left.localeCompare(right))
              .map(([key, child]) => [key, normalize(child)]),
          )
        : item;
  return JSON.stringify(normalize(value));
}
export interface HermesToolExecutorOptions {
  workspace?: string;
  distro?: string;
}
export interface ManagedHermesToolExecutor extends AgentToolExecutor {
  close(): Promise<void>;
}
interface OwnedRuntime {
  child: ChildProcessWithoutNullStreams;
  request: AgentToolAllocationRequest;
  observation: AgentToolAllocationObservation;
  ready: Promise<AgentToolAllocationObservation>;
  closed: Promise<void>;
  pending: Map<string, { resolve(value: AgentToolObservation): void; reject(error: Error): void }>;
}
function environment(): NodeJS.ProcessEnv {
  return Object.fromEntries(
    ["PATH", "Path", "SystemRoot", "WINDIR", "TEMP", "TMP", "USERPROFILE", "LOCALAPPDATA"]
      .filter((name) => process.env[name] !== undefined)
      .map((name) => [name, process.env[name]]),
  );
}
function convert(path: string, distro: string): Promise<string> {
  if (process.platform !== "win32") return Promise.resolve(path);
  return new Promise((accept, reject) => {
    const child = spawn("wsl.exe", ["-d", distro, "--exec", "wslpath", "-u", path], {
      env: environment(),
      windowsHide: true,
    });
    let text = "";
    const timer = setTimeout(() => child.kill(), 10_000);
    child.stdout.on("data", (chunk) => {
      text += String(chunk);
      if (text.length > 8192) child.kill();
    });
    child.stderr.resume();
    child.once("error", () => {
      clearTimeout(timer);
      reject(new Error("Native tools path unavailable"));
    });
    child.once("close", (code) => {
      clearTimeout(timer);
      code === 0 && text.length <= 8192
        ? accept(text.trim())
        : reject(new Error("Native tools path refused"));
    });
    child.stdin.end();
  });
}

/** Explicit private first-party executor; no task request can install or root-repair its host. */
export function createHermesToolExecutor(
  options: HermesToolExecutorOptions = {},
): ManagedHermesToolExecutor {
  const workspace = resolve(options.workspace ?? process.cwd()),
    distro = options.distro ?? "Ubuntu";
  if (!/^[A-Za-z0-9_.-]{1,64}$/.test(distro)) throw new Error("Invalid tools WSL distribution");
  const live = new Map<string, OwnedRuntime>();
  const supports = (grant: unknown) => AgentTaskToolSelection.safeParse(grant).success;

  async function open(
    action: "start" | "inspect" | "stop",
    request: AgentToolAllocationRequest,
    context?: AgentToolExecutorContext,
  ): Promise<OwnedRuntime> {
    request = AgentToolAllocationRequest.parse(request);
    if (!supports(request.grant) || request.taskId !== request.correlationId)
      throw new Error("Unsupported tool allocation");
    if (context) await context.assertActive();
    const nativeWorkspace = await convert(workspace, distro);
    if (context) await context.assertActive();
    const script = `${nativeWorkspace}/scripts/hermes_tools_runtime.py`;
    const child = spawn(
      process.platform === "win32" ? "wsl.exe" : "/usr/bin/python3",
      process.platform === "win32"
        ? ["-d", distro, "--exec", "/usr/bin/python3", script]
        : [script],
      { env: environment(), windowsHide: true, stdio: "pipe", cwd: workspace },
    );
    let completeReady: (value: AgentToolAllocationObservation) => void = () => undefined;
    let completeClosed: () => void = () => undefined;
    const runtime: OwnedRuntime = {
      child,
      request,
      observation: unknown(),
      ready: new Promise((done) => {
        completeReady = done;
      }),
      closed: new Promise((done) => {
        completeClosed = done;
      }),
      pending: new Map(),
    };
    const stop = () => {
      if (!child.stdin.destroyed) child.stdin.write('{"kind":"stop"}\n');
    };
    let line = "",
      authorizationPending = false;
    const input = async (raw: string) => {
      const frame: unknown = JSON.parse(raw);
      if (!frame || typeof frame !== "object" || !("kind" in frame))
        throw new Error("Invalid native tools frame");
      const value = frame as Record<string, unknown>;
      if (value.kind === "authorize") {
        if (!context || authorizationPending) throw new Error("Unqualified tools authority");
        authorizationPending = true;
        let allowed = false;
        try {
          await context.assertActive();
          allowed = !context.signal.aborted;
        } catch {
          allowed = false;
        }
        if (!child.stdin.destroyed)
          child.stdin.write(`${JSON.stringify({ kind: "authorization", allowed })}\n`);
      } else if (value.kind === "allocation") {
        const result = AgentToolAllocationObservation.parse(value.observation);
        runtime.observation = result;
        completeReady(result);
      } else if (value.kind === "result") {
        if (typeof value.callId !== "string") throw new Error("Missing native call correlation");
        const pending = runtime.pending.get(value.callId);
        if (!pending) throw new Error("Foreign native call response");
        const result = AgentToolObservation.parse(value.observation);
        if (
          !runtime.observation.receipt ||
          canonical(result.receipt) !== canonical(runtime.observation.receipt)
        )
          throw new Error("Native tool receipt changed");
        runtime.pending.delete(value.callId);
        pending.resolve(result);
      } else throw new Error("Unknown native tools frame");
    };
    let processing = Promise.resolve();
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      line += String(chunk);
      if (Buffer.byteLength(line) > 262144) {
        stop();
        child.stdout.pause();
        return;
      }
      let index = line.indexOf("\n");
      while (index >= 0) {
        const raw = line.slice(0, index);
        line = line.slice(index + 1);
        processing = processing
          .then(() => input(raw))
          .catch(() => {
            runtime.observation = unknown();
            stop();
          });
        index = line.indexOf("\n");
      }
    });
    child.stderr.resume();
    child.stdin.on("error", () => {
      runtime.observation = unknown();
    });
    child.once("error", () => {
      completeReady(unknown());
      completeClosed();
    });
    child.once("close", () => {
      void processing.finally(() => {
        for (const pending of runtime.pending.values())
          pending.reject(new Error("Isolated tools runtime outcome unknown"));
        runtime.pending.clear();
        completeReady(runtime.observation);
        completeClosed();
      });
    });
    if (context) context.signal.addEventListener("abort", stop, { once: true });
    void runtime.closed.then(() => context?.signal.removeEventListener("abort", stop));
    child.stdin.write(`${JSON.stringify({ workspace: nativeWorkspace, action, request })}\n`);
    if (action !== "start") child.stdin.end();
    return runtime;
  }

  return {
    qualified: true,
    supports,
    prepare: async (request, context) => {
      const prior = live.get(request.taskId);
      if (prior) {
        if (canonical(prior.request) !== canonical(request))
          throw new Error("Tool allocation changed");
        return prior.observation;
      }
      const runtime = await open("start", request, context);
      live.set(request.taskId, runtime);
      const result = await runtime.ready;
      await context.assertActive();
      return result;
    },
    execute: async (request: AgentToolExecutionRequest, context) => {
      request = AgentToolExecutionRequest.parse(request);
      const runtime = live.get(request.allocation.taskId);
      if (
        !runtime ||
        canonical(runtime.request) !== canonical(request.allocation) ||
        runtime.observation.state !== "available" ||
        runtime.pending.size
      )
        throw new Error("Isolated tool allocation unavailable");
      await context.assertActive();
      if (context.signal.aborted) throw new Error("Tool authority expired");
      return new Promise((accept, reject) => {
        runtime.pending.set(request.callId, { resolve: accept, reject });
        runtime.child.stdin.write(`${JSON.stringify({ kind: "execute", request })}\n`);
      });
    },
    inspect: async (request, signal) => {
      if (signal.aborted) return unknown();
      const runtime = live.get(request.taskId);
      if (runtime) {
        if (canonical(runtime.request) !== canonical(request))
          throw new Error("Tool inspection scope changed");
        return runtime.observation;
      }
      const reader = await open("inspect", request);
      await reader.closed;
      return reader.observation;
    },
    stop: async (request, signal) => {
      const runtime = live.get(request.taskId);
      if (runtime) {
        if (canonical(runtime.request) !== canonical(request))
          throw new Error("Tool cleanup scope changed");
        runtime.child.stdin.end('{"kind":"stop"}\n');
        await runtime.closed;
        return runtime.observation;
      }
      if (signal.aborted) return unknown();
      const cleanup = await open("stop", request);
      await cleanup.closed;
      return cleanup.observation;
    },
    close: async () => {
      for (const runtime of live.values())
        if (!runtime.child.stdin.destroyed) runtime.child.stdin.end();
      await Promise.all([...live.values()].map((runtime) => runtime.closed));
    },
  };
}

export function configuredHermesToolExecutor(
  environment: NodeJS.ProcessEnv = process.env,
): ManagedHermesToolExecutor | undefined {
  if (environment.GODSEYE_HERMES_TOOLS_ENABLED !== "true") return undefined;
  return createHermesToolExecutor({ distro: environment.GODSEYE_HERMES_WSL_DISTRO ?? "Ubuntu" });
}
