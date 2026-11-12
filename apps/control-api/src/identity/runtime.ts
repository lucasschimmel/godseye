import { execFile } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { chmod, lstat, mkdir, open, readdir, readFile, realpath, unlink } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { dirname, isAbsolute, join, parse, relative, resolve } from "node:path";
import { promisify } from "node:util";

const execute = promisify(execFile);

async function canonicalDirectory(directory: string) {
  try {
    return await realpath(resolve(directory));
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
    return resolve(directory);
  }
}

/** Read-only guard: resolve existing aliases and compare Windows paths without case sensitivity. */
export async function assertPrivateTarget(directory: string) {
  const absolute = await canonicalDirectory(directory);
  const normalize = (value: string) => (process.platform === "win32" ? value.toLowerCase() : value);
  const roots = await Promise.all(
    [parse(absolute).root, process.cwd(), homedir(), tmpdir()].map(canonicalDirectory),
  );
  if (roots.map(normalize).includes(normalize(absolute)))
    throw new Error("Refusing to change permissions on a shared root directory");
  return absolute;
}

async function privateTree(root: string): Promise<string[]> {
  const paths: string[] = [];
  async function visit(path: string) {
    const entry = await lstat(path);
    if (entry.isSymbolicLink() || (entry.isFile() && entry.nlink > 1))
      throw new Error("Linked entries are not allowed in private identity state");
    const canonical = await realpath(path);
    const inside = relative(root, canonical);
    if (inside.startsWith("..") || isAbsolute(inside))
      throw new Error("Private state path escaped its controlled directory");
    paths.push(canonical);
    if (entry.isDirectory())
      for (const name of await readdir(canonical)) await visit(join(canonical, name));
  }
  try {
    await lstat(root);
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
    return [];
  }
  await visit(root);
  return paths;
}

/** Apply OS permissions before writing identity material; fail closed if protection fails. */
export async function privateDirectory(directory: string) {
  const requested = await assertPrivateTarget(directory);
  await privateTree(requested);
  await mkdir(requested, { recursive: true, mode: 0o700 });
  const absolute = await assertPrivateTarget(requested);
  const entries = await privateTree(absolute);
  if (process.platform !== "win32") {
    await chmod(absolute, 0o700);
    return;
  }
  const system = join(process.env.SystemRoot ?? "C:\\Windows", "System32");
  // Replace the entire DACL atomically: removing inheritance alone leaves explicit broad grants.
  const protect = `
    $ErrorActionPreference = 'Stop'
    $target = [Environment]::GetEnvironmentVariable('GODSEYE_PERMISSION_TARGET')
    $sid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User
    $acl = New-Object System.Security.AccessControl.DirectorySecurity
    $acl.SetAccessRuleProtection($true, $false)
    $rule = New-Object System.Security.AccessControl.FileSystemAccessRule($sid, 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow')
    $acl.AddAccessRule($rule)
    [System.IO.Directory]::SetAccessControl($target, $acl)
  `;
  await execute(
    join(system, "WindowsPowerShell", "v1.0", "powershell.exe"),
    ["-NoProfile", "-NonInteractive", "-Command", protect],
    {
      env: {
        ...process.env,
        PSModulePath: join(system, "WindowsPowerShell", "v1.0", "Modules"),
        GODSEYE_PERMISSION_TARGET: absolute,
      },
    },
  );
  const acl = join(system, "icacls.exe");
  // Reset each verified descendant parent-first; never let a recursive OS command follow a link.
  for (const entry of entries.slice(1)) {
    const current = await lstat(entry);
    const canonical = await realpath(entry);
    const inside = relative(absolute, canonical);
    if (
      current.isSymbolicLink() ||
      (current.isFile() && current.nlink > 1) ||
      inside.startsWith("..") ||
      isAbsolute(inside)
    )
      throw new Error("Private state entry changed before permission reset");
    await execute(acl, [canonical, "/reset", "/L", "/Q"]);
  }
}

export async function loadIdentityMaterial(identityDir: string) {
  await privateDirectory(identityDir);
  const path = join(identityDir, "identity.key");
  try {
    const file = await open(path, "wx", 0o600);
    try {
      await file.writeFile(randomBytes(48).toString("base64url"));
    } finally {
      await file.close();
    }
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) throw error;
  }
  const key = (await readFile(path, "utf8")).trim();
  if (!/^[A-Za-z0-9_-]{64}$/.test(key)) throw new Error("Identity material is missing or invalid");
  return key;
}

/** A local database/identity state directory has one process, including offline recovery. */
export async function acquireInstance(stateDir: string) {
  await mkdir(stateDir, { recursive: true });
  const guardPath = join(stateDir, "instance.guard");
  const guard = await open(guardPath, "wx", 0o600);
  try {
    const path = join(stateDir, "instance.lock");
    const marker = { pid: process.pid, id: randomUUID() };
    try {
      const existing = JSON.parse(await readFile(path, "utf8")) as { pid: number };
      if (!Number.isInteger(existing.pid) || existing.pid <= 0)
        throw new Error("Invalid local process lock; verify it before removal");
      try {
        process.kill(existing.pid, 0);
        throw new Error("The local API or an offline recovery process is already running");
      } catch (error) {
        if (!(error instanceof Error && "code" in error && error.code === "ESRCH")) throw error;
      }
      await unlink(path);
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
    }
    const handle = await open(path, "wx", 0o600);
    await handle.writeFile(JSON.stringify(marker));
    await handle.close();
    return async () => {
      const existing = JSON.parse(await readFile(path, "utf8")) as { id: string };
      if (existing.id !== marker.id) throw new Error("Local process lock changed unexpectedly");
      await unlink(path);
    };
  } finally {
    await guard.close();
    await unlink(guardPath);
  }
}

export function identityPaths(dataDir: string, stateOverride?: string) {
  const stateDir = resolve(stateOverride ?? `${dataDir}-state`);
  return {
    stateDir,
    identityDir: join(stateDir, "owner"),
    dataDir: resolve(dataDir),
    rootDir: dirname(stateDir),
  };
}
