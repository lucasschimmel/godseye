import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { isAbsolute, resolve, win32 } from "node:path";
import {
  AttemptIntent,
  AttemptOutcome,
  type CodingCapabilityView,
  type CodingObservation,
  CodingPreparation,
  type CodingPreparationView,
  type CodingProvider,
  type CodingProviderRequest,
  CodingQualification,
  CodingResult,
  type UsageAttemptReporter,
} from "@godseye/contracts";
import { z } from "zod";
import { CodingProtocolParser } from "./coding-protocol.js";
import { readPrivateJson } from "./private-json.js";

const Hash = z.string().regex(/^[a-f0-9]{64}$/);
const Broker = z
  .object({
    runner: z.enum(["codex", "claude-code"]),
    model: z.enum(["gpt-5.4-mini", "claude-haiku-5-5"]),
    apiKey: z
      .string()
      .min(16)
      .max(1024)
      .regex(/^[\x21-\x7e]+$/),
    maxRequests: z.number().int().min(1).max(16),
    maxRequestBytes: z.number().int().min(1).max(262144),
    maxResponseBytes: z.number().int().min(1).max(786432),
    maxOutputTokens: z.number().int().min(1).max(4096),
    requestTimeoutSeconds: z.number().int().min(1).max(60),
  })
  .strict();
const Binding = z
  .object({
    projectId: z.string().uuid(),
    environmentId: z.string().uuid(),
    repositoryHash: Hash,
    sourceDirectory: z.string().min(1).max(4096).regex(/^\//),
    runner: z.enum(["codex", "claude-code"]),
    broker: Broker,
  })
  .strict()
  .refine(
    (value) =>
      value.runner === value.broker.runner &&
      value.broker.model === (value.runner === "codex" ? "gpt-5.4-mini" : "claude-haiku-5-5"),
    "Broker runner differs",
  );
export const CodingPrivateConfiguration = z
  .object({
    version: z.literal(1),
    workspace: z.string().min(1).max(4096),
    distro: z.literal("Ubuntu"),
    capacity: z
      .object({
        memoryMiB: z.number().int().positive().max(65536),
        cpuMilliCores: z.number().int().positive().max(64000),
        maxProcesses: z.number().int().positive().max(4096),
        diskMiB: z.number().int().positive().max(262144),
        vmmOverheadMiB: z.number().int().positive().max(32768),
      })
      .strict(),
    bindings: z.array(Binding).min(1).max(64),
  })
  .strict();
export type CodingPrivateConfigurationView = z.infer<typeof CodingPrivateConfiguration>;
type Context = {
  signal: AbortSignal;
  assertActive(): Promise<void>;
  attempts?: UsageAttemptReporter;
};
const MAX_NATIVE_BYTES = 4 * 1048576;
const ChildResult = z
  .object({
    code: z.number().int().min(0).max(255).nullable(),
    stdout: z.string().max(1048576),
    stderr: z.string().max(1048576),
  })
  .strict();
const GuestResult = z
  .object({
    kind: z.literal("coding.guest.result"),
    runner: z.enum(["codex", "claude-code"]),
    commitSha: z.string().regex(/^[a-f0-9]{40}$/),
    cli: ChildResult,
    patch: z.string().max(131072),
    patchSha256: Hash,
    treeHash: Hash,
    test: ChildResult.nullable(),
    worktree: z.string().max(4096),
  })
  .strict();
const Envelope = z.object({
  attempts: z.array(AttemptOutcome).max(64).optional(),
  state: z.enum(["succeeded", "failed", "cancelled", "unknown"]),
  taskId: z.string().uuid(),
  stopped: z.boolean(),
  grantsRevoked: z.boolean(),
  workspace: z.enum(["retained", "released", "quarantined"]),
  reason: z.string().max(4096).optional(),
  receipt: CodingQualification.optional(),
  guestResult: GuestResult.optional(),
});
const unavailable = (): CodingObservation => ({
  state: "unknown",
  stopped: false,
  grantsRevoked: false,
  workspace: "quarantined",
  reason: "Native coding lifecycle evidence unavailable",
});
const sha = (content: string) => createHash("sha256").update(content).digest("hex");
function artifactId(taskId: string, kind: string): string {
  const bytes = createHash("sha256").update(`${taskId}:${kind}`).digest();
  bytes[6] = ((bytes[6] ?? 0) & 15) | 64;
  bytes[8] = ((bytes[8] ?? 0) & 63) | 128;
  const hex = bytes.subarray(0, 16).toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
function hostEnvironment(): NodeJS.ProcessEnv {
  const keys = ["SystemRoot", "WINDIR", "TEMP", "TMP", "USERPROFILE", "LOCALAPPDATA"];
  return {
    ...Object.fromEntries(
      keys.filter((key) => process.env[key] !== undefined).map((key) => [key, process.env[key]]),
    ),
    PATH: "/usr/bin:/bin",
  };
}
function windowsWslExecutable(): string {
  const systemRoot = process.env.SystemRoot ?? "C:\\Windows";
  if (!/^[A-Za-z]:[\\/]/.test(systemRoot))
    throw new Error("Coding Windows system directory unavailable");
  return win32.join(systemRoot, "System32", "wsl.exe");
}
async function localPath(path: string, distro: string): Promise<string> {
  if (process.platform !== "win32") return path;
  return await new Promise((accept, reject) => {
    const child = spawn(
      windowsWslExecutable(),
      ["-d", distro, "--exec", "/usr/bin/wslpath", "-u", path],
      {
        env: hostEnvironment(),
        windowsHide: true,
      },
    );
    let output = "";
    const timer = setTimeout(() => child.kill(), 10000);
    child.stdout.on("data", (chunk) => {
      output += String(chunk);
      if (output.length > 8192) child.kill();
    });
    child.stderr.resume();
    child.once("error", () => {
      clearTimeout(timer);
      reject(new Error("Coding Linux path unavailable"));
    });
    child.once("close", (code) => {
      clearTimeout(timer);
      if (code === 0 && output.trim().startsWith("/")) accept(output.trim());
      else reject(new Error("Coding Linux path unavailable"));
    });
  });
}

/** Strict private KVM adapter. It never launches CLI, Git or project code on the host. */
export async function createCodingProvider(
  raw: CodingPrivateConfigurationView,
): Promise<CodingProvider> {
  const config = CodingPrivateConfiguration.parse(raw);
  if (!isAbsolute(config.workspace)) throw new Error("Coding workspace must be absolute");
  const identities = config.bindings.map(
    (b) => `${b.projectId}:${b.environmentId}:${b.repositoryHash}:${b.runner}`,
  );
  if (new Set(identities).size !== identities.length)
    throw new Error("Duplicate coding private binding");
  const workspace = await localPath(resolve(config.workspace), config.distro);
  let ready = false;
  let versions: Record<string, string> = {};
  function binding(preparation: CodingPreparationView) {
    const value = config.bindings.find(
      (b) =>
        b.projectId === preparation.projectId &&
        b.environmentId === preparation.environmentId &&
        b.repositoryHash === preparation.repositoryHash &&
        b.runner === preparation.runner,
    );
    if (!value) throw new Error("Coding task has no exact private binding");
    return value;
  }
  // The extra IPC frames make every physical dispatch and model POST await the
  // current Foundation grant/epoch/lease, instead of trusting guest assertions.
  async function command(
    action: string,
    document: unknown,
    signal: AbortSignal,
    context?: Context,
  ): Promise<unknown> {
    if (signal.aborted) throw new Error("Coding request revoked");
    return await new Promise((accept, reject) => {
      const argv = ["-I", `${workspace}/scripts/coding_guest_control.py`, workspace, action];
      const child =
        process.platform === "win32"
          ? spawn(
              windowsWslExecutable(),
              ["-d", config.distro, "--exec", "/usr/bin/python3", ...argv],
              {
                env: hostEnvironment(),
                windowsHide: true,
              },
            )
          : spawn("/usr/bin/python3", argv, { env: hostEnvironment(), windowsHide: true });
      let bytes = 0,
        pending = "",
        authorizations = 0,
        final: unknown;
      let failure = false;
      let queue = Promise.resolve();
      const stop = () => {
        failure = true;
        child.stdin.end();
        if (!context) child.kill();
      };
      signal.addEventListener("abort", stop, { once: true });
      const duration = action === "run" ? 930000 : 30000;
      const timer = setTimeout(() => {
        failure = true;
        child.stdin.end();
        child.kill();
      }, duration);
      child.stderr.on("data", (chunk) => {
        bytes += chunk.length;
        if (bytes > MAX_NATIVE_BYTES) {
          failure = true;
          child.kill();
        }
      });
      child.stdout.on("data", (chunk) => {
        bytes += chunk.length;
        if (bytes > MAX_NATIVE_BYTES) {
          failure = true;
          child.kill();
          return;
        }
        pending += String(chunk);
        let newline = pending.indexOf("\n");
        while (newline >= 0) {
          const line = pending.slice(0, newline);
          pending = pending.slice(newline + 1);
          queue = queue
            .then(async () => {
              const frame: unknown = JSON.parse(line);
              if (
                frame &&
                typeof frame === "object" &&
                "kind" in frame &&
                frame.kind === "authorize"
              ) {
                const request = (document as { request: CodingProviderRequest }).request;
                const auth = z
                  .object({
                    kind: z.literal("authorize"),
                    correlationId: z.string().uuid(),
                    sequence: z.number().int().min(1).max(128),
                  })
                  .strict()
                  .parse(frame);
                if (
                  !context ||
                  auth.sequence !== ++authorizations ||
                  auth.correlationId !== request.correlationId ||
                  final !== undefined
                )
                  throw new Error("Native coding authorization differs");
                await context.assertActive();
                if (signal.aborted || failure || child.stdin.destroyed)
                  throw new Error("Coding authorization revoked");
                child.stdin.write(`${JSON.stringify({ ...auth, kind: "authorized" })}\n`);
              } else if (
                frame &&
                typeof frame === "object" &&
                "kind" in frame &&
                (frame.kind === "attempt-intent" || frame.kind === "attempt-outcome")
              ) {
                const auth = z
                  .object({
                    kind: z.enum(["attempt-intent", "attempt-outcome"]),
                    correlationId: z.string().uuid(),
                    sequence: z.number().int().min(1).max(128),
                    payload: z.unknown(),
                  })
                  .strict()
                  .parse(frame);
                const request = (document as { request: CodingProviderRequest }).request;
                if (
                  !context?.attempts ||
                  auth.sequence !== ++authorizations ||
                  auth.correlationId !== request.correlationId ||
                  final !== undefined
                )
                  throw new Error("Native attempt identity differs");
                if (auth.kind === "attempt-intent") {
                  await context.assertActive();
                  await context.attempts.intent(AttemptIntent.parse(auth.payload));
                } else await context.attempts.outcome(AttemptOutcome.parse(auth.payload));
                if (child.stdin.destroyed) throw new Error("Native accounting channel closed");
                child.stdin.write(
                  `${JSON.stringify({ kind: "authorized", correlationId: auth.correlationId, sequence: auth.sequence })}\n`,
                );
              } else {
                if (final !== undefined) throw new Error("Repeated native coding result");
                final = frame;
              }
            })
            .catch(() => {
              failure = true;
              child.stdin.end();
              child.kill();
            });
          newline = pending.indexOf("\n");
        }
      });
      child.once("error", () => {
        failure = true;
      });
      child.once("close", (code) => {
        void queue.finally(() => {
          clearTimeout(timer);
          signal.removeEventListener("abort", stop);
          if (failure || code !== 0 || pending.trim() || final === undefined)
            reject(new Error("Coding native action unavailable"));
          else accept(final);
        });
      });
      child.stdin.write(`${JSON.stringify(document)}\n`);
      if (!context) child.stdin.end();
    });
  }
  async function refresh(): Promise<void> {
    const result = z
      .object({
        available: z.boolean(),
        reason: z.string(),
        versions: z.record(z.string(), z.string()),
      })
      .parse(
        await command(
          "readiness",
          { bindings: config.bindings, capacity: config.capacity },
          AbortSignal.timeout(30000),
        ),
      );
    ready = result.available;
    versions = result.versions;
  }
  try {
    await refresh();
  } catch {
    ready = false;
  }
  async function preflight(preparation: CodingPreparationView, signal: AbortSignal) {
    CodingPreparation.parse(preparation);
    await refresh();
    if (!ready || signal.aborted) throw new Error("Coding KVM chain unavailable");
    const q = CodingQualification.parse(
      await command(
        "preflight",
        { request: { preparation }, binding: binding(preparation) },
        signal,
      ),
    );
    const now = Date.now();
    if (
      q.preparationHash !== preparation.hash ||
      q.repositoryHash !== preparation.repositoryHash ||
      q.commitSha !== preparation.commitSha ||
      q.runner !== preparation.runner ||
      q.network !== "broker-only" ||
      Date.parse(q.observedAt) > now ||
      Date.parse(q.expiresAt) <= now ||
      q.resources.memoryMiB + config.capacity.vmmOverheadMiB > config.capacity.memoryMiB ||
      q.resources.cpuMilliCores > config.capacity.cpuMilliCores ||
      q.resources.maxProcesses > config.capacity.maxProcesses ||
      q.resources.diskMiB > config.capacity.diskMiB
    )
      throw new Error("Coding qualification or pool differs");
    return q;
  }
  function observation(rawEnvelope: unknown, request: CodingProviderRequest): CodingObservation {
    const envelope = Envelope.parse(rawEnvelope);
    if (envelope.taskId !== request.taskId) return unavailable();
    const value: CodingObservation = {
      attempts: envelope.attempts,
      state: envelope.state,
      stopped: envelope.stopped,
      grantsRevoked: envelope.grantsRevoked,
      workspace: envelope.workspace,
      ...(envelope.reason ? { reason: "Native coding action did not complete cleanly" } : {}),
    };
    if (!envelope.stopped || !envelope.grantsRevoked)
      return { ...value, state: "unknown", workspace: "quarantined" };
    if (envelope.state !== "succeeded") return value;
    const guest = envelope.guestResult,
      q = envelope.receipt,
      p = request.preparation;
    if (
      !guest ||
      !q ||
      q.preparationHash !== p.hash ||
      q.repositoryHash !== p.repositoryHash ||
      q.commitSha !== p.commitSha ||
      q.runner !== p.runner ||
      guest.runner !== p.runner ||
      guest.commitSha !== p.commitSha ||
      Buffer.byteLength(guest.patch) > p.limits.maxPatchBytes ||
      sha(guest.patch) !== guest.patchSha256
    )
      throw new Error("Coding result source binding differs");
    const parser = new CodingProtocolParser(p.runner, p.limits.maxOutputBytes);
    for (const line of guest.cli.stdout.split("\n")) if (line) parser.push(`${line}\n`);
    const decoded = parser.finish(guest.cli.code);
    const log = guest.test ? `${guest.test.stdout}${guest.test.stderr}` : "";
    if (
      Buffer.byteLength(log) > p.limits.maxOutputBytes ||
      (p.testProfile !== "none" && guest.test?.code == null) ||
      (p.testProfile === "none" && guest.test)
    )
      throw new Error("Coding trusted test evidence differs");
    const artifact = (kind: "patch" | "test-log", content: string) => ({
      id: artifactId(request.taskId, kind),
      kind,
      content,
      bytes: Buffer.byteLength(content),
      sha256: sha(content),
    });
    value.result = CodingResult.parse({
      taskId: request.taskId,
      worktreeId: request.worktreeId,
      preparationHash: p.hash,
      commitSha: p.commitSha,
      summary: decoded.summary,
      patch: artifact("patch", guest.patch),
      tests: [
        {
          profile: p.testProfile,
          status:
            p.testProfile === "none" ? "not-run" : guest.test?.code === 0 ? "passed" : "failed",
          exitCode: guest.test?.code ?? null,
          log: guest.test ? artifact("test-log", log) : null,
        },
      ],
      preview: {
        state: p.previewRequested ? "unavailable" : "not-requested",
        reason: p.previewRequested ? "No independently admitted preview delivery" : null,
      },
      usage: {
        inputTokens: decoded.inputTokens,
        outputTokens: decoded.outputTokens,
        costMicros: null,
        accounting: "reserved-conservatively",
      },
    });
    return value;
  }
  return {
    get qualified() {
      return ready;
    },
    capabilities: () =>
      (["codex", "claude-code"] as const).map(
        (runner): CodingCapabilityView => ({
          runner,
          available: ready && config.bindings.some((b) => b.runner === runner),
          version: versions[runner] ?? null,
          reason: ready
            ? "API broker configured; each task requires fresh source, KVM and budget checks"
            : "Complete native KVM/CLI/broker chain unavailable",
          isolation: "disposable-kvm",
          billing: ready ? "bounded-api" : "unavailable",
          auth: "task-scoped-broker",
        }),
      ),
    verifySource: async (preparation, signal) =>
      z
        .object({ repositoryHash: Hash, commitSha: z.string().regex(/^[a-f0-9]{40}$/) })
        .parse(
          await command(
            "source",
            { request: { preparation }, binding: binding(preparation) },
            signal,
          ),
        ),
    preflight,
    submit: async (request, context) => {
      try {
        await preflight(request.preparation, context.signal);
        await context.assertActive();
        const onAbort = () => {
          void command(
            "stop",
            { request, binding: binding(request.preparation) },
            AbortSignal.timeout(30000),
          ).catch(() => undefined);
        };
        context.signal.addEventListener("abort", onAbort, { once: true });
        try {
          return observation(
            await command(
              "run",
              { request, binding: binding(request.preparation) },
              context.signal,
              context,
            ),
            request,
          );
        } finally {
          context.signal.removeEventListener("abort", onAbort);
        }
      } catch {
        return unavailable();
      }
    },
    inspect: async (request, signal) => {
      try {
        return observation(
          await command("inspect", { request, binding: binding(request.preparation) }, signal),
          request,
        );
      } catch {
        return unavailable();
      }
    },
    stop: async (request, signal) => {
      try {
        return observation(
          await command("stop", { request, binding: binding(request.preparation) }, signal),
          request,
        );
      } catch {
        return unavailable();
      }
    },
  };
}

/** Opt-in only. No vendor key, source directory or proof is inferred from global CLI homes. */
export async function configuredCodingProvider(
  environment: NodeJS.ProcessEnv = process.env,
): Promise<{ provider?: CodingProvider; capacity?: CodingPrivateConfigurationView["capacity"] }> {
  if (!environment.GODSEYE_CODING_BINDINGS_FILE) return {};
  try {
    const config = CodingPrivateConfiguration.parse(
      readPrivateJson(environment.GODSEYE_CODING_BINDINGS_FILE),
    );
    return { provider: await createCodingProvider(config), capacity: config.capacity };
  } catch {
    throw new Error("Private coding runtime configuration is unavailable or invalid");
  }
}
