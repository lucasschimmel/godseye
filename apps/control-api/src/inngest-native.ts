import { fork } from "node:child_process";
import { randomBytes } from "node:crypto";
import { once } from "node:events";
import { lstat, open, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { setTimeout as wait } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { privateDirectory } from "./identity/runtime.js";
import type { LocalInngestCell } from "./inngest-config.js";
import { workflowEndpoint } from "./workflow-endpoint.js";

const Material = z
  .object({
    event: z.string().regex(/^[a-f0-9]{64}$/),
    signing: z.string().regex(/^[a-f0-9]{64}$/),
    auth: z.string().regex(/^[A-Za-z0-9_-]{64}$/),
  })
  .strict();
export async function openLocalInngestMaterial(directory: string) {
  await privateDirectory(directory);
  const target = join(directory, "runtime-material.json");
  try {
    const file = await open(target, "wx", 0o600);
    try {
      await file.writeFile(
        JSON.stringify({
          event: randomBytes(32).toString("hex"),
          signing: randomBytes(32).toString("hex"),
          auth: randomBytes(48).toString("base64url"),
        }),
      );
    } finally {
      await file.close();
    }
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) throw error;
  }
  const info = await lstat(target);
  if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || info.size > 4096)
    throw new Error("Unsafe local Inngest material");
  return Material.parse(JSON.parse(await readFile(target, "utf8")));
}
export async function startNativeInngest(options: {
  cell: LocalInngestCell;
  directory: string;
  sdkUrl: string;
  material: Pick<z.infer<typeof Material>, "event" | "signing">;
  onFailure(): void;
  persistence?: { postgresUri: string; redisUri: string };
}) {
  const cell = { ...options.cell };
  if (options.persistence) {
    for (const [raw, store] of [
      [options.persistence.postgresUri, "postgresql"],
      [options.persistence.redisUri, "redis"],
    ] as const) {
      let url: URL;
      try {
        url = workflowEndpoint(raw, store).url;
      } catch {
        throw new Error("Both private authenticated workflow stores are required");
      }
      if (!url.password) throw new Error("Both private authenticated workflow stores are required");
    }
  }
  await privateDirectory(options.directory);
  const binary = resolve(
    "artifacts",
    "tools",
    "inngest-1.52.0",
    process.platform === "win32" ? "inngest.exe" : "inngest",
  );
  const args = [
    "--log-level",
    "error",
    "start",
    "--host",
    "127.0.0.1",
    "--port",
    String(cell.enginePort),
    "--connect-gateway-port",
    String(cell.gatewayPort),
    "--connect-gateway-grpc-port",
    String(cell.gatewayGrpcPort),
    "--connect-executor-grpc-port",
    String(cell.executorGrpcPort),
    "--sqlite-dir",
    options.directory,
    "--sdk-url",
    options.sdkUrl,
    "--queue-workers",
    "10",
  ];
  const child = fork(fileURLToPath(new URL("./inngest-guardian.mjs", import.meta.url)), [], {
    cwd: options.directory,
    env: {
      ...Object.fromEntries(
        Object.entries(process.env).filter(([name]) =>
          [
            "systemroot",
            "windir",
            "temp",
            "tmp",
            "path",
            "pathext",
            "lang",
            "lc_all",
            "tz",
          ].includes(name.toLowerCase()),
        ),
      ),
      INNGEST_EVENT_KEY: options.material.event,
      INNGEST_SIGNING_KEY: options.material.signing,
      ...(options.persistence
        ? {
            INNGEST_POSTGRES_URI: options.persistence.postgresUri,
            INNGEST_REDIS_URI: options.persistence.redisUri,
          }
        : {}),
    },
    execArgv: [],
    stdio: ["ignore", "ignore", "ignore", "ipc"],
  });
  child.send({ kind: "start", binary, args });
  let closing = false,
    started = false;
  const close = async () => {
    if (closing) return;
    closing = true;
    if (child.exitCode === null && child.signalCode === null) {
      const done = once(child, "close");
      if (child.connected) child.send({ kind: "stop" });
      await done;
    }
  };
  child.once("exit", () => {
    if (started && !closing) options.onFailure();
  });
  const failed = once(child, "error").then(() => {
    throw new Error("Project-local Inngest process failed to start");
  });
  try {
    await Promise.race([
      failed,
      (async () => {
        for (let index = 0; index < 100; index++) {
          if (child.exitCode !== null || child.signalCode !== null)
            throw new Error("Native Inngest exited before readiness");
          try {
            if (
              (
                await fetch(`http://127.0.0.1:${cell.enginePort}/health`, {
                  signal: AbortSignal.timeout(1000),
                })
              ).ok
            )
              return;
          } catch {
            /* A refused connection is expected until the local startup listener binds. */
          }
          await wait(100);
        }
        throw new Error("Native Inngest readiness deadline exceeded");
      })(),
    ]);
    const registration = await fetch(options.sdkUrl, {
      method: "PUT",
      signal: AbortSignal.timeout(10_000),
      redirect: "error",
    });
    if (!registration.ok) {
      await registration.body?.cancel();
      throw new Error("Local SDK registration failed");
    }
    await registration.body?.cancel();
    started = true;
    return { close };
  } catch (error) {
    await close();
    throw error;
  }
}
