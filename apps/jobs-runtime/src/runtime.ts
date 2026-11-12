import { isAbsolute, join, resolve } from "node:path";
import { setTimeout as wait } from "node:timers/promises";
import { ApplicationJobEnvelope } from "@godseye/contracts";
import {
  backendConfiguration,
  InfrastructureEngine,
  JOBS_ADAPTER_ID,
  type JobHandler,
  type OutboxSender,
  runFoundationWorker,
  runJobScheduler,
  write,
} from "@godseye/core";
import { type Store, schema } from "@godseye/store";
import { eq, sql } from "drizzle-orm";
import { acquireInstance, privateDirectory } from "../../control-api/src/identity/runtime.js";
import { type LocalInngestCell, parseInngestCells } from "../../control-api/src/inngest-config.js";
import { openLocalInngestMaterial } from "../../control-api/src/inngest-native.js";
import { createCellBroker } from "./broker.js";
import { readCellDefinitions, reconcileCellCatalog } from "./catalog.js";
import { startWorkerChild, type WorkerChild } from "./child.js";
import { type ExternalStorage, validateExternalStorage } from "./config.js";
import { registerWorkerSenders } from "./senders.js";
import { inspectWorkflowStorage } from "./storage.js";

const reader = { id: "autonomous-job-supervisor", kind: "owner" as const, projectIds: [] };
/** Independent trusted supervisor; application code and private payloads execute in cell children. */
export async function prepareAutonomousJobs(options: {
  store: Store;
  rootDirectory: string;
  stateDirectory: string;
  cells: LocalInngestCell[];
  storage: ExternalStorage[];
  workerModule?: string;
  controlDatabaseUrl?: string;
  platform?: { cell: LocalInngestCell; storage: ExternalStorage };
}) {
  if (options.store.driver !== "postgres" || !options.store.lockRuntime)
    throw new Error("Autonomous workers require the shared PostgreSQL control journal");
  const allCells = parseInngestCells(
    JSON.stringify([...options.cells, ...(options.platform ? [options.platform.cell] : [])]),
  );
  const cells = allCells.slice(0, options.cells.length);
  if (!cells.length || (options.workerModule && !isAbsolute(options.workerModule)))
    throw new Error(
      "Explicit application cells and an absolute trusted worker module are required",
    );
  const storage = validateExternalStorage(
    [...options.storage, ...(options.platform ? [options.platform.storage] : [])],
    options.controlDatabaseUrl,
  );
  if (
    storage.length !== allCells.length ||
    allCells.some(
      (cell) =>
        !storage.some(
          (binding) =>
            binding.projectId === cell.projectId && binding.environmentId === cell.environmentId,
        ),
    )
  )
    throw new Error(
      "Every autonomous cell requires its exact independent external storage binding",
    );
  const stateDirectory = resolve(options.stateDirectory, "jobs-runtime");
  await privateDirectory(stateDirectory);
  const abort = new AbortController();
  let lockFailure = () => {
    abort.abort();
  };
  const releaseDatabase = await options.store.lockRuntime("godseye:autonomous-jobs", () =>
    lockFailure(),
  );
  let release: Awaited<ReturnType<typeof acquireInstance>>;
  try {
    release = await acquireInstance(stateDirectory);
  } catch (error) {
    await releaseDatabase();
    throw error;
  }
  const pumps: Promise<void>[] = [];
  const handlers = new Map<string, JobHandler>();
  const senders = new Map<string, OutboxSender>();
  const prepared: {
    config: LocalInngestCell;
    settings: NonNullable<Awaited<ReturnType<typeof backendConfiguration>>["configuration"]>;
    directory: string;
    material: Awaited<ReturnType<typeof openLocalInngestMaterial>>;
    broker: ReturnType<typeof createCellBroker>;
    worker?: WorkerChild;
    catalog?: string;
  }[] = [];
  let platform:
    | {
        config: LocalInngestCell;
        directory: string;
        material: Awaited<ReturnType<typeof openLocalInngestMaterial>>;
        worker?: WorkerChild;
      }
    | undefined;
  let started = false,
    closing: Promise<void> | undefined;
  const infrastructure = new InfrastructureEngine(options.store, {
    foundationConsumer: {
      adapterIds: new Set([JOBS_ADAPTER_ID]),
      environmentIds: new Set(cells.map((cell) => cell.environmentId)),
    },
    jobs: {
      handlers,
      senders,
      managedEnvironmentIds: new Set(cells.map((cell) => cell.environmentId)),
      inngestEnvironmentIds: new Set(cells.map((cell) => cell.environmentId)),
      applicationEventLoader: async (authority, id) => {
        const cell = prepared.find(
          ({ config, worker }) =>
            config.projectId === authority.projectId &&
            config.environmentId === authority.environmentId &&
            worker?.producerId === authority.producerId,
        );
        const raw = await cell?.worker?.peer.request("read-event", id);
        return raw ? ApplicationJobEnvelope.parse(raw) : undefined;
      },
    },
  });
  const close = () => {
    closing ??= (async () => {
      abort.abort();
      const outcomes = await Promise.allSettled(prepared.map((cell) => cell.worker?.close()));
      if (platform?.worker) outcomes.push(...(await Promise.allSettled([platform.worker.close()])));
      outcomes.push(...(await Promise.allSettled(pumps)));
      try {
        await release();
      } catch (error) {
        outcomes.push({ status: "rejected", reason: error });
      }
      try {
        await releaseDatabase();
      } catch (error) {
        outcomes.push({ status: "rejected", reason: error });
      }
      if (outcomes.some((outcome) => outcome.status === "rejected"))
        throw new Error("Autonomous runtime cleanup failed; authority is stopped");
    })();
    return closing;
  };
  try {
    for (const config of cells) {
      const [environment] = await options.store.db
        .select()
        .from(schema.environments)
        .where(eq(schema.environments.id, config.environmentId));
      if (!environment || environment.projectId !== config.projectId)
        throw new Error("Autonomous runtime must bind an existing owner cell");
      const configuration = await backendConfiguration(
        options.store,
        reader,
        config.projectId,
        config.environmentId,
      );
      if (configuration.state !== "prepared" || !configuration.configuration?.enabled)
        throw new Error("Enable and confirm current backend settings before autonomous connection");
      const directory = resolve(
        options.stateDirectory,
        "inngest",
        config.projectId,
        config.environmentId,
      );
      const material = await openLocalInngestMaterial(directory);
      prepared.push({
        config,
        settings: configuration.configuration,
        directory,
        material,
        broker: createCellBroker(
          options.store,
          config,
          configuration.revision,
          () => !abort.signal.aborted,
        ),
      });
    }
    const material = prepared.flatMap((cell) => [cell.material.event, cell.material.signing]);
    if (options.platform) {
      const config = options.platform.cell;
      const [existing] = await options.store.db
        .select()
        .from(schema.projects)
        .where(eq(schema.projects.id, config.projectId));
      if (existing || cells.some((cell) => cell.projectId === config.projectId))
        throw new Error("Platform scope must be distinct from application projects");
      const directory = resolve(options.stateDirectory, "inngest", "platform");
      platform = { config, directory, material: await openLocalInngestMaterial(directory) };
      material.push(platform.material.event, platform.material.signing);
    }
    if (new Set(material).size !== material.length)
      throw new Error("Autonomous cells cannot reuse private authority material");
  } catch (error) {
    await close();
    throw error;
  }
  return {
    infrastructure,
    cells: prepared.map((cell) => ({ ...cell.config })),
    platform: platform ? { ...platform.config } : null,
    async start(input: { signal: AbortSignal; onFailure(): void }) {
      if (started || closing) throw new Error("Autonomous runtime may start exactly once");
      started = true;
      let failed = false;
      const fail = () => {
        if (!failed && !abort.signal.aborted) {
          failed = true;
          input.onFailure();
          void close().catch(input.onFailure);
        }
      };
      lockFailure = () => {
        abort.abort();
        input.onFailure();
        void close().catch(input.onFailure);
      };
      const onAbort = () => {
        void close().catch(input.onFailure);
      };
      input.signal.addEventListener("abort", onAbort, { once: true });
      if (input.signal.aborted || abort.signal.aborted) {
        await close();
        throw new Error("Autonomous runtime startup cancelled");
      }
      try {
        const identities = new Set<string>();
        const ownerIdentity = (
          await options.store.db.execute(
            sql`SELECT current_database() AS database, inet_server_port() AS port`,
          )
        ).rows[0];
        for (const binding of storage) {
          const proof = await inspectWorkflowStorage(binding);
          if (
            ownerIdentity?.database === proof.database &&
            Number(ownerIdentity.port) === proof.postgresPort
          )
            throw new Error("Workflow storage cannot be the owner control journal");
          if (identities.has(proof.redisInstanceId))
            throw new Error("Independent cell Redis bindings resolve to the same instance");
          identities.add(proof.redisInstanceId);
        }
        const definitions = await readCellDefinitions(options.store, cells);
        for (const cell of prepared) {
          cell.worker = await startWorkerChild(
            {
              cell: cell.config,
              directory: resolve(
                options.rootDirectory,
                "applications",
                cell.config.projectId,
                cell.config.environmentId,
              ),
              engineDirectory: join(cell.directory, "engine"),
              eventKey: cell.material.event,
              signingKey: cell.material.signing,
              ...(options.workerModule ? { workerModule: options.workerModule } : {}),
              settings: {
                allowedOrigins: cell.settings.allowedOrigins,
                registrationEnabled: cell.settings.registrationEnabled,
                maxFileMiB: cell.settings.maxFileMiB,
                storageMiB: cell.settings.storageMiB,
                maxFiles: cell.settings.maxFiles,
                eventRetention: cell.settings.eventRetention,
              },
            },
            { onRequest: cell.broker.onRequest, onFailure: fail },
          );
          cell.broker.bind(infrastructure, cell.worker);
          const descriptor = {
            environmentId: cell.config.environmentId,
            projectId: cell.config.projectId,
            handlers: cell.worker.handlers,
            updatedAt: new Date(),
          };
          await write(options.store, async (tx) => {
            await tx.insert(schema.jobWorkerBindings).values(descriptor).onConflictDoUpdate({
              target: schema.jobWorkerBindings.environmentId,
              set: descriptor,
            });
          });
          for (const name of cell.worker.handlers)
            if (!handlers.has(name))
              handlers.set(name, {
                execute: (context) => {
                  const target = prepared.find(
                    ({ config }) =>
                      config.projectId === context.projectId &&
                      config.environmentId === context.environmentId,
                  );
                  if (!target) throw new Error("Handler does not belong to a managed cell");
                  return target.broker.execute(context);
                },
                reconcile: (context) => {
                  const target = prepared.find(
                    ({ config }) =>
                      config.projectId === context.projectId &&
                      config.environmentId === context.environmentId,
                  );
                  if (!target) throw new Error("Probe does not belong to a managed cell");
                  return target.broker.execute(context, true);
                },
              });
          registerWorkerSenders(cell, prepared, senders);
          await reconcileCellCatalog(cell, definitions, false);
          const binding = storage.find(
            (entry) => entry.environmentId === cell.config.environmentId,
          );
          if (!binding) throw new Error("Private workflow storage binding disappeared");
          await cell.worker.peer.request("engine-start", {
            postgresUri: binding.postgresUri,
            redisUri: binding.redisUri,
          });
          if (abort.signal.aborted || failed) throw new Error("Autonomous startup was cancelled");
        }
        if (platform && options.platform) {
          const target = platform;
          target.worker = await startWorkerChild(
            {
              cell: target.config,
              directory: target.directory,
              engineDirectory: join(target.directory, "engine"),
              eventKey: target.material.event,
              signingKey: target.material.signing,
              settings: {
                allowedOrigins: [],
                registrationEnabled: false,
                maxFileMiB: 1,
                storageMiB: 1,
                maxFiles: 1,
                eventRetention: 1,
              },
            },
            {
              kind: "platform",
              onFailure: fail,
              onRequest: async (method, payload) => {
                if (method !== "maintenance" || payload !== null || abort.signal.aborted)
                  throw new Error("Platform capability refused");
                return {
                  state: "ready",
                  expiredLeases: await infrastructure.foundation.reconcileExpired(),
                  cells: cells.length,
                };
              },
            },
          );
          await target.worker.peer.request("engine-start", {
            postgresUri: options.platform.storage.postgresUri,
            redisUri: options.platform.storage.redisUri,
          });
        }
        pumps.push(
          runFoundationWorker(infrastructure.foundation, {
            workerId: `jobs-supervisor-${process.pid}`,
            signal: abort.signal,
          }),
        );
        pumps.push(runJobScheduler(infrastructure.jobs, { signal: abort.signal }));
        pumps.push(
          (async () => {
            while (!abort.signal.aborted) {
              const definitions = await readCellDefinitions(options.store, cells);
              for (const cell of prepared) await reconcileCellCatalog(cell, definitions, true);
              try {
                await wait(1000, undefined, { signal: abort.signal });
              } catch (error) {
                if (!(error instanceof Error && error.name === "AbortError")) throw error;
              }
            }
          })(),
        );
        for (const pump of pumps) void pump.catch(fail);
      } catch (error) {
        await close();
        throw error;
      }
    },
    close,
  };
}
