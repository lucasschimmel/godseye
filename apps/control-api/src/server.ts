import {
  AesGcmSealer,
  ControlPlane,
  ciHealthFindings,
  InfrastructureEngine,
  JOBS_ADAPTER_ID,
  PlatformBuilds,
  runDeliveryScheduler,
  runFoundationWorker,
  runJobScheduler,
  runObservabilityScheduler,
  runOrchestrationScheduler,
} from "@godseye/core";
import { openStore, type Store } from "@godseye/store";
import { serve } from "@hono/node-server";
import { createRuntimeAccess } from "./access-runtime.js";
import { createApp } from "./app.js";
import { configuredCellProviders } from "./cell-providers.js";
import { codingStartupOptions } from "./coding-startup.js";
import { loadConfiguration } from "./config.js";
import { configuredPlatformBuildSource } from "./delivery/platform-builds-source.js";
import { configuredDelivery } from "./delivery/startup.js";
import { configuredHermesProvider, type ManagedHermesProvider } from "./hermes-provider.js";
import {
  configuredHermesToolExecutor,
  type ManagedHermesToolExecutor,
} from "./hermes-tool-executor.js";
import { createOwnerIdentity } from "./identity/index.js";
import { acquireInstance, loadIdentityMaterial, privateDirectory } from "./identity/runtime.js";
import { prepareLocalInngest } from "./inngest-runtime.js";
import { jobsOptions } from "./jobs-fixtures.js";

async function start() {
  const config = loadConfiguration();
  await privateDirectory(config.stateDir);
  if (!config.databaseUrl) await privateDirectory(config.dataDir);
  const release = await acquireInstance(config.stateDir);
  const abort = new AbortController();
  let store: Store | undefined;
  let server: ReturnType<typeof serve> | undefined;
  let worker: Promise<void> | undefined;
  let deliveryWorker: Promise<void> | undefined;
  let jobsWorker: Promise<void> | undefined;
  let orchestrationWorker: Promise<void> | undefined;
  let stopObservability: (() => Promise<void>) | undefined;
  let stopping: Promise<void> | undefined;
  let inngest: Awaited<ReturnType<typeof prepareLocalInngest>> | undefined;
  let hermes: ManagedHermesProvider | undefined;
  let hermesTools: ManagedHermesToolExecutor | undefined;
  function stop() {
    stopping ??= (async () => {
      abort.abort();
      await stopObservability?.();
      let failed = false;
      try {
        await inngest?.close();
      } catch {
        failed = true;
      }
      if (server) await new Promise<void>((done) => server?.close(() => done()));
      if (worker)
        await worker.catch(() => {
          failed = true;
        });
      if (deliveryWorker)
        await deliveryWorker.catch(() => {
          failed = true;
        });
      if (jobsWorker)
        await jobsWorker.catch(() => {
          failed = true;
        });
      if (orchestrationWorker)
        await orchestrationWorker.catch(() => {
          failed = true;
        });
      try {
        await hermes?.close();
      } catch {
        failed = true;
      }
      try {
        await hermesTools?.close();
      } catch {
        failed = true;
      }
      try {
        await store?.close();
      } catch {
        failed = true;
      }
      try {
        await release();
      } catch {
        failed = true;
      }
      if (failed) throw new Error("Local worker or storage cleanup failed");
    })();
    return stopping;
  }
  function fail(message: string) {
    console.error(message);
    process.exitCode = 1;
    void stop().catch(() => {
      console.error("Local cleanup failed after admission stopped");
    });
  }
  try {
    const signingKey = await loadIdentityMaterial(config.identityDir);
    store = await openStore({ dataDir: config.dataDir, databaseUrl: config.databaseUrl });
    const identity = await createOwnerIdentity(store, {
      origin: config.ownerOrigin,
      signingKey,
    });
    inngest = await prepareLocalInngest({
      store,
      rootDirectory: config.rootDir,
      stateDirectory: config.stateDir,
      cells: config.jobsDetached ? [] : config.inngestCells,
    });
    const fixtures = jobsOptions(config.jobsLocalFixtures);
    hermes = configuredHermesProvider();
    hermesTools = configuredHermesToolExecutor(process.env);
    // Private per-cell PostgreSQL/pgBackRest providers; absent binding keeps everything unconfigured.
    const cells = configuredCellProviders();
    if (cells) console.info("Private PostgreSQL cell providers are configured");
    // One read-only Jenkins view feeds both the console panel and the CI incident detector.
    const platformBuilds = new PlatformBuilds({
      mode: config.mode === "server" ? "server" : "local",
      source: configuredPlatformBuildSource(process.env) ?? null,
    });
    const infrastructure = new InfrastructureEngine(store, {
      ciHealth: async () => ciHealthFindings(await platformBuilds.observeSystem()),
      ...configuredDelivery(process.env),
      ...cells,
      agents: { provider: hermes, toolExecutor: hermesTools },
      // Webhook targets are sealed under a key derived from the private identity material.
      notifications: { sealer: new AesGcmSealer(signingKey) },
      coding: await codingStartupOptions(),
      ...(config.jobsDetached
        ? { foundationConsumer: { excludedAdapterIds: new Set([JOBS_ADAPTER_ID]) } }
        : {}),
      jobs: {
        ...fixtures,
        ...inngest.jobs,
        handlers: inngest.jobs.handlers
          ? new Map([...(fixtures?.handlers ?? []), ...inngest.jobs.handlers])
          : fixtures?.handlers,
        ...(config.jobsDetached
          ? {
              detached: true,
              managedEnvironmentIds: new Set(config.inngestCells.map((cell) => cell.environmentId)),
              inngestEnvironmentIds: new Set(config.inngestCells.map((cell) => cell.environmentId)),
            }
          : {}),
      },
    });
    stopObservability = runObservabilityScheduler(infrastructure.observability, {
      onError: () => console.error("Local telemetry collection failed"),
      evaluate: () => infrastructure.incidents.evaluateSystem(),
      deliver: async () => {
        await infrastructure.incidents.deliver();
        await infrastructure.usage.prune();
      },
    });
    inngest.bind(infrastructure);
    await inngest.start({
      signal: abort.signal,
      onFailure: () => fail("Local Inngest cell failed; stopping local admission"),
    });
    if (abort.signal.aborted) throw new Error("Local startup was cancelled");
    const engine = infrastructure.foundation;
    const broker = createRuntimeAccess(store, engine, config, signingKey);
    worker = runFoundationWorker(engine, {
      workerId: `local-controller-${process.pid}`,
      signal: abort.signal,
    });
    orchestrationWorker = runOrchestrationScheduler(infrastructure.orchestration, {
      signal: abort.signal,
    });
    deliveryWorker = runDeliveryScheduler(infrastructure.delivery, { signal: abort.signal });
    // The Foundation worker above also consumes the local.jobs adapter; the pump only schedules,
    // dispatches, settles and prunes, and starts solely when the engine is explicitly configured.
    if (!config.jobsDetached && (config.jobsLocalFixtures || config.inngestCells.length))
      jobsWorker = runJobScheduler(infrastructure.jobs, { signal: abort.signal });
    const app = createApp(
      new ControlPlane(store),
      config,
      identity,
      engine,
      broker,
      infrastructure,
      undefined,
      platformBuilds,
    );
    server = serve({ fetch: app.fetch, port: config.apiPort, hostname: config.host }, () => {
      console.info(
        config.mode === "server"
          ? `G.O.D.S.E.Y.E control API (server mode) on ${config.host}:${config.apiPort}; owner origin ${config.ownerOrigin} (private network only)`
          : `G.O.D.S.E.Y.E owner console: ${config.ownerOrigin} (local only)`,
      );
      console.info(
        "Initial enrollment: bun run owner:setup. Management always requires an owner passkey.",
      );
    });
    orchestrationWorker.catch(() =>
      fail("Orchestration scheduler failed; stopping local admission"),
    );
    worker.catch(() => fail("Control worker failed; stopping local admission"));
    deliveryWorker.catch(() => fail("Delivery scheduler failed; stopping local admission"));
    jobsWorker?.catch(() => fail("Job scheduler failed; stopping local admission"));
    server.once("error", () => fail("Local API listener failed"));
    for (const signal of ["SIGINT", "SIGTERM"] as const)
      process.once(signal, () => {
        void stop().catch(() => {
          console.error("Local shutdown failed");
          process.exitCode = 1;
        });
      });
  } catch {
    await stop();
    throw new Error("Local API startup failed");
  }
}
void start().catch(() => {
  console.error(
    "Control API failed to start. Verify local configuration, private state permissions and the process lock.",
  );
  process.exitCode = 1;
});
