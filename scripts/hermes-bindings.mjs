import { randomUUID } from "node:crypto";
import { lstat, open, realpath, rename, unlink } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { tsImport } from "tsx/esm/api";
import { z } from "zod";

const workspace = resolve(fileURLToPath(new URL("..", import.meta.url)));
const roles = ["operations", "security", "research-marketing"];
const Entry = z
  .object({
    projectId: z.string().uuid(),
    environmentId: z.string().uuid(),
    role: z.enum(roles),
    apiKey: z.string().min(16).max(1024),
  })
  .strict();
const Entries = z.array(Entry).max(64);

export function argumentsFor(args) {
  const values = new Map();
  const allowed = new Set(["--project", "--environment", "--role", "--directory"]);
  if (args.length % 2) throw new Error("Invalid binding arguments");
  for (let i = 0; i < args.length; i += 2) {
    if (!allowed.has(args[i]) || !args[i + 1] || values.has(args[i]))
      throw new Error("Invalid binding arguments");
    values.set(args[i], args[i + 1]);
  }
  const scope = Entry.omit({ apiKey: true }).parse({
    projectId: values.get("--project"),
    environmentId: values.get("--environment"),
    role: values.get("--role"),
  });
  const directory = resolve(workspace, values.get("--directory") ?? ".local/hermes-access");
  const inside = relative(join(workspace, ".local"), directory);
  if (!inside || inside.startsWith("..") || isAbsolute(inside))
    throw new Error("Binding directory must be inside this workspace .local tree");
  return { scope, directory };
}

async function readKey(input) {
  if (input.isTTY) throw new Error("Use a protected input pipe instead of an echoed terminal");
  let bytes = 0;
  const chunks = [];
  for await (const chunk of input) {
    const value = Buffer.from(chunk);
    bytes += value.length;
    if (bytes > 2048) throw new Error("Binding input exceeds its limit");
    chunks.push(value);
  }
  const value = Buffer.concat(chunks).toString("utf8").trim();
  if (!/^[\x21-\x7e]{16,1024}$/.test(value))
    throw new Error("One private key is required on standard input");
  return value;
}

async function rejectAliases(directory) {
  const normalize = (value) => (process.platform === "win32" ? value.toLowerCase() : value);
  for (let path = directory; ; path = dirname(path)) {
    try {
      const info = await lstat(path);
      if (
        info.isSymbolicLink() ||
        !info.isDirectory() ||
        normalize(await realpath(path)) !== normalize(path)
      )
        throw new Error("Aliased binding parent is refused");
    } catch (error) {
      if (!(error && typeof error === "object" && error.code === "ENOENT")) throw error;
    }
    if (dirname(path) === path) return;
  }
}

async function removeStage(path) {
  try {
    await unlink(path);
  } catch (error) {
    if (!(error && typeof error === "object" && error.code === "ENOENT")) throw error;
  }
}

export async function writeBinding(args, input = process.stdin) {
  const { scope, directory } = argumentsFor(args);
  const entry = Entry.parse({ ...scope, apiKey: await readKey(input) });
  const { privateDirectory, acquireInstance } = await tsImport(
    "../apps/control-api/src/identity/runtime.ts",
    import.meta.url,
  );
  const { readPrivateJson } = await tsImport(
    "../apps/control-api/src/private-json.ts",
    import.meta.url,
  );
  await rejectAliases(directory);
  await privateDirectory(directory);
  // The existing private administration lock excludes concurrent binding updates without stale-PID killing.
  const release = await acquireInstance(directory);
  const target = join(directory, "bindings.json");
  const stage = join(directory, `.bindings-${randomUUID()}.new`);
  try {
    let entries = [];
    let previous = null;
    try {
      await lstat(target);
      entries = Entries.parse(readPrivateJson(target));
      previous = JSON.stringify(entries);
    } catch (error) {
      if (!(error && typeof error === "object" && error.code === "ENOENT")) throw error;
    }
    const selected = entries.findIndex(
      (item) =>
        item.projectId === scope.projectId &&
        item.environmentId === scope.environmentId &&
        item.role === scope.role,
    );
    if (selected === -1) entries.push(entry);
    else entries[selected] = entry;
    Entries.parse(entries);
    const file = await open(stage, "wx", 0o600);
    try {
      await file.writeFile(`${JSON.stringify(entries)}\n`);
      await file.sync();
    } finally {
      await file.close();
    }
    await rejectAliases(directory);
    await privateDirectory(directory);
    // Revalidate any existing target; aliases/hardlinks are never overwritten or adopted.
    if (previous !== null) {
      if (JSON.stringify(Entries.parse(readPrivateJson(target))) !== previous)
        throw new Error("Bindings changed before publication");
    } else {
      try {
        await lstat(target);
        throw new Error("Binding target appeared before publication");
      } catch (error) {
        if (!(error && typeof error === "object" && error.code === "ENOENT")) throw error;
      }
    }
    await rename(stage, target);
    if (process.platform !== "win32") {
      const parent = await open(directory, "r");
      try {
        await parent.sync();
      } finally {
        await parent.close();
      }
    }
    readPrivateJson(target); // Read-back validates actual OS protection, without printing material.
    return {
      configured: true,
      projectId: scope.projectId,
      environmentId: scope.environmentId,
      role: scope.role,
      file: target,
    };
  } finally {
    try {
      await removeStage(stage);
    } finally {
      await release();
    }
  }
}

async function main(args) {
  if (args.length === 1 && args[0] === "--help") {
    process.stdout.write(
      "Private local binding: hermes:bind --project UUID --environment UUID --role operations|security|research-marketing [--directory .local/hermes-access]\nSupply one API key through standard input, never an argument. Saves an exact scoped binding privately. No model call. Restart the local API with GODSEYE_HERMES_BINDINGS_FILE set to the returned file path.\n",
    );
    return;
  }
  process.stdout.write(`${JSON.stringify(await writeBinding(args))}\n`);
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch(() => {
    process.stderr.write(
      "Local Hermes binding refused. No key was printed; inspect private state before retrying.\n",
    );
    process.exitCode = 1;
  });
}
