import { join, resolve } from "node:path";
import { ApplicationScope } from "@godseye/app-backend";
import { serve } from "@hono/node-server";
import { z } from "zod";
import { createTemplateApplication } from "./application.js";

const args = process.argv.slice(2);
if (args.includes("--help")) {
  process.stdout.write(
    "Local application template: --standalone --project <uuid> --environment <uuid> [--port <number>] [--directory <private-directory>]\nStandalone fixtures only; controller-managed applications must supply their private lifecycle guard.\n",
  );
} else {
  if (!args.includes("--standalone"))
    throw new Error(
      "Explicit --standalone is required for fixture development; managed applications require a controller lifecycle guard",
    );
  args.splice(args.indexOf("--standalone"), 1);
  const options = new Map<string, string>();
  for (let index = 0; index < args.length; index += 2) {
    const name = args[index],
      value = args[index + 1];
    if (
      !name ||
      !value ||
      !["--project", "--environment", "--port", "--directory"].includes(name) ||
      options.has(name)
    )
      throw new Error("Invalid template arguments; use --help");
    options.set(name, value);
  }
  const scope = ApplicationScope.parse({
    projectId: options.get("--project"),
    environmentId: options.get("--environment"),
  });
  const port = z.coerce
    .number()
    .int()
    .min(1024)
    .max(65535)
    .parse(options.get("--port") ?? process.env.GODSEYE_APP_PORT ?? "4400");
  const directory = resolve(
    options.get("--directory") ??
      join(".local", "applications", scope.projectId, scope.environmentId),
  );
  const runtime = await createTemplateApplication({
    scope,
    directory,
    baseUrl: `http://localhost:${port}`,
    trustedOrigins: [`http://localhost:${port}`],
    lifecycle: async () => ({ available: true, epoch: 0 }),
  });
  const server = serve({ fetch: runtime.app.fetch, hostname: "localhost", port }, () => {
    process.stdout.write(
      `Standalone fixture application listening on http://localhost:${port}; local-only, no controller admission or qualified infrastructure\n`,
    );
  });
  let closing = false;
  const close = async () => {
    if (closing) return;
    closing = true;
    if ("closeAllConnections" in server) server.closeAllConnections();
    await new Promise<void>((done, reject) =>
      server.close((error) => (error ? reject(error) : done())),
    );
    await runtime.close();
  };
  for (const signal of ["SIGINT", "SIGTERM"])
    process.once(signal, () => {
      void close().catch(() => {
        process.exitCode = 1;
      });
    });
}
