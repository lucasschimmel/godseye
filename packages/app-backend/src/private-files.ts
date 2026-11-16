import { execFile } from "node:child_process";
import { constants } from "node:fs";
import { chmod, lstat, mkdir, open, readdir, realpath } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { dirname, isAbsolute, join, parse, relative, resolve } from "node:path";
import { ApplicationError } from "./contracts.js";
import type { ApplicationState } from "./state.js";

export async function protectApplicationDirectory(directory: string) {
  const root = resolve(directory);
  if (
    [parse(root).root, resolve(process.cwd()), resolve(homedir()), resolve(tmpdir())].some(
      (entry) => entry.toLowerCase() === root.toLowerCase(),
    )
  )
    throw new ApplicationError(
      "UNSAFE_STORAGE",
      "Application files require a dedicated private directory",
      422,
    );
  let parent = root;
  while (true) {
    try {
      if ((await lstat(parent)).isSymbolicLink())
        throw new ApplicationError("UNSAFE_STORAGE", "Linked storage ancestors are refused", 422);
    } catch (error) {
      if (!isMissing(error)) throw error;
    }
    if (dirname(parent) === parent) break;
    parent = dirname(parent);
  }
  await mkdir(root, { recursive: true, mode: 0o700 });
  if ((await lstat(root)).isSymbolicLink())
    throw new ApplicationError("UNSAFE_STORAGE", "Linked application storage is refused", 422);
  const entries: string[] = [];
  const visit = async (path: string): Promise<void> => {
    const metadata = await lstat(path);
    if (metadata.isSymbolicLink() || (metadata.isFile() && metadata.nlink !== 1))
      throw new ApplicationError("UNSAFE_STORAGE", "Linked private state is refused", 409);
    entries.push(path);
    if (metadata.isDirectory())
      for (const name of await readdir(path)) await visit(join(path, name));
  };
  await visit(root);
  if (process.platform === "win32") {
    const system = join(process.env.SystemRoot ?? "C:\\Windows", "System32");
    await new Promise<void>((done, reject) => {
      const child = execFile(
        join(system, "WindowsPowerShell", "v1.0", "powershell.exe"),
        [
          "-NoProfile",
          "-NonInteractive",
          "-Command",
          `
      $ErrorActionPreference='Stop'
      $entries=ConvertFrom-Json ([Console]::In.ReadToEnd())
      $sid=[System.Security.Principal.WindowsIdentity]::GetCurrent().User
      foreach ($entry in $entries) {
        $attributes=[System.IO.File]::GetAttributes($entry)
        if (($attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'Linked private state refused' }
        if (($attributes -band [System.IO.FileAttributes]::Directory) -ne 0) {
          $acl=New-Object System.Security.AccessControl.DirectorySecurity
          $acl.SetAccessRuleProtection($true,$false)
          $rule=New-Object System.Security.AccessControl.FileSystemAccessRule($sid,'FullControl','ContainerInherit,ObjectInherit','None','Allow')
          $acl.AddAccessRule($rule)
          [System.IO.Directory]::SetAccessControl($entry,$acl)
        } else {
          $acl=New-Object System.Security.AccessControl.FileSecurity
          $acl.SetAccessRuleProtection($true,$false)
          $rule=New-Object System.Security.AccessControl.FileSystemAccessRule($sid,'FullControl','Allow')
          $acl.AddAccessRule($rule)
          [System.IO.File]::SetAccessControl($entry,$acl)
        }
      }
    `,
        ],
        { timeout: 30000 },
        (error) => (error ? reject(error) : done()),
      );
      child.stdin?.end(JSON.stringify(entries));
    });
  } else {
    for (const path of entries)
      await chmod(path, (await lstat(path)).isDirectory() ? 0o700 : 0o600);
  }
  return realpath(root);
}
export async function prepareApplicationFiles(state: ApplicationState) {
  const root = await protectApplicationDirectory(state.filesRoot);
  state.filesRoot = root;
  const scope = JSON.stringify({ ...state.scope, storeId: state.store.id });
  let marker: Awaited<ReturnType<typeof open>> | undefined;
  try {
    marker = await open(join(root, "cell.json"), "wx", 0o600);
    await marker.writeFile(scope);
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) throw error;
  } finally {
    await marker?.close();
  }
  const existing = await openApplicationFile(state, "cell.json");
  try {
    if ((await existing.readFile("utf8")) !== scope)
      throw new ApplicationError(
        "STORE_SCOPE_MISMATCH",
        "Application filesystem belongs to another cell",
        409,
      );
  } finally {
    await existing.close();
  }
}
export function isMissing(error: unknown) {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}
export async function assertApplicationRoot(state: ApplicationState) {
  const metadata = await lstat(state.filesRoot);
  if (
    !metadata.isDirectory() ||
    metadata.isSymbolicLink() ||
    (await realpath(state.filesRoot)) !== state.filesRoot
  )
    throw new ApplicationError("UNSAFE_STORAGE", "Application root changed or became linked", 409);
}
export function applicationFilePath(state: ApplicationState, id: string) {
  if (!/^[a-f0-9-]{36}$/.test(id))
    throw new ApplicationError("NOT_FOUND", "Application file not found", 404);
  return join(state.filesRoot, id);
}
export async function openApplicationFile(state: ApplicationState, id: string, writable = false) {
  await assertApplicationRoot(state);
  const path = ["cell.json", "recovery.json", "identity.key"].includes(id)
    ? join(state.filesRoot, id)
    : applicationFilePath(state, id);
  const metadata = await lstat(path);
  const inside = relative(state.filesRoot, await realpath(path));
  if (
    !metadata.isFile() ||
    metadata.isSymbolicLink() ||
    metadata.nlink !== 1 ||
    inside.startsWith("..") ||
    isAbsolute(inside)
  )
    throw new ApplicationError("UNSAFE_STORAGE", "Linked or foreign objects are refused", 409);
  const handle = await open(
    path,
    (writable ? constants.O_RDWR : constants.O_RDONLY) | (constants.O_NOFOLLOW ?? 0),
  );
  const current = await handle.stat();
  if (current.ino !== metadata.ino || current.dev !== metadata.dev || current.nlink !== 1) {
    await handle.close();
    throw new ApplicationError("UNSAFE_STORAGE", "Application object changed during open", 409);
  }
  return handle;
}
