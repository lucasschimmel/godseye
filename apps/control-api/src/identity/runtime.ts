import { execFile } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { chmod, lstat, mkdir, open, readdir, readFile, realpath, unlink } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { dirname, isAbsolute, join, parse, relative, resolve } from "node:path";
import { promisify } from "node:util";
import { inheritedPrivateEntries } from "./permissions.js";

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
  const descendants = entries.slice(1);
  // Reopening a database must not fork one Windows process for every already-private PG file.
  // This batch is read-only; noncanonical entries still use the original individually guarded reset.
  const inherited = await inheritedPrivateEntries(system, descendants);
  // Reset each verified descendant parent-first; never let a recursive OS command follow a link.
  for (const [index, entry] of descendants.entries()) {
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
    if (inherited.has(index)) continue;
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

/**
 * Identity of one process incarnation, so a recycled PID is not mistaken for the lock holder.
 * Linux: boot id plus /proc starttime (a reboot also changes the boot id). macOS: `ps` start date.
 * Windows: process creation time. Returns undefined when it cannot be proven.
 */
export async function processStartToken(pid: number): Promise<string | undefined> {
  try {
    if (process.platform === "linux") {
      const boot = (await readFile("/proc/sys/kernel/random/boot_id", "utf8")).trim();
      const stat = await readFile(`/proc/${pid}/stat`, "utf8");
      // Field 2 (comm) may contain spaces and parentheses; fields after the last ")" are positional.
      const fields = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
      const start = fields[19]; // field 22 (starttime), counted from field 3 at index 0
      return start && /^\d+$/.test(start) ? `${boot}:${start}` : undefined;
    }
    if (process.platform === "win32") {
      const system = join(process.env.SystemRoot ?? "C:\\Windows", "System32");
      const { stdout } = await execute(
        join(system, "WindowsPowerShell", "v1.0", "powershell.exe"),
        [
          "-NoProfile",
          "-NonInteractive",
          "-Command",
          "(Get-Process -Id ([int][Environment]::GetEnvironmentVariable('GODSEYE_PROBE_PID'))).StartTime.ToUniversalTime().ToString('o')",
        ],
        {
          env: {
            ...process.env,
            PSModulePath: join(system, "WindowsPowerShell", "v1.0", "Modules"),
            GODSEYE_PROBE_PID: String(pid),
          },
        },
      );
      return stdout.trim() || undefined;
    }
    const { stdout } = await execute("ps", ["-o", "lstart=", "-p", String(pid)], {
      env: { ...process.env, LC_ALL: "C" },
    });
    return stdout.trim() || undefined;
  } catch {
    // The process is gone or the platform cannot report it; the caller then stays conservative.
    return undefined;
  }
}

/** A local database/identity state directory has one process, including offline recovery. */
export async function acquireInstance(stateDir: string) {
  await mkdir(stateDir, { recursive: true });
  const guardPath = join(stateDir, "instance.guard");
  const guard = await open(guardPath, "wx", 0o600);
  try {
    const path = join(stateDir, "instance.lock");
    const marker = {
      pid: process.pid,
      id: randomUUID(),
      start: await processStartToken(process.pid),
    };
    try {
      const existing = JSON.parse(await readFile(path, "utf8")) as { pid: number; start?: string };
      if (!Number.isInteger(existing.pid) || existing.pid <= 0)
        throw new Error("Invalid local process lock; verify it before removal");
      let alive = true;
      try {
        process.kill(existing.pid, 0);
      } catch (error) {
        if (!(error instanceof Error && "code" in error && error.code === "ESRCH")) throw error;
        alive = false;
      }
      if (alive) {
        // A live PID only holds the lock when it is the same incarnation that wrote it. Locks from
        // before this field existed, or unreadable process times, stay conservative (still held).
        const current = existing.start ? await processStartToken(existing.pid) : undefined;
        if (!existing.start || !current || current === existing.start)
          throw new Error("The local API or an offline recovery process is already running");
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
