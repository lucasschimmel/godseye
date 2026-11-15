import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { CommandRunner } from "./command-runner.js";

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const HEADER =
  /^# godseye-route run=([a-f0-9-]{36}) ownership=([a-f0-9]{64}) digest=(sha256:[a-f0-9]{64})$/m;

export interface RouteOwner {
  runId: string;
  ownership: string;
  digest: string;
}
export interface RouteStore {
  read(environmentId: string): Promise<string | null>;
  write(environmentId: string, content: string): Promise<void>;
  remove(environmentId: string): Promise<void>;
}
/** Parses the ownership header written by {@link renderRoute}; absent or foreign files yield null. */
export function parseRoute(content: string | null): RouteOwner | null {
  const match = content ? HEADER.exec(content) : null;
  return match
    ? { runId: match[1] as string, ownership: match[2] as string, digest: match[3] as string }
    : null;
}
/**
 * One file per environment, imported inside the wildcard `*.apps.<domain>` site block. Swapping the
 * upstream is an atomic file replace plus a graceful reload; there is no admin-API mutation.
 */
export function renderRoute(input: {
  environmentId: string;
  host: string;
  upstream: string;
  owner: RouteOwner;
}) {
  if (!UUID.test(input.environmentId)) throw new Error("Route environment identity is invalid");
  if (!/^[a-z0-9.-]{1,253}$/.test(input.host) || !/^[a-z0-9_.-]+:[0-9]{2,5}$/.test(input.upstream))
    throw new Error("Route host or upstream is invalid");
  const matcher = `@h${input.environmentId.replaceAll("-", "")}`;
  return [
    `# godseye-route run=${input.owner.runId} ownership=${input.owner.ownership} digest=${input.owner.digest}`,
    `${matcher} host ${input.host}`,
    `handle ${matcher} {`,
    `\treverse_proxy ${input.upstream} {`,
    "\t\tflush_interval -1",
    "\t\ttransport http {",
    "\t\t\tdial_timeout 3s",
    "\t\t\tresponse_header_timeout 30s",
    "\t\t}",
    "\t}",
    "}",
    "",
  ].join("\n");
}
/** Atomic file-per-route store (write temp file, rename). */
export class FileRouteStore implements RouteStore {
  constructor(private readonly directory: string) {}
  private path(environmentId: string) {
    if (!UUID.test(environmentId)) throw new Error("Route environment identity is invalid");
    return join(this.directory, `${environmentId}.caddy`);
  }
  async read(environmentId: string) {
    try {
      return await readFile(this.path(environmentId), "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }
  async write(environmentId: string, content: string) {
    await mkdir(this.directory, { recursive: true });
    const target = this.path(environmentId);
    const temporary = `${target}.${process.pid}.tmp`;
    await writeFile(temporary, content, { mode: 0o640 });
    await rename(temporary, target);
  }
  async remove(environmentId: string) {
    await rm(this.path(environmentId), { force: true });
  }
}
/** Validate then gracefully reload Caddy; callers restore the previous route when this throws. */
export async function reloadCaddy(
  run: CommandRunner,
  commands: { validate: readonly string[]; reload: readonly string[] },
) {
  const validated = await run(commands.validate);
  if (validated.code !== 0) throw new Error("Caddy configuration validation failed");
  const reloaded = await run(commands.reload);
  if (reloaded.code !== 0) throw new Error("Caddy reload failed");
}
