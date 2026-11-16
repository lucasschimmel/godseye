import { spawn } from "node:child_process";
import { join } from "node:path";

const MAX_PERMISSION_INPUT_BYTES = 16 * 1024 * 1024;
const MAX_PERMISSION_OUTPUT_BYTES = 1024 * 1024;
const PERMISSION_INSPECTION_TIMEOUT_MS = 30_000;
const inspectInherited = `
  $ErrorActionPreference = 'Stop'
  $targets = ConvertFrom-Json -InputObject ([Console]::In.ReadToEnd())
  $sid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value
  $accepted = New-Object 'System.Collections.Generic.List[int]'
  for ($index = 0; $index -lt $targets.Count; $index++) {
    $target = [string]$targets[$index]
    $directory = [System.IO.Directory]::Exists($target)
    $acl = if ($directory) { [System.IO.Directory]::GetAccessControl($target) } else { [System.IO.File]::GetAccessControl($target) }
    $rules = @($acl.GetAccessRules($true, $true, [System.Security.Principal.SecurityIdentifier]))
    if ($acl.AreAccessRulesProtected -or !$acl.AreAccessRulesCanonical -or $rules.Count -ne 1) { continue }
    $rule = $rules[0]
    $inheritance = if ($directory) { [System.Security.AccessControl.InheritanceFlags]'ContainerInherit,ObjectInherit' } else { [System.Security.AccessControl.InheritanceFlags]::None }
    if ($rule.IsInherited -and $rule.IdentityReference.Value -eq $sid -and
        $rule.AccessControlType -eq [System.Security.AccessControl.AccessControlType]::Allow -and
        $rule.FileSystemRights -eq [System.Security.AccessControl.FileSystemRights]::FullControl -and
        $rule.InheritanceFlags -eq $inheritance -and
        $rule.PropagationFlags -eq [System.Security.AccessControl.PropagationFlags]::None) { $accepted.Add($index) }
  }
  ConvertTo-Json -InputObject @($accepted.ToArray()) -Compress
`;

/** Read only: identify exact inherited owner-only ACLs; every mutation retains the caller's guards. */
export function inheritedPrivateEntries(system: string, paths: string[]): Promise<Set<number>> {
  if (!paths.length) return Promise.resolve(new Set());
  const input = JSON.stringify(paths);
  if (Buffer.byteLength(input) > MAX_PERMISSION_INPUT_BYTES)
    return Promise.reject(new Error("Private permission inspection exceeds its bounded input"));
  return new Promise((resolve, reject) => {
    const child = spawn(
      join(system, "WindowsPowerShell", "v1.0", "powershell.exe"),
      ["-NoProfile", "-NonInteractive", "-Command", inspectInherited],
      {
        env: { ...process.env, PSModulePath: join(system, "WindowsPowerShell", "v1.0", "Modules") },
        windowsHide: true,
        stdio: ["pipe", "pipe", "pipe"],
      },
    );
    let output = "",
      settled = false;
    const fail = () => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        child.kill("SIGKILL");
        reject(new Error("Private permission inspection failed"));
      }
    };
    const timer = setTimeout(fail, PERMISSION_INSPECTION_TIMEOUT_MS);
    child.on("error", fail);
    child.stdin.on("error", fail);
    child.stderr.on("data", () => undefined);
    child.stdout.on("data", (chunk: Buffer) => {
      output += chunk.toString("utf8");
      if (Buffer.byteLength(output) > MAX_PERMISSION_OUTPUT_BYTES) fail();
    });
    child.on("close", (code) => {
      if (settled) return;
      if (code !== 0) {
        fail();
        return;
      }
      try {
        const result: unknown = JSON.parse(output);
        if (
          !Array.isArray(result) ||
          result.some((index) => !Number.isSafeInteger(index) || index < 0 || index >= paths.length)
        )
          throw new Error("Invalid permission response");
        settled = true;
        clearTimeout(timer);
        resolve(new Set(result));
      } catch {
        fail();
      }
    });
    child.stdin.end(input);
  });
}
