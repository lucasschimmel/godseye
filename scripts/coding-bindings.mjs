/** Explicit private operator binding; no native execution, model request or automatic enablement. */
import { randomUUID } from "node:crypto";
import { lstat, open, realpath, rename, unlink } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { tsImport } from "tsx/esm/api";

const workspace = resolve(fileURLToPath(new URL("..", import.meta.url)));
const MAX_BYTES = 131072;
const KEY_VARIABLES = {
  codex: "GODSEYE_CODEX_API_KEY",
  "claude-code": "GODSEYE_CLAUDE_CODE_API_KEY",
};

export function bindingArguments(args) {
  const [action, ...rest] = args;
  if (!["write", "status"].includes(action) || rest.length % 2)
    throw new Error("Invalid coding binding arguments");
  const values = new Map();
  for (let index = 0; index < rest.length; index += 2) {
    const key = rest[index],
      value = rest[index + 1];
    if (!["--metadata", "--directory"].includes(key) || !value || values.has(key))
      throw new Error("Invalid coding binding arguments");
    values.set(key, value);
  }
  if (action === "write" ? !values.has("--metadata") : values.has("--metadata"))
    throw new Error("Metadata is required only for binding write");
  const directory = resolve(workspace, values.get("--directory") ?? ".local/coding-access");
  const inside = relative(join(workspace, ".local"), directory);
  if (!inside || inside.startsWith("..") || isAbsolute(inside))
    throw new Error("Coding bindings require a dedicated workspace .local directory");
  return {
    action,
    directory,
    metadata: values.has("--metadata") ? resolve(workspace, values.get("--metadata")) : undefined,
  };
}

async function rejectAliases(directory) {
  const normalize = (value) => (process.platform === "win32" ? value.toLowerCase() : value);
  for (let current = directory; ; current = dirname(current)) {
    try {
      const info = await lstat(current);
      if (
        info.isSymbolicLink() ||
        !info.isDirectory() ||
        normalize(await realpath(current)) !== normalize(current)
      )
        throw new Error("Aliased coding binding parent refused");
    } catch (error) {
      if (!(error && typeof error === "object" && error.code === "ENOENT")) throw error;
    }
    if (dirname(current) === current) return;
  }
}

async function metadataDocument(path) {
  const info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || info.size > MAX_BYTES)
    throw new Error("Coding metadata must be a bounded independent file");
  const file = await open(path, "r");
  try {
    const observed = await file.stat();
    if (
      observed.ino !== info.ino ||
      observed.dev !== info.dev ||
      observed.nlink !== 1 ||
      observed.size > MAX_BYTES
    )
      throw new Error("Coding metadata changed while opening");
    const buffer = Buffer.alloc(MAX_BYTES + 1);
    const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
    if (bytesRead > MAX_BYTES) throw new Error("Coding metadata exceeds the byte limit");
    return JSON.parse(buffer.subarray(0, bytesRead).toString("utf8"));
  } finally {
    await file.close();
  }
}

/** Inject only selected process-private API variables; metadata must never contain an API key. */
export async function prepareBinding(metadataPath, environment = process.env) {
  const raw = await metadataDocument(metadataPath);
  if (!raw || typeof raw !== "object" || !Array.isArray(raw.bindings))
    throw new Error("Invalid coding metadata");
  const bindings = raw.bindings.map((binding) => {
    if (
      !binding ||
      typeof binding !== "object" ||
      !binding.broker ||
      typeof binding.broker !== "object" ||
      Object.hasOwn(binding.broker, "apiKey")
    )
      throw new Error("Coding metadata must exclude API keys");
    const variable = KEY_VARIABLES[binding.runner];
    if (!variable || !environment[variable])
      throw new Error("Required private coding API variable is absent");
    return { ...binding, broker: { ...binding.broker, apiKey: environment[variable] } };
  });
  const { CodingPrivateConfiguration } = await tsImport(
    "../apps/control-api/src/coding-provider.ts",
    import.meta.url,
  );
  const configuration = CodingPrivateConfiguration.parse({ ...raw, bindings });
  if (!isAbsolute(configuration.workspace)) throw new Error("Coding workspace must be absolute");
  if (
    new Set(
      configuration.bindings.map(
        (b) => `${b.projectId}:${b.environmentId}:${b.repositoryHash}:${b.runner}`,
      ),
    ).size !== configuration.bindings.length
  )
    throw new Error("Duplicate coding binding refused");
  const serialized = `${JSON.stringify(configuration)}\n`;
  if (Buffer.byteLength(serialized) > MAX_BYTES)
    throw new Error("Coding bindings exceed the private file limit");
  return serialized;
}

export async function bindingStatus(args) {
  const { directory } = bindingArguments(["status", ...args]);
  try {
    await rejectAliases(directory);
    await lstat(join(directory, "bindings.json"));
  } catch (error) {
    if (error && typeof error === "object" && error.code === "ENOENT")
      return { present: false, valid: false };
    return { present: true, valid: false };
  }
  try {
    const { readPrivateJson } = await tsImport(
      "../apps/control-api/src/private-json.ts",
      import.meta.url,
    );
    const { CodingPrivateConfiguration } = await tsImport(
      "../apps/control-api/src/coding-provider.ts",
      import.meta.url,
    );
    CodingPrivateConfiguration.parse(readPrivateJson(join(directory, "bindings.json")));
    return { present: true, valid: true };
  } catch {
    return { present: true, valid: false };
  }
}

async function removeStage(path) {
  try {
    await unlink(path);
  } catch (error) {
    if (!(error && typeof error === "object" && error.code === "ENOENT")) throw error;
  }
}

export async function writeCodingBinding(args, environment = process.env) {
  const { directory, metadata } = bindingArguments(["write", ...args]);
  const serialized = await prepareBinding(metadata, environment);
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
  const release = await acquireInstance(directory);
  const target = join(directory, "bindings.json"),
    stage = join(directory, `.coding-${randomUUID()}.new`);
  try {
    let previous = null;
    try {
      await lstat(target);
      previous = JSON.stringify(readPrivateJson(target));
    } catch (error) {
      if (!(error && typeof error === "object" && error.code === "ENOENT")) throw error;
    }
    const file = await open(stage, "wx", 0o600);
    try {
      await file.writeFile(serialized);
      await file.sync();
    } finally {
      await file.close();
    }
    await rejectAliases(directory);
    await privateDirectory(directory);
    if (previous !== null) {
      if (JSON.stringify(readPrivateJson(target)) !== previous)
        throw new Error("Coding binding changed before publication");
    } else {
      try {
        await lstat(target);
        throw new Error("Coding binding target appeared before publication");
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
    readPrivateJson(target);
    return { configured: true, enabled: false };
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
      "coding:bind write --metadata NONSECRET_JSON [--directory .local/coding-access]\ncoding:bind status [--directory .local/coding-access]\nMetadata follows CodingPrivateConfiguration without broker.apiKey. Keys come only from private process variables GODSEYE_CODEX_API_KEY / GODSEYE_CLAUDE_CODE_API_KEY; never command arguments, metadata or output. No model call. Explicitly opt in on a later API startup with GODSEYE_CODING_BINDINGS_FILE pointing to the protected bindings.json; writing never enables execution.\n",
    );
    return;
  }
  const parsed = bindingArguments(args);
  const result =
    parsed.action === "status"
      ? await bindingStatus(args.slice(1))
      : await writeCodingBinding(args.slice(1));
  process.stdout.write(`${JSON.stringify(result)}\n`);
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch(() => {
    process.stderr.write("Coding binding refused; no private value or path was printed.\n");
    process.exitCode = 1;
  });
}
