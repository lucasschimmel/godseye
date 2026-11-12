import { once } from "node:events";
import { isAbsolute } from "node:path";
import { setTimeout as wait } from "node:timers/promises";
import { pathToFileURL } from "node:url";
import { ApplicationError, openLocalApplication } from "@godseye/app-backend";
import { ApplicationJobEnvelope, JobDefinition, JobRun } from "@godseye/contracts";
import { createInngestCell, type JobHandlerContext } from "@godseye/core";
import { serve } from "@hono/node-server";
import { z } from "zod";
import { startNativeInngest } from "../../control-api/src/inngest-native.js";
import { localStorageUri, WorkerSettings } from "./config.js";
import { createRpcPeer, processRpcTransport, RpcError } from "./ipc.js";
import {
  type ApplicationWorkerModule,
  builtinWorker,
  type CreateApplicationWorker,
} from "./worker-module.js";

const Execution = z
  .object({
    projectId: z.string().uuid(),
    environmentId: z.string().uuid(),
    definition: JobDefinition,
    run: JobRun,
    effectKey: z.string().max(160),
    attemptKey: z.string().max(160),
    event: ApplicationJobEnvelope.optional(),
    reconcile: z.boolean(),
  })
  .strict();
const Delivery = z
  .object({
    effectKey: z.string().min(8).max(128),
    destination: z.string().regex(/^[a-z][a-z0-9.-]{0,63}$/),
    projectId: z.string().uuid(),
    environmentId: z.string().uuid(),
    payload: z.record(z.string(), z.json()),
    attempt: z.number().int().nonnegative(),
  })
  .strict();
let settings: WorkerSettings | undefined;
let backend: Awaited<ReturnType<typeof openLocalApplication>> | undefined;
let integration: ReturnType<typeof createInngestCell> | undefined;
let engine: Awaited<ReturnType<typeof startNativeInngest>> | undefined;
let module: ApplicationWorkerModule = builtinWorker;
const listeners: ReturnType<typeof serve>[] = [];
const abort = new AbortController();
const executions = new Map<string, AbortController>();
let pump: Promise<void> | undefined, closing: Promise<void> | undefined;
function stop() {
  closing ??= (async () => {
    abort.abort();
    for (const controller of executions.values()) controller.abort();
    await engine?.close();
    for (const server of listeners) {
      if ("closeAllConnections" in server) server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
    await pump;
    await backend?.close();
    peer.close();
    if (process.connected) process.disconnect();
  })();
  return closing;
}
function fail() {
  process.exitCode = 1;
  void stop().catch(() => {
    process.exitCode = 1;
    if (process.connected) process.disconnect();
  });
}
const peer = createRpcPeer(processRpcTransport(process), {
  timeoutMs: 120_000,
  onFailure: fail,
  async onRequest(method, payload) {
    if (method === "initialize") return initialize(WorkerSettings.parse(payload));
    if (!settings || !backend || !integration || closing) throw new RpcError("NOT_READY");
    if (method === "read-event")
      return (await backend.readJobEvent(z.string().uuid().parse(payload))) ?? null;
    if (method === "catalog") {
      const definitions = z.array(JobDefinition).max(500).parse(payload);
      integration = buildIntegration(settings, backend.state.store.id, definitions);
      return null;
    }
    if (method === "engine-start") {
      if (engine) throw new RpcError("ALREADY_STARTED");
      const persistence = z
        .object({ postgresUri: z.string(), redisUri: z.string() })
        .strict()
        .parse(payload);
      localStorageUri(persistence.postgresUri, "postgresql:");
      localStorageUri(persistence.redisUri, "redis:");
      engine = await startNativeInngest({
        cell: settings.cell,
        directory: settings.engineDirectory,
        sdkUrl: `http://127.0.0.1:${settings.cell.workerPort}/api/inngest`,
        material: { event: settings.eventKey, signing: settings.signingKey },
        persistence,
        onFailure: fail,
      });
      pump = runBridge();
      void pump.catch(fail);
      return null;
    }
    if (method === "execute") return execute(Execution.parse(payload));
    if (method === "deliver-outbox") {
      const input = z
        .object({ callId: z.string().uuid(), delivery: Delivery, inspect: z.boolean() })
        .strict()
        .parse(payload);
      if (
        input.delivery.projectId !== settings.cell.projectId ||
        input.delivery.environmentId !== settings.cell.environmentId
      )
        throw new RpcError("FORBIDDEN");
      const sender = module.senders?.get(input.delivery.destination);
      if (!sender || (input.inspect && !sender.inspect)) throw new RpcError("METHOD_NOT_ALLOWED");
      const key = `outbox:${input.callId}`;
      if (executions.has(key) || executions.size >= 16) throw new RpcError("CAPACITY_EXHAUSTED");
      const controller = new AbortController();
      executions.set(key, controller);
      try {
        await peer.request("authorize-outbox", input.callId);
        if (controller.signal.aborted) throw new RpcError("FENCED");
        return input.inspect && sender.inspect
          ? await sender.inspect(input.delivery, controller.signal)
          : await sender.send(input.delivery, controller.signal);
      } finally {
        executions.delete(key);
      }
    }
    if (method === "abort") {
      executions.get(z.string().max(160).parse(payload))?.abort();
      return null;
    }
    if (method === "close") {
      setImmediate(() => {
        void stop().catch(fail);
      });
      return null;
    }
    throw new RpcError("METHOD_NOT_ALLOWED");
  },
});

async function initialize(input: WorkerSettings) {
  if (settings || closing) throw new RpcError("ALREADY_STARTED");
  settings = input;
  const scope = { projectId: input.cell.projectId, environmentId: input.cell.environmentId };
  if (input.workerModule) {
    if (!isAbsolute(input.workerModule)) throw new RpcError("INVALID_CONFIGURATION");
    const imported: { createWorker?: CreateApplicationWorker } = await import(
      pathToFileURL(input.workerModule).href
    );
    if (typeof imported.createWorker !== "function") throw new RpcError("INVALID_MODULE");
    module = await imported.createWorker({ scope });
  }
  if (
    !(module.handlers instanceof Map) ||
    !module.handlers.size ||
    module.handlers.size > 100 ||
    [...module.handlers].some(
      ([name, handler]) =>
        !/^[a-z][a-z0-9.-]{0,63}$/.test(name) || typeof handler.execute !== "function",
    )
  )
    throw new RpcError("INVALID_MODULE");
  if (
    module.senders &&
    (!(module.senders instanceof Map) ||
      module.senders.size > 100 ||
      [...module.senders].some(
        ([name, sender]) =>
          !/^[a-z][a-z0-9.-]{0,63}$/.test(name) ||
          typeof sender.send !== "function" ||
          typeof sender.dedupesByEffectKey !== "boolean",
      ))
  )
    throw new RpcError("INVALID_MODULE");
  backend = await openLocalApplication({
    scope,
    directory: input.directory,
    baseUrl: `http://127.0.0.1:${input.cell.applicationPort}`,
    trustedOrigins: input.settings.allowedOrigins,
    registrationEnabled: input.settings.registrationEnabled,
    limits: {
      objectBytes: input.settings.maxFileMiB * 1024 * 1024,
      storageBytes: input.settings.storageMiB * 1024 * 1024,
      maxFiles: input.settings.maxFiles,
      eventRetention: input.settings.eventRetention,
    },
    lifecycle: () =>
      peer
        .request("lifecycle", null)
        .then((value) =>
          z
            .object({ available: z.boolean(), epoch: z.number().int().nonnegative() })
            .strict()
            .parse(value),
        ),
    routes: module.routes,
    jobs: {
      transport: {
        send: (event, signal) => {
          if (!integration) throw new RpcError("NOT_READY");
          return integration.transport.send(event, signal);
        },
        settled: (event, signal) =>
          integration ? integration.transport.settled(event, signal) : Promise.resolve(false),
      },
    },
  });
  integration = buildIntegration(input, backend.state.store.id, []);
  for (const [fetch, port] of [
    [
      (request: Request) => {
        if (!integration) throw new RpcError("NOT_READY");
        return integration.app.fetch(request);
      },
      input.cell.workerPort,
    ],
    [backend.app.fetch, input.cell.applicationPort],
  ] as const) {
    const server = serve({ fetch, port, hostname: "127.0.0.1" });
    listeners.push(server);
    server.once("error", fail);
    if (!server.listening) await once(server, "listening");
  }
  return {
    producerId: backend.state.store.id,
    handlers: [...module.handlers.keys()],
    pid: process.pid,
    senders: [...(module.senders ?? [])].map(([destination, sender]) => ({
      destination,
      dedupesByEffectKey: sender.dedupesByEffectKey,
      inspect: !!sender.inspect,
    })),
  };
}
function buildIntegration(
  input: WorkerSettings,
  producerId: string,
  definitions: z.infer<typeof JobDefinition>[],
) {
  const call = (method: string, value: unknown) => peer.request(method, value);
  const runs = (method: string, value: unknown) =>
    call(method, value).then((raw) => z.array(JobRun).parse(raw));
  return createInngestCell({
    id: `ge-${input.cell.environmentId}`,
    authority: {
      projectId: input.cell.projectId,
      environmentId: input.cell.environmentId,
      producerId,
    },
    baseUrl: `http://127.0.0.1:${input.cell.enginePort}`,
    sdkUrl: `http://127.0.0.1:${input.cell.workerPort}/api/inngest`,
    eventKey: input.eventKey,
    signingKey: input.signingKey,
    cronDefinitions: definitions,
    jobs: {
      ingestApplicationEvent: (_authority, event) => runs("ingest", event),
      applicationEventRuns: (_authority, event) => runs("runs", event),
      applicationEventAccepted: (_authority, event) =>
        call("accepted", event).then((raw) => z.boolean().parse(raw)),
      applicationEventSettled: (_authority, event) =>
        call("settled", event).then((raw) => z.boolean().parse(raw)),
      triggerInngestCron: (_authority, definitionId, hash, eventId) =>
        call("cron", { definitionId, hash, eventId }).then((raw) => JobRun.parse(raw)),
    },
  });
}
async function execute(input: z.infer<typeof Execution>) {
  if (
    !settings ||
    input.projectId !== settings.cell.projectId ||
    input.environmentId !== settings.cell.environmentId ||
    input.definition.projectId !== input.projectId ||
    input.definition.environmentId !== input.environmentId ||
    input.run.projectId !== input.projectId ||
    input.run.environmentId !== input.environmentId ||
    input.run.definitionId !== input.definition.id ||
    executions.has(input.attemptKey) ||
    executions.size >= 16
  )
    throw new RpcError("FORBIDDEN");
  const handler = module.handlers.get(input.definition.handler);
  if (!handler || (input.reconcile && !handler.reconcile)) return { status: "unknown" };
  const controller = new AbortController();
  executions.set(input.attemptKey, controller);
  const context: JobHandlerContext = {
    ...input,
    signal: controller.signal,
    assertActive: async () => {
      await peer.request("check-execution", input.attemptKey);
    },
    assertReconciliation: async () => {
      await peer.request("check-reconciliation", input.attemptKey);
    },
    outbox: (intent) =>
      peer.request("outbox", { attemptKey: input.attemptKey, intent }).then((raw) => {
        // Runtime authority and validation live at the parent-held active execution callback.
        return import("@godseye/contracts").then(({ OutboxIntent }) => OutboxIntent.parse(raw));
      }),
  };
  try {
    await peer.request("authorize-execution", input.attemptKey);
    if (controller.signal.aborted) throw new RpcError("FENCED");
    return input.reconcile && handler.reconcile
      ? await handler.reconcile(context)
      : await handler.execute(context);
  } finally {
    executions.delete(input.attemptKey);
  }
}
async function runBridge() {
  while (!abort.signal.aborted) {
    try {
      await backend?.flushJobs({ signal: abort.signal });
    } catch (error) {
      if (!(error instanceof ApplicationError && error.code === "APPLICATION_UNAVAILABLE"))
        throw error;
    }
    try {
      await wait(1000, undefined, { signal: abort.signal });
    } catch (error) {
      if (!(error instanceof Error && error.name === "AbortError")) throw error;
    }
  }
}
process.once("disconnect", () => {
  void stop().catch(fail);
});
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.once(signal, () => {
    void stop().catch(fail);
  });
