import { resolve } from "node:path";
import { openStore, type Store } from "@godseye/store";
import { z } from "zod";
import { loadConfiguration } from "../../control-api/src/config.js";
import { LocalInngestCell } from "../../control-api/src/inngest-config.js";
import { readPrivateJson } from "../../control-api/src/private-json.js";
import { ExternalStorage } from "./config.js";
import { prepareAutonomousJobs } from "./runtime.js";

async function start() {
  if (process.argv.includes("--help")) {
    process.stdout.write(
      "Autonomous local jobs: bun run jobs:start\nRequires GODSEYE_MODE=local, GODSEYE_JOBS_RUNTIME=autonomous, GODSEYE_JOBS_CONTROL_FILE (private owner database binding), GODSEYE_INNGEST_CELLS (existing cells JSON), GODSEYE_JOBS_PLATFORM (independent platform cell JSON), GODSEYE_JOBS_STORAGE_FILE (private PostgreSQL/Redis bindings), optional GODSEYE_JOBS_WORKER_MODULE (absolute first-party module). No owner account or project is created.\n",
    );
    return;
  }
  const config = loadConfiguration();
  if (
    !config.jobsDetached ||
    !config.databaseUrl ||
    !process.env.GODSEYE_JOBS_PLATFORM ||
    !process.env.GODSEYE_JOBS_STORAGE_FILE
  )
    throw new Error(
      "Explicit detached mode, platform and private workflow storage bindings are required",
    );
  const platformCell = LocalInngestCell.parse(JSON.parse(process.env.GODSEYE_JOBS_PLATFORM));
  const storage = z
    .array(ExternalStorage)
    .min(2)
    .max(21)
    .parse(readPrivateJson(process.env.GODSEYE_JOBS_STORAGE_FILE));
  const platformStorage = storage.find(
    (entry) =>
      entry.projectId === platformCell.projectId &&
      entry.environmentId === platformCell.environmentId,
  );
  if (!platformStorage) throw new Error("Independent platform workflow storage binding is missing");
  const abort = new AbortController();
  let store: Store | undefined,
    runtime: Awaited<ReturnType<typeof prepareAutonomousJobs>> | undefined;
  let closing: Promise<void> | undefined;
  const stop = () => {
    closing ??= (async () => {
      abort.abort();
      await runtime?.close();
      await store?.close();
    })();
    return closing;
  };
  const fail = () => {
    process.exitCode = 1;
    void stop().catch(() => {
      process.exitCode = 1;
    });
  };
  for (const signal of ["SIGINT", "SIGTERM"] as const)
    process.once(signal, () => {
      void stop().catch(fail);
    });
  try {
    store = await openStore({ databaseUrl: config.databaseUrl });
    runtime = await prepareAutonomousJobs({
      store,
      rootDirectory: config.rootDir,
      stateDirectory: config.stateDir,
      cells: config.inngestCells,
      storage: storage.filter((entry) => entry !== platformStorage),
      platform: { cell: platformCell, storage: platformStorage },
      controlDatabaseUrl: config.databaseUrl,
      ...(process.env.GODSEYE_JOBS_WORKER_MODULE
        ? { workerModule: resolve(process.env.GODSEYE_JOBS_WORKER_MODULE) }
        : {}),
    });
    await runtime.start({ signal: abort.signal, onFailure: fail });
    process.stdout.write(
      `Autonomous jobs supervisor ready: ${runtime.cells.length} application cells and one independent platform engine. Owner HTTP may stop. Local process separation is not container qualification.\n`,
    );
  } catch {
    await stop();
    throw new Error("Autonomous local runtime refused startup");
  }
}
void start().catch(() => {
  process.stderr.write(
    "Autonomous jobs failed. Verify local bindings, current owner cell settings, private permissions and external PostgreSQL/Redis health.\n",
  );
  process.exitCode = 1;
});
