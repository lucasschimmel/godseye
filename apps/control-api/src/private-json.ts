import { execFileSync } from "node:child_process";
import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  openSync,
  readFileSync,
  realpathSync,
} from "node:fs";
import { dirname, isAbsolute, join, parse, resolve } from "node:path";

/** Reads an explicitly selected local binding without printing material or weakening its permissions. */
export function readPrivateJson(path: string): unknown {
  return JSON.parse(readPrivateText(path));
}
/** Same private-file checks as {@link readPrivateJson}, for non-JSON material such as PEM keys. */
export function readPrivateText(path: string): string {
  if (!isAbsolute(path)) throw new Error("Private runtime bindings require an absolute file path");
  const absolute = resolve(path),
    root = parse(absolute).root;
  let parent = dirname(absolute);
  while (parent !== root) {
    if (lstatSync(parent).isSymbolicLink())
      throw new Error("Private runtime binding parents cannot be links");
    parent = dirname(parent);
  }
  const info = lstatSync(absolute);
  const normalize = (value: string) => (process.platform === "win32" ? value.toLowerCase() : value);
  if (
    !info.isFile() ||
    info.isSymbolicLink() ||
    info.nlink !== 1 ||
    info.size > 131072 ||
    normalize(realpathSync(absolute)) !== normalize(absolute)
  )
    throw new Error("Private runtime binding must be a bounded independent regular file");
  if (process.platform !== "win32" && info.mode & 0o077)
    throw new Error("Private runtime binding permissions are too broad");
  if (process.platform === "win32") {
    const system = join(process.env.SystemRoot ?? "C:\\Windows", "System32");
    const result = execFileSync(
      join(system, "WindowsPowerShell", "v1.0", "powershell.exe"),
      [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        `
      $ErrorActionPreference='Stop'
      $sid=[System.Security.Principal.WindowsIdentity]::GetCurrent().User
      $acl=[System.IO.File]::GetAccessControl($env:GODSEYE_PERMISSION_TARGET)
      $rules=@($acl.GetAccessRules($true,$true,[System.Security.Principal.SecurityIdentifier]))
      if (!$acl.AreAccessRulesCanonical -or $rules.Count -ne 1 -or $rules[0].IdentityReference -ne $sid -or $rules[0].AccessControlType -ne [System.Security.AccessControl.AccessControlType]::Allow -or $rules[0].FileSystemRights -ne [System.Security.AccessControl.FileSystemRights]::FullControl) { exit 64 }
    `,
      ],
      {
        env: {
          SystemRoot: process.env.SystemRoot,
          GODSEYE_PERMISSION_TARGET: absolute,
          PSModulePath: join(system, "WindowsPowerShell", "v1.0", "Modules"),
        },
        stdio: "ignore",
        timeout: 10000,
        windowsHide: true,
      },
    );
    void result;
  }
  const descriptor = openSync(absolute, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const current = fstatSync(descriptor);
    if (
      current.ino !== info.ino ||
      current.dev !== info.dev ||
      current.nlink !== 1 ||
      current.size > 131072
    )
      throw new Error("Private runtime binding changed while opening");
    return readFileSync(descriptor, "utf8");
  } finally {
    closeSync(descriptor);
  }
}
