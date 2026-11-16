import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { join, resolve } from "node:path";
import { setTimeout as wait } from "node:timers/promises";
import { createApplicationBackend, openApplicationStore } from "@godseye/app-backend";
import {
  ControlPlane,
  createInngestCell,
  InfrastructureEngine,
  runFoundationWorker,
  runJobScheduler,
} from "@godseye/core";
import { openStore } from "@godseye/store";
import { serve } from "@hono/node-server";
import { z } from "zod";
import { acquireInstance, privateDirectory } from "../../control-api/src/identity/runtime.js";
import { LocalInngestCell } from "../../control-api/src/inngest-config.js";
import {
  openLocalInngestMaterial,
  startNativeInngest,
} from "../../control-api/src/inngest-native.js";

/** Explicit standalone demonstration. It does not open the owner controller store or provision a host. */
async function start() {
  const args = process.argv.slice(2);
  if (args.includes("--help")) {
    process.stdout.write(
      "Local isolated Inngest demonstration: --demo [--name sample] [--directory private-path] [--engine-port 4510] [--worker-port 4511] [--app-port 4512] [--gateway-port 4513] [--gateway-grpc-port 4514] [--executor-grpc-port 4515]\nUses the project-local Inngest1.52.0 binary, private per-cell embedded engine storage and the Foundation executor. Local process separation does not qualify production container isolation.\n",
    );
    return;
  }
  if (!args.includes("--demo")) throw new Error("Explicit --demo is required; use --help");
  args.splice(args.indexOf("--demo"), 1);
  const values = new Map<string, string>();
  const names = [
    "--name",
    "--directory",
    "--engine-port",
    "--worker-port",
    "--app-port",
    "--gateway-port",
    "--gateway-grpc-port",
    "--executor-grpc-port",
  ];
  for (let index = 0; index < args.length; index += 2) {
    const name = args[index],
      value = args[index + 1];
    if (!name || !value || !names.includes(name) || values.has(name))
      throw new Error("Invalid local jobs arguments");
    values.set(name, value);
  }
  const name = z
    .string()
    .regex(/^[a-z][a-z0-9-]{0,40}$/)
    .parse(values.get("--name") ?? "sample");
  const ports = names.slice(2).map((key, index) =>
    z.coerce
      .number()
      .int()
      .min(1024)
      .max(65535)
      .parse(values.get(key) ?? 4510 + index),
  );
  if (new Set(ports).size !== ports.length)
    throw new Error("Every cell listener requires a distinct port");
  const [enginePort, workerPort, appPort, gatewayPort, gatewayGrpcPort, executorGrpcPort] = ports;
  const directory = resolve(values.get("--directory") ?? join(".local", "jobs", name));
  await privateDirectory(directory);
  const release = await acquireInstance(directory);
  const material = await openLocalInngestMaterial(directory);
  const controlDirectory = join(directory, "control");
  await privateDirectory(controlDirectory);
  const store = await openStore({ dataDir: controlDirectory });
  const abort = new AbortController();
  const listeners: ReturnType<typeof serve>[] = [];
  const pumps: Promise<void>[] = [];
  let backend: Awaited<ReturnType<typeof createApplicationBackend>> | undefined;
  let native: Awaited<ReturnType<typeof startNativeInngest>> | undefined;
  let shutting: Promise<void> | undefined;
  const close = () => {
    shutting ??= (async () => {
      abort.abort();
      await native?.close();
      for (const server of listeners) {
        if ("closeAllConnections" in server) server.closeAllConnections();
        await new Promise<void>((done) => server.close(() => done()));
      }
      await Promise.allSettled(pumps);
      await backend?.close();
      await store.close();
      await release();
    })();
    return shutting;
  };
  try {
    const core = new ControlPlane(store);
    const owner = {
      id: "local-operator",
      kind: "owner" as const,
      projectIds: [],
      sessionId: randomUUID(),
      authenticatedAt: new Date().toISOString(),
    };
    const existing = await core.listProjects(owner);
    const project =
      existing[0] ??
      (await core.createProject(
        owner,
        {
          name: `Inngest ${name}`,
          slug: name,
          kind: "worker",
          description: "Standalone local Inngest demonstration",
        },
        `local-demo-project:${name}`,
      ));
    const environment = project.environments.find((entry) => entry.kind === "development");
    if (!environment) throw new Error("Local demonstration environment missing");
    const scope = { projectId: project.id, environmentId: environment.id };
    const infrastructure = new InfrastructureEngine(store, {
      jobs: {
        applicationEventLoader: async (authority, id) => {
          if (
            !backend ||
            authority.projectId !== scope.projectId ||
            authority.environmentId !== scope.environmentId ||
            authority.producerId !== backend.state.store.id
          )
            return undefined;
          return backend.readJobEvent(id);
        },
        inngestEnvironmentIds: new Set([environment.id]),
        handlers: new Map([
          [
            "application.archive",
            {
              async execute(context) {
                if (!context.event)
                  return { status: "failed" as const, evidenceRef: "application:event-missing" };
                return {
                  status: "succeeded" as const,
                  evidenceRef: `application-event:${context.event.id}`,
                };
              },
            },
          ],
        ]),
      },
    });
    await infrastructure.jobs.registerDefinition(
      owner,
      {
        ...scope,
        expectedEnvironmentRevision: environment.revision,
        name: "application-events",
        handler: "application.archive",
        trigger: { kind: "event", eventType: "document.updated" },
        effectPolicy: "read_only",
        limits: { maxConcurrent: 1, maxAttempts: 3, timeoutSeconds: 30, retentionDays: 30 },
      },
      `local-demo-definition:${name}`,
    );
    const applicationDirectory = join(directory, "application");
    await privateDirectory(applicationDirectory);
    const applicationStore = await openApplicationStore({
      scope,
      dataDir: join(applicationDirectory, "database"),
    });
    const authority = { ...scope, producerId: applicationStore.id };
    const baseUrl = `http://127.0.0.1:${enginePort}`,
      sdkUrl = `http://127.0.0.1:${workerPort}/api/inngest`;
    const cell = createInngestCell({
      id: `godseye-${name}`,
      authority,
      jobs: infrastructure.jobs,
      baseUrl,
      sdkUrl,
      eventKey: material.event,
      signingKey: material.signing,
    });
    backend = await createApplicationBackend({
      scope,
      store: applicationStore,
      authMaterial: material.auth,
      filesRoot: join(applicationDirectory, "files"),
      baseUrl: `http://127.0.0.1:${appPort}`,
      trustedOrigins: [],
      lifecycle: () => infrastructure.jobs.cellLifecycle(authority),
      jobs: { transport: cell.transport },
      routes(registry) {
        registry.post(
          "/emit",
          z.object({ payload: z.json() }).strict(),
          z.object({ accepted: z.literal(true) }).strict(),
          async (context) => {
            await context.emitEvent({
              type: "document.updated",
              payload: context.input.payload,
              idempotencyKey: randomUUID(),
            });
            return { accepted: true };
          },
        );
      },
    });
    for (const [fetch, port] of [
      [cell.app.fetch, workerPort],
      [backend.app.fetch, appPort],
    ] as const) {
      const listener = serve({ fetch, hostname: "127.0.0.1", port });
      listeners.push(listener);
      if (!listener.listening) await once(listener, "listening");
    }
    const engineDirectory = join(directory, "engine");
    native = await startNativeInngest({
      cell: LocalInngestCell.parse({
        ...scope,
        enginePort,
        workerPort,
        applicationPort: appPort,
        gatewayPort,
        gatewayGrpcPort,
        executorGrpcPort,
      }),
      directory: engineDirectory,
      sdkUrl,
      material,
      onFailure() {
        if (!abort.signal.aborted) {
          process.exitCode = 1;
          void close();
        }
      },
    });
    pumps.push(
      runFoundationWorker(infrastructure.foundation, {
        workerId: `inngest-demo-${name}`,
        signal: abort.signal,
      }),
    );
    pumps.push(runJobScheduler(infrastructure.jobs, { signal: abort.signal }));
    pumps.push(
      (async () => {
        while (!abort.signal.aborted) {
          await backend?.flushJobs({ signal: abort.signal });
          try {
            await wait(1000, undefined, { signal: abort.signal });
          } catch (error) {
            if (!(error instanceof Error && error.name === "AbortError")) throw error;
          }
        }
      })(),
    );
    for (const pump of pumps)
      void pump.catch(() => {
        process.exitCode = 1;
        void close();
      });
    process.stdout.write(
      `Local Inngest cell ${name}\nEngine: ${baseUrl}\nWorker: ${sdkUrl}\nApplication: http://127.0.0.1:${appPort}\nProject: ${scope.projectId}\nEnvironment: ${scope.environmentId}\nProducer: ${authority.producerId}\nRegister an application user with the SDK, then POST /api/app/v1/custom/emit with {payload:{...}}. The standalone demo archives the event and records a Foundation result; it does not execute arbitrary tenant code.\n`,
    );
    for (const signal of ["SIGINT", "SIGTERM"])
      process.once(signal, () => {
        void close().catch(() => {
          process.exitCode = 1;
        });
      });
  } catch (error) {
    await close();
    throw error;
  }
}
void start().catch((error: unknown) => {
  const code =
    error instanceof Error
      ? "code" in error && typeof error.code === "string"
        ? error.code
        : error.name
      : "UNKNOWN";
  process.stderr.write(
    `Local Inngest demonstration failed (${code}); check arguments, private paths and project-local tool installation.\n`,
  );
  process.exitCode = 1;
});
