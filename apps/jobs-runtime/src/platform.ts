import { once } from "node:events";
import { serve as listen } from "@hono/node-server";
import { Hono } from "hono";
import { Inngest, NonRetriableError } from "inngest";
import { serve } from "inngest/hono";
import { z } from "zod";
import { startNativeInngest } from "../../control-api/src/inngest-native.js";
import { localStorageUri, WorkerSettings } from "./config.js";
import { createRpcPeer, processRpcTransport, RpcError } from "./ipc.js";

let settings: WorkerSettings | undefined;
let listener: ReturnType<typeof listen> | undefined;
let native: Awaited<ReturnType<typeof startNativeInngest>> | undefined;
let closing: Promise<void> | undefined;
function close() {
  closing ??= (async () => {
    await native?.close();
    if (listener) {
      if ("closeAllConnections" in listener) listener.closeAllConnections();
      await new Promise<void>((resolve) => listener?.close(() => resolve()));
    }
    peer.close();
    if (process.connected) process.disconnect();
  })();
  return closing;
}
function fail() {
  process.exitCode = 1;
  void close().catch(() => {
    process.exitCode = 1;
    if (process.connected) process.disconnect();
  });
}
const peer = createRpcPeer(processRpcTransport(process), {
  timeoutMs: 120_000,
  onFailure: fail,
  async onRequest(method, raw) {
    if (method === "initialize") {
      if (settings || closing) throw new RpcError("ALREADY_STARTED");
      settings = WorkerSettings.parse(raw);
      const sdkUrl = `http://127.0.0.1:${settings.cell.workerPort}/api/inngest`;
      const client = new Inngest({
        id: "godseye-platform",
        isDev: false,
        baseUrl: `http://127.0.0.1:${settings.cell.enginePort}`,
        eventKey: settings.eventKey,
        signingKey: settings.signingKey,
      });
      const maintenance = client.createFunction(
        {
          id: "maintenance",
          triggers: [{ event: "godseye/platform.maintenance" }, { cron: "* * * * *" }],
          retries: 3,
        },
        async ({ event, step }) => {
          if (
            event.name !== "inngest/scheduled.timer" &&
            event.name !== "godseye/platform.maintenance"
          )
            throw new NonRetriableError("Application events are not platform work");
          if (
            event.name !== "inngest/scheduled.timer" &&
            !z.object({}).strict().safeParse(event.data).success
          )
            throw new NonRetriableError("Platform maintenance accepts no tenant payload");
          return step.run("foundation-maintenance", () => peer.request("maintenance", null));
        },
      );
      const app = new Hono();
      const port = String(settings.cell.workerPort);
      app.use("*", async (context, next) => {
        const url = new URL(context.req.url);
        if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) || url.port !== port)
          return context.json({ error: "Invalid platform worker host" }, 403);
        context.header("Cache-Control", "no-store");
        await next();
      });
      app.on(
        ["GET", "POST", "PUT"],
        "/api/inngest",
        serve({
          client,
          functions: [maintenance],
          serveOrigin: new URL(sdkUrl).origin,
          servePath: "/api/inngest",
        }),
      );
      listener = listen({
        fetch: app.fetch,
        port: settings.cell.workerPort,
        hostname: "127.0.0.1",
      });
      listener.once("error", fail);
      if (!listener.listening) await once(listener, "listening");
      return {
        producerId: settings.cell.environmentId,
        handlers: ["platform.maintenance"],
        pid: process.pid,
      };
    }
    if (!settings || closing) throw new RpcError("NOT_READY");
    if (method === "engine-start") {
      if (native) throw new RpcError("ALREADY_STARTED");
      const persistence = z
        .object({ postgresUri: z.string(), redisUri: z.string() })
        .strict()
        .parse(raw);
      localStorageUri(persistence.postgresUri, "postgresql:");
      localStorageUri(persistence.redisUri, "redis:");
      native = await startNativeInngest({
        cell: settings.cell,
        directory: settings.engineDirectory,
        sdkUrl: `http://127.0.0.1:${settings.cell.workerPort}/api/inngest`,
        material: { event: settings.eventKey, signing: settings.signingKey },
        persistence,
        onFailure: fail,
      });
      return null;
    }
    if (method === "close") {
      setImmediate(() => {
        void close().catch(fail);
      });
      return null;
    }
    throw new RpcError("METHOD_NOT_ALLOWED");
  },
});
process.once("disconnect", () => {
  void close().catch(fail);
});
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.once(signal, () => {
    void close().catch(fail);
  });
