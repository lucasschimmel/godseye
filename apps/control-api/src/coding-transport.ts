import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative, win32 } from "node:path";
import { fileURLToPath } from "node:url";
import type { CodingCapabilityView, CodingIsolation, CodingProvider } from "@godseye/contracts";

/** Stable reason shown to the owner when this host profile has no configured coding transport. */
export const NOT_CONFIGURED_FOR_PROFILE = "unavailable: not-configured-for-profile";

export type CodingTransportProfile = {
  host: string;
  port: number;
  user: string;
  hostKey: string;
  remoteWorkspace: string;
  identityFile: string;
};

const REPOSITORY_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const REMOTE_ENVIRONMENT = "PATH=/usr/bin:/bin";

/** Absolute OpenSSH client; never resolved through an ambient PATH. */
export function sshExecutable(
  platform: NodeJS.Platform,
  systemRoot = process.env.SystemRoot ?? "C:\\Windows",
): string {
  if (platform !== "win32") return "/usr/bin/ssh";
  if (!/^[A-Za-z]:[\\/]/.test(systemRoot))
    throw new Error("Coding Windows system directory unavailable");
  return win32.join(systemRoot, "System32", "OpenSSH", "ssh.exe");
}

/** The deploy key must live outside the repository tree so it can never be committed or mirrored. */
export function assertIdentityOutsideRepository(identityFile: string): void {
  const inside = relative(REPOSITORY_ROOT, identityFile);
  const separate = inside === "" || inside.startsWith("..") || isAbsolute(inside);
  if (!isAbsolute(identityFile) || !separate)
    throw new Error("Coding SSH identity must be an absolute path outside the repository");
}

/** Public host key only: a pinned known_hosts entry with no secret material. */
export function materializeKnownHosts(transport: CodingTransportProfile): string {
  const directory = mkdtempSync(join(tmpdir(), "godseye-coding-ssh-"));
  const file = join(directory, "known_hosts");
  const name = transport.port === 22 ? transport.host : `[${transport.host}]:${transport.port}`;
  writeFileSync(file, `${name} ${transport.hostKey}\n`, { mode: 0o600 });
  return file;
}

/** Fixed argv: strict pinned host key, key-only auth, no tty, no forwarding, one remote control action. */
export function sshArguments(
  transport: CodingTransportProfile,
  knownHostsFile: string,
  action: string,
): string[] {
  const root = transport.remoteWorkspace;
  return [
    "-T",
    "-i",
    transport.identityFile,
    "-p",
    String(transport.port),
    "-o",
    "BatchMode=yes",
    "-o",
    "IdentitiesOnly=yes",
    "-o",
    "StrictHostKeyChecking=yes",
    "-o",
    `UserKnownHostsFile=${knownHostsFile}`,
    "-o",
    "GlobalKnownHostsFile=none",
    "-o",
    "ForwardAgent=no",
    "-o",
    "ClearAllForwardings=yes",
    "-o",
    "ConnectTimeout=10",
    "-o",
    "ServerAliveInterval=10",
    "-o",
    "ServerAliveCountMax=3",
    `${transport.user}@${transport.host}`,
    "--",
    "/usr/bin/env",
    "-i",
    REMOTE_ENVIRONMENT,
    "LC_ALL=C",
    "GODSEYE_CODING_PROFILE=work-vm",
    "/usr/bin/python3",
    "-I",
    `${root}/scripts/coding_guest_control.py`,
    root,
    action,
  ];
}

/** Provider that reports an explicit unavailable state and performs no native action. */
export function unavailableCodingProvider(
  reason: string,
  isolation: CodingIsolation = "disposable-kvm",
): CodingProvider {
  const refused = {
    state: "unknown",
    stopped: false,
    grantsRevoked: false,
    workspace: "quarantined",
  } as const;
  return {
    qualified: false,
    capabilities: () =>
      (["codex", "claude-code"] as const).map(
        (runner): CodingCapabilityView => ({
          runner,
          available: false,
          version: null,
          reason,
          isolation,
          billing: "unavailable",
          auth: "task-scoped-broker",
        }),
      ),
    verifySource: async () => {
      throw new Error("Coding configuration unavailable");
    },
    preflight: async () => {
      throw new Error("Coding configuration unavailable");
    },
    submit: async () => ({ ...refused }),
    inspect: async () => ({ ...refused }),
    stop: async () => ({ ...refused }),
  };
}
