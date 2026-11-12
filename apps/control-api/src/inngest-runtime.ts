import { once } from "node:events";
import { join, resolve } from "node:path";
import { setTimeout as wait } from "node:timers/promises";
import {
  ApplicationError,
  type LocalApplicationOptions,
  openLocalApplication,
} from "@godseye/app-backend";
import {
  applicationLifecycleGuard,
  backendConfiguration,
  createInngestCell,
  type InfrastructureEngine,
  type JobOptions,
} from "@godseye/core";
import { type Store, schema } from "@godseye/store";
import { serve } from "@hono/node-server";
import { eq } from "drizzle-orm";
import { type LocalInngestCell, parseInngestCells } from "./inngest-config.js";
import { openLocalInngestMaterial, startNativeInngest } from "./inngest-native.js";

interface PreparedCell {
  config: LocalInngestCell;
  backend: Awaited<ReturnType<typeof openLocalApplication>>;
  directory: string;
  material: Awaited<ReturnType<typeof openLocalInngestMaterial>>;
  integration?: ReturnType<typeof createInngestCell>;
}
/** Local composition attached to the real owner Store; it never creates owner accounts or projects. */
export async function prepareLocalInngest(options: {
  store: Store;
  rootDirectory: string;
  stateDirectory: string;
  cells: LocalInngestCell[];
  applicationRoutes?: LocalApplicationOptions["routes"];
}) {
  const cells = parseInngestCells(JSON.stringify(options.cells));
  const rootDirectory = resolve(options.rootDirectory),
    stateDirectory = resolve(options.stateDirectory);
  const prepared: PreparedCell[] = [];
  const listeners: ReturnType<typeof serve>[] = [];
  const engines: Awaited<ReturnType<typeof startNativeInngest>>[] = [];
  const pumps: Promise<void>[] = [];
  const abort = new AbortController();
  let infrastructure: InfrastructureEngine | undefined;
  let closing: Promise<void> | undefined;
  let started = false;
  const close = () => {
    closing ??= (async () => {
      abort.abort();
      const outcomes = await Promise.allSettled(engines.map((engine) => engine.close()));
      outcomes.push(
        ...(await Promise.allSettled(
          listeners.map(async (server) => {
            if ("closeAllConnections" in server) server.closeAllConnections();
            await new Promise<void>((done) => server.close(() => done()));
          }),
        )),
      );
      outcomes.push(...(await Promise.allSettled(pumps)));
      outcomes.push(...(await Promise.allSettled(prepared.map((cell) => cell.backend.close()))));
      if (outcomes.some((outcome) => outcome.status === "rejected"))
        throw new Error("Local Inngest cleanup reported a worker or storage failure");
    })();
    return closing;
  };
  try {
    const configurations = new Map<string, Awaited<ReturnType<typeof backendConfiguration>>>();
    for (const config of cells) {
      const [environment] = await options.store.db
        .select()
        .from(schema.environments)
        .where(eq(schema.environments.id, config.environmentId));
      if (!environment || environment.projectId !== config.projectId)
        throw new Error("Local Inngest scope must be an existing owner project environment");
      const configuration = await backendConfiguration(
        options.store,
        { id: "local-inngest-runtime", kind: "owner", projectIds: [] },
        config.projectId,
        config.environmentId,
      );
      if (configuration.state !== "prepared" || !configuration.configuration?.enabled)
        throw new Error(
          "Enable and confirm the existing owner backend configuration before connecting its local Inngest cell",
        );
      configurations.set(config.environmentId, configuration);
    }
    for (const config of cells) {
      const configuration = configurations.get(config.environmentId);
      if (!configuration?.configuration)
        throw new Error("Prepared application configuration disappeared");
      const settings = configuration.configuration;
      const lifecycle = applicationLifecycleGuard(options.store, {
        projectId: config.projectId,
        environmentId: config.environmentId,
        configurationRevision: configuration.revision,
      });
      const directory = resolve(stateDirectory, "inngest", config.projectId, config.environmentId);
      const material = await openLocalInngestMaterial(directory);
      let cell: PreparedCell | undefined;
      const backend = await openLocalApplication({
        directory: resolve(rootDirectory, "applications", config.projectId, config.environmentId),
        scope: { projectId: config.projectId, environmentId: config.environmentId },
        baseUrl: `http://127.0.0.1:${config.applicationPort}`,
        trustedOrigins: settings.allowedOrigins,
        registrationEnabled: settings.registrationEnabled,
        limits: {
          objectBytes: settings.maxFileMiB * 1024 * 1024,
          storageBytes: settings.storageMiB * 1024 * 1024,
          maxFiles: settings.maxFiles,
          eventRetention: settings.eventRetention,
        },
        lifecycle,
        jobs: {
          transport: {
            send: (event, signal) => {
              if (!cell?.integration) throw new Error("Local Inngest integration is not bound");
              return cell.integration.transport.send(event, signal);
            },
            settled: (event, signal) =>
              cell?.integration
                ? cell.integration.transport.settled(event, signal)
                : Promise.resolve(false),
          },
        },
        routes: options.applicationRoutes,
      });
      cell = { config, backend, directory, material };
      prepared.push(cell);
    }
    const authorities = prepared.flatMap((cell) => [cell.material.event, cell.material.signing]);
    if (new Set(authorities).size !== authorities.length)
      throw new Error("Local Inngest cells cannot reuse engine authority material");
  } catch (error) {
    await close();
    throw error;
  }
  const jobs: Partial<Omit<JobOptions, "now">> = prepared.length
    ? {
        inngestEnvironmentIds: new Set(prepared.map((cell) => cell.config.environmentId)),
        applicationEventLoader: async (authority, id) => {
          const cell = prepared.find(
            ({ config, backend }) =>
              config.projectId === authority.projectId &&
              config.environmentId === authority.environmentId &&
              backend.state.store.id === authority.producerId,
          );
          return cell?.backend.readJobEvent(id);
        },
        handlers: new Map([
          [
            "application.archive",
            {
              async execute(context) {
                return context.event
                  ? { status: "succeeded", evidenceRef: `application-event:${context.event.id}` }
                  : { status: "failed", evidenceRef: "application:event-missing" };
              },
            },
          ],
        ]),
      }
    : {};
  return {
    jobs,
    bind(engine: InfrastructureEngine) {
      if (infrastructure || started || closing)
        throw new Error("Local Inngest is already bound or closed");
      infrastructure = engine;
    },
    async start(input: { signal: AbortSignal; onFailure(): void }) {
      if (!infrastructure || started || closing)
        throw new Error("Bind the local Inngest runtime exactly once before startup");
      started = true;
      const stop = () => {
        void close().catch(input.onFailure);
      };
      input.signal.addEventListener("abort", stop, { once: true });
      if (input.signal.aborted) {
        await close();
        throw new Error("Local Inngest startup was cancelled");
      }
      try {
        const definitions = (
          await infrastructure.jobs.overview({
            id: "local-inngest-runtime",
            kind: "owner",
            projectIds: [],
          })
        ).definitions;
        for (const cell of prepared) {
          if (abort.signal.aborted) throw new Error("Local Inngest startup was cancelled");
          const authority = {
            projectId: cell.config.projectId,
            environmentId: cell.config.environmentId,
            producerId: cell.backend.state.store.id,
          };
          const sdkUrl = `http://127.0.0.1:${cell.config.workerPort}/api/inngest`;
          cell.integration = createInngestCell({
            id: `ge-${cell.config.environmentId}`,
            authority,
            jobs: infrastructure.jobs,
            baseUrl: `http://127.0.0.1:${cell.config.enginePort}`,
            sdkUrl,
            eventKey: cell.material.event,
            signingKey: cell.material.signing,
            cronDefinitions: definitions.filter(
              (definition) =>
                definition.environmentId === cell.config.environmentId &&
                definition.trigger.kind === "cron",
            ),
          });
          for (const [fetch, port] of [
            [cell.integration.app.fetch, cell.config.workerPort],
            [cell.backend.app.fetch, cell.config.applicationPort],
          ] as const) {
            const server = serve({ fetch, port, hostname: "127.0.0.1" });
            listeners.push(server);
            server.once("error", input.onFailure);
            if (!server.listening) await once(server, "listening");
          }
          const native = await startNativeInngest({
            cell: cell.config,
            directory: join(cell.directory, "engine"),
            sdkUrl,
            material: cell.material,
            onFailure: input.onFailure,
          });
          if (abort.signal.aborted) {
            await native.close();
            throw new Error("Local Inngest startup was cancelled");
          }
          engines.push(native);
          const pump = (async () => {
            while (!abort.signal.aborted) {
              try {
                await cell.backend.flushJobs({ signal: abort.signal });
              } catch (error) {
                // Owner lifecycle changes park this producer; they are not controller failures.
                if (
                  !(error instanceof ApplicationError && error.code === "APPLICATION_UNAVAILABLE")
                )
                  throw error;
              }
              try {
                await wait(1000, undefined, { signal: abort.signal });
              } catch (error) {
                if (!(error instanceof Error && error.name === "AbortError")) throw error;
              }
            }
          })();
          pumps.push(pump);
          void pump.catch(input.onFailure);
        }
        if (abort.signal.aborted) throw new Error("Local Inngest startup was cancelled");
      } catch (error) {
        await close();
        throw error;
      }
    },
    close,
  };
}
