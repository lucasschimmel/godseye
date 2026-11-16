import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { AgentToolCall, AttemptIntent, AttemptOutcome } from "@godseye/contracts";
import { z } from "zod";
import type {
  AgentObservation,
  AgentProvider,
  AgentProviderContext,
  AgentProviderProfile,
  AgentProviderRequest,
} from "../../../packages/core/src/agents-provider.js";
import { readPrivateJson } from "./private-json.js";

const Binding = z
  .object({
    projectId: z.string().uuid(),
    environmentId: z.string().uuid(),
    role: z.enum(["operations", "security", "research-marketing"]),
    apiKey: z
      .string()
      .min(16)
      .max(1024)
      .regex(/^[\x21-\x7e]+$/),
  })
  .strict();
export type HermesBinding = z.infer<typeof Binding>;
const Observation = z
  .object({
    attempts: z.array(AttemptOutcome).max(64).optional(),
    state: z.enum(["running", "succeeded", "failed", "cancelled", "unknown"]),
    providerRunId: z
      .string()
      .regex(/^run_[a-f0-9]{32}$/)
      .nullable(),
    stopped: z.boolean(),
    output: z.string().max(32768).optional(),
    inputTokens: z.number().int().nonnegative().max(1_000_000).optional(),
    outputTokens: z.number().int().nonnegative().max(1_000_000).optional(),
  })
  .strict();
const Frame = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("attempt-intent"),
      taskId: z.string().uuid(),
      sequence: z.number().int().min(1).max(128),
      attempt: AttemptIntent,
    })
    .strict(),
  z
    .object({
      kind: z.literal("attempt-outcome"),
      taskId: z.string().uuid(),
      sequence: z.number().int().min(1).max(128),
      outcome: AttemptOutcome,
    })
    .strict(),
  z
    .object({
      kind: z.literal("authorize"),
      taskId: z.string().uuid(),
      sequence: z.number().int().min(1).max(128),
    })
    .strict(),
  z.object({ kind: z.literal("observation"), observation: Observation }).strict(),
  z.object({ kind: z.literal("prepare-tools"), sequence: z.number().int().min(1).max(4) }).strict(),
  z
    .object({
      kind: z.literal("tool-call"),
      sequence: z.number().int().min(1).max(4),
      call: AgentToolCall,
    })
    .strict(),
  z
    .object({
      kind: z.literal("event"),
      event: z
        .object({
          type: z.literal("text.delta"),
          sequence: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
          providerRunId: z.string().regex(/^run_[a-f0-9]{32}$/),
          text: z
            .string()
            .min(1)
            .refine((text) => Buffer.byteLength(text) <= 4096),
        })
        .strict(),
    })
    .strict(),
]);
const defaults = { deadlineMs: 30_000, lineBytes: 262144, authorizationCount: 128 } as const;
const unknown = (providerRunId: string | null = null): AgentObservation => ({
  state: "unknown",
  providerRunId,
  stopped: false,
});

export interface HermesProviderOptions {
  bindings: HermesBinding[];
  workspace?: string;
  distro?: string;
  /** Test-only programmatic option. Never read from owner HTTP input or environment. */
  fixtureBaseUrl?: string;
}
export interface ManagedHermesProvider extends AgentProvider {
  close(): Promise<void>;
}
interface Runtime {
  child: ChildProcessWithoutNullStreams;
  observation: AgentObservation;
  closed: Promise<void>;
}

function hostEnvironment(): NodeJS.ProcessEnv {
  const allowed = [
    "PATH",
    "Path",
    "SystemRoot",
    "WINDIR",
    "TEMP",
    "TMP",
    "USERPROFILE",
    "LOCALAPPDATA",
  ];
  return Object.fromEntries(
    allowed.filter((key) => process.env[key] !== undefined).map((key) => [key, process.env[key]]),
  );
}

async function nativePath(path: string, distro: string): Promise<string> {
  if (process.platform !== "win32") return path;
  return new Promise((accept, reject) => {
    const child = spawn("wsl.exe", ["-d", distro, "--exec", "/usr/bin/wslpath", "-u", path], {
      env: hostEnvironment(),
      windowsHide: true,
    });
    let value = "";
    const timer = setTimeout(() => child.kill(), defaults.deadlineMs);
    child.stdout.on("data", (chunk) => {
      value += String(chunk);
      if (value.length > 8192) child.kill();
    });
    child.stderr.resume();
    child.once("error", () => {
      clearTimeout(timer);
      reject(new Error("Local Hermes host unavailable"));
    });
    child.once("close", (code) => {
      clearTimeout(timer);
      if (code === 0) accept(value.trim());
      else reject(new Error("Local Hermes path unavailable"));
    });
  });
}

/** Private first-party provider: exact scoped bindings and actual pinned Hermes, no public tool API. */
export function createHermesProvider(options: HermesProviderOptions): ManagedHermesProvider {
  const bindings = z.array(Binding).min(1).max(64).parse(options.bindings);
  const workspace = resolve(options.workspace ?? process.cwd());
  const distro = options.distro ?? "Ubuntu";
  if (!/^[A-Za-z0-9_.-]{1,64}$/.test(distro)) throw new Error("Invalid Hermes WSL distribution");
  if (options.fixtureBaseUrl) {
    const url = new URL(options.fixtureBaseUrl);
    if (
      url.protocol !== "http:" ||
      url.hostname !== "127.0.0.1" ||
      !url.port ||
      url.pathname.replace(/\/$/, "") !== "/v1" ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    )
      throw new Error("Only explicit local Hermes qualification fixtures are accepted");
  }
  const identities = bindings.map(
    (binding) => `${binding.projectId}:${binding.environmentId}:${binding.role}`,
  );
  if (new Set(identities).size !== identities.length)
    throw new Error("Duplicate scoped Hermes binding");
  const runtimes = new Map<string, Runtime>();
  const bindingFor = (profile: AgentProviderProfile) =>
    bindings.find(
      (value) =>
        value.projectId === profile.projectId &&
        value.environmentId === profile.environmentId &&
        value.role === profile.role,
    );
  const supports = (profile: AgentProviderProfile) =>
    !!bindingFor(profile) &&
    profile.model === "gpt-6-luna" &&
    (profile.tools.length === 0 || !!profile.toolPolicy) &&
    profile.limits.maxRequests >= 1 &&
    profile.limits.maxRequests <= (profile.toolPolicy ? 4 : 1) &&
    profile.limits.maxTurns === profile.limits.maxRequests;

  async function command(
    action: "start" | "inspect" | "stop",
    request: AgentProviderRequest,
    context?: AgentProviderContext,
  ): Promise<AgentObservation> {
    // One lexical runtime owner retains pipe framing, late authorization and actual-close cleanup.
    // Keeping those callbacks together avoids releasing a task's live process on an HTTP timeout.
    const binding = bindingFor(request.profile);
    if (!binding || !supports(request.profile)) throw new Error("Hermes scope is unavailable");
    if (context) await context.assertActive();
    const [localWorkspace, script] = await Promise.all([
      nativePath(workspace, distro),
      nativePath(resolve(workspace, "scripts/hermes_gateway.py"), distro),
    ]);
    if (context) await context.assertActive();
    const child = spawn(
      process.platform === "win32" ? "wsl.exe" : "/usr/bin/python3",
      process.platform === "win32"
        ? ["-d", distro, "--exec", "/usr/bin/python3", script]
        : [script],
      { env: hostEnvironment(), windowsHide: true, stdio: "pipe", cwd: workspace },
    );
    let line = "",
      sequence = 0,
      settled = false;
    let eventSequence = -1;
    let progressPending = false;
    let progressFailed = false;
    let progressSettled: Promise<void> = Promise.resolve();
    let toolSequence = 0,
      toolPending = false,
      toolsPrepared = false;
    let toolSettled: Promise<void> = Promise.resolve();
    let resolveClosed: () => void = () => undefined;
    const runtime: Runtime = {
      child,
      observation: unknown(request.providerRunId),
      closed: new Promise<void>((done) => {
        resolveClosed = done;
      }),
    };
    if (action === "start") runtimes.set(request.taskId, runtime);
    child.stdout.setEncoding("utf8");
    const stop = () => {
      if (!child.stdin.destroyed) child.stdin.write('{"kind":"stop"}\n');
    };
    if (context) context.signal.addEventListener("abort", stop, { once: true });
    const result = new Promise<AgentObservation>((accept) => {
      const finish = (value: AgentObservation) => {
        if (!settled) {
          settled = true;
          accept(value);
        }
      };
      child.stdout.on("data", (chunk) => {
        line += String(chunk);
        if (Buffer.byteLength(line) > defaults.lineBytes) {
          stop();
          child.stdout.pause();
          finish(unknown(runtime.observation.providerRunId));
          return;
        }
        let index = line.indexOf("\n");
        while (index !== -1) {
          const raw = line.slice(0, index);
          line = line.slice(index + 1);
          try {
            const frame = Frame.parse(JSON.parse(raw));
            if (frame.kind === "observation") {
              if (progressPending) throw new Error("Progress publication is still pending");
              runtime.observation = progressFailed
                ? unknown(frame.observation.providerRunId)
                : frame.observation;
              finish(runtime.observation);
            } else if (frame.kind === "event") {
              const event = frame.event;
              if (
                !context ||
                progressPending ||
                progressFailed ||
                event.providerRunId !== runtime.observation.providerRunId ||
                event.sequence <= eventSequence
              )
                throw new Error("Invalid native progress identity");
              progressPending = true;
              eventSequence = event.sequence;
              progressSettled = (async () => {
                let allowed = false;
                try {
                  await context.assertActive();
                  if (context.signal.aborted) throw new Error("Progress authority ended");
                  await context.onEvent?.(event);
                  await context.assertActive();
                  if (context.signal.aborted) throw new Error("Progress authority ended");
                  allowed = true;
                } catch {
                  progressFailed = true;
                  runtime.observation = unknown(runtime.observation.providerRunId);
                  stop();
                } finally {
                  progressPending = false;
                  if (!child.stdin.destroyed)
                    child.stdin.write(
                      `${JSON.stringify({ kind: "event-ack", sequence: event.sequence, allowed })}\n`,
                    );
                }
              })();
            } else if (frame.kind === "prepare-tools" || frame.kind === "tool-call") {
              if (
                !context ||
                !request.toolGrant ||
                toolPending ||
                frame.sequence !== toolSequence + 1
              )
                throw new Error("Invalid native tool callback identity");
              toolSequence = frame.sequence;
              toolPending = true;
              toolSettled = (async () => {
                let allowed = false,
                  result: string | undefined;
                try {
                  await context.assertActive();
                  if (context.signal.aborted) throw new Error("Tool callback cancelled");
                  if (frame.kind === "prepare-tools") {
                    if (toolsPrepared || !context.prepareTools)
                      throw new Error("Tool preparation unavailable");
                    await context.prepareTools();
                    toolsPrepared = true;
                  } else {
                    if (!toolsPrepared || !context.onToolCall)
                      throw new Error("Tool authority unavailable");
                    result = await context.onToolCall(frame.call);
                    if (Buffer.byteLength(result) > 32768) throw new Error("Tool result exceeded");
                  }
                  await context.assertActive();
                  allowed = !context.signal.aborted;
                } catch {
                  allowed = false;
                } finally {
                  toolPending = false;
                  if (!child.stdin.destroyed)
                    child.stdin.write(
                      `${JSON.stringify({ kind: "tool-ack", sequence: frame.sequence, allowed, ...(result !== undefined && allowed ? { result } : {}) })}\n`,
                    );
                }
              })();
            } else if (frame.kind === "attempt-intent" || frame.kind === "attempt-outcome") {
              if (
                !context?.attempts ||
                frame.taskId !== request.taskId ||
                frame.sequence <= sequence ||
                frame.sequence > defaults.authorizationCount
              )
                throw new Error("Invalid attempt callback");
              sequence = frame.sequence;
              const attempts = context.attempts;
              const accounting =
                frame.kind === "attempt-intent"
                  ? context.assertActive().then(() => attempts.intent(frame.attempt))
                  : context.attempts.outcome(frame.outcome);
              void accounting
                .then(() => {
                  if (!child.stdin.destroyed)
                    child.stdin.write(
                      `${JSON.stringify({ kind: "authorization", sequence: frame.sequence, allowed: frame.kind === "attempt-outcome" || !context.signal.aborted })}\n`,
                    );
                })
                .catch(() => {
                  stop();
                  if (!child.stdin.destroyed)
                    child.stdin.write(
                      `${JSON.stringify({ kind: "authorization", sequence: frame.sequence, allowed: false })}\n`,
                    );
                });
            } else {
              if (
                !context ||
                frame.taskId !== request.taskId ||
                frame.sequence <= sequence ||
                frame.sequence > defaults.authorizationCount
              ) {
                stop();
                finish(unknown(runtime.observation.providerRunId));
                return;
              }
              sequence = frame.sequence;
              void context
                .assertActive()
                .then(() => {
                  if (!child.stdin.destroyed)
                    child.stdin.write(
                      `${JSON.stringify({ kind: "authorization", sequence: frame.sequence, allowed: !context.signal.aborted })}\n`,
                    );
                })
                .catch(() => {
                  if (!child.stdin.destroyed)
                    child.stdin.write(
                      `${JSON.stringify({ kind: "authorization", sequence: frame.sequence, allowed: false })}\n`,
                    );
                });
            }
          } catch {
            stop();
            finish(unknown(runtime.observation.providerRunId));
            return;
          }
          index = line.indexOf("\n");
        }
      });
      child.stderr.resume();
      child.stdin.on("error", () => finish(unknown(runtime.observation.providerRunId)));
      child.once("error", () => {
        finish(unknown(runtime.observation.providerRunId));
        resolveClosed();
      });
      child.once("close", () => {
        context?.signal.removeEventListener("abort", stop);
        void Promise.all([progressSettled, toolSettled]).finally(() => {
          if (runtimes.get(request.taskId) === runtime) runtimes.delete(request.taskId);
          finish(runtime.observation);
          resolveClosed();
        });
      });
    });
    const payload = JSON.stringify({
      workspace: localWorkspace,
      action,
      request,
      ...(action === "start"
        ? {
            providerKey: binding.apiKey,
            ...(options.fixtureBaseUrl ? { fixtureBaseUrl: options.fixtureBaseUrl } : {}),
          }
        : {}),
    });
    if (action === "start") child.stdin.write(`${payload}\n`);
    else child.stdin.end(`${payload}\n`);
    return result;
  }

  return {
    qualified: true,
    supports,
    submit: (request, context) => command("start", request, context),
    inspect: async (request, signal) => {
      if (signal.aborted) return unknown(request.providerRunId);
      const runtime = runtimes.get(request.taskId);
      return runtime?.observation ?? command("inspect", request);
    },
    stop: async (request, signal) => {
      const runtime = runtimes.get(request.taskId);
      if (runtime && !runtime.child.stdin.destroyed) runtime.child.stdin.write('{"kind":"stop"}\n');
      if (signal.aborted) return unknown(request.providerRunId);
      return command("stop", request);
    },
    close: async () => {
      for (const runtime of runtimes.values())
        if (!runtime.child.stdin.destroyed) runtime.child.stdin.end();
      await Promise.all([...runtimes.values()].map((runtime) => runtime.closed));
    },
  };
}

/** Optional private file configuration; never inherits a global OpenAI key from the owner process. */
export function configuredHermesProvider(
  environment: NodeJS.ProcessEnv = process.env,
): ManagedHermesProvider | undefined {
  const path = environment.GODSEYE_HERMES_BINDINGS_FILE;
  if (!path) return undefined;
  // A tmpfs-rendered file is absent while OpenBao is sealed: Hermes is then simply unavailable.
  if (!existsSync(path)) return undefined;
  try {
    return createHermesProvider({
      bindings: z.array(Binding).parse(readPrivateJson(path)),
      distro:
        environment.GODSEYE_HERMES_WSL_DISTRO ?? environment.GODSEYE_PG_WSL_DISTRO ?? "Ubuntu",
    });
  } catch {
    // A JSON parse error can quote private input; only a fixed classification escapes.
    throw new Error("Private Hermes runtime configuration is unavailable or invalid");
  }
}
