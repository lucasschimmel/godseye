import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { PassThrough, Writable } from "node:stream";
import { describe, expect, it } from "vitest";
import {
  CodingPrivateConfiguration,
  type CodingPrivateConfigurationView,
  type CodingSpawner,
  createCodingProvider,
  hostKeyFingerprint,
} from "../apps/control-api/src/coding-provider.js";
import { codingStartupOptions } from "../apps/control-api/src/coding-startup.js";
import { NOT_CONFIGURED_FOR_PROFILE } from "../apps/control-api/src/coding-transport.js";

const keyBlob = Buffer.concat([
  Buffer.from([0, 0, 0, 11]),
  Buffer.from("ssh-ed25519"),
  Buffer.from([0, 0, 0, 32]),
  Buffer.alloc(32, 7),
]);
const hostKey = `ssh-ed25519 ${keyBlob.toString("base64")}`;
const outsideKey = process.platform === "win32" ? "C:\\ssh-keys\\work-vm" : "/etc/godseye/work-vm";
const binding = {
  projectId: randomUUID(),
  environmentId: randomUUID(),
  repositoryHash: "b".repeat(64),
  runner: "codex" as const,
  sourceDirectory: "/srv/source",
  broker: {
    runner: "codex" as const,
    model: "gpt-5.4-mini" as const,
    apiKey: "synthetic-private-value-no-authority",
    maxRequests: 1,
    maxRequestBytes: 1000,
    maxResponseBytes: 1000,
    maxOutputTokens: 32,
    requestTimeoutSeconds: 5,
  },
};
const capacity = {
  memoryMiB: 8192,
  cpuMilliCores: 2000,
  maxProcesses: 128,
  diskMiB: 8192,
  vmmOverheadMiB: 512,
};
function workVm(identityFile = outsideKey): CodingPrivateConfigurationView {
  return {
    version: 1,
    capacity,
    bindings: [binding],
    transport: {
      kind: "work-vm",
      host: "10.20.3.10",
      port: 22,
      user: "godseye",
      hostKey,
      hostKeyFingerprint: hostKeyFingerprint(hostKey),
      remoteWorkspace: "/srv/godseye",
      identityFile,
    },
  };
}
type Call = { command: string; args: string[] };
function recordingSpawner(calls: Call[]): CodingSpawner {
  return ((command: string, args: string[]) => {
    calls.push({ command, args });
    const events = new EventEmitter();
    const stdout = new PassThrough();
    const stdin = new Writable({
      write(_chunk, _encoding, done) {
        stdout.write(
          `${JSON.stringify({ available: true, reason: "synthetic", versions: { codex: "1" } })}\n`,
        );
        queueMicrotask(() => events.emit("close", 0));
        done();
      },
    });
    return Object.assign(events, {
      stdin,
      stdout,
      stderr: new PassThrough(),
      kill: () => true,
    });
  }) as unknown as CodingSpawner;
}

describe("sealed OpenBao leaves rendered bindings absent", () => {
  const missing =
    process.platform === "win32"
      ? "C:\\run\\godseye-bindings\\absent.json"
      : "/run/godseye-bindings/absent.json";
  it("reports coding unavailable instead of failing startup when the tmpfs file is absent", async () => {
    const options = await codingStartupOptions({ GODSEYE_CODING_BINDINGS_FILE: missing }, "linux");
    expect(options.provider?.capabilities().every((c) => !c.available)).toBe(true);
  });
  it("leaves the Hermes provider absent when its tmpfs file is absent", async () => {
    const { configuredHermesProvider } = await import("../apps/control-api/src/hermes-provider.js");
    expect(configuredHermesProvider({ GODSEYE_HERMES_BINDINGS_FILE: missing })).toBeUndefined();
  });
});

describe("coding work-VM transport and Linux profile states", () => {
  it("reports not-configured-for-profile on Linux when no transport is configured", async () => {
    const options = await codingStartupOptions({}, "linux");
    const capabilities = options.provider?.capabilities() ?? [];
    expect(capabilities.map((c) => [c.available, c.reason])).toEqual([
      [false, NOT_CONFIGURED_FOR_PROFILE],
      [false, NOT_CONFIGURED_FOR_PROFILE],
    ]);
  });
  it("refuses a WSL-only configuration on Linux without launching anything", async () => {
    const calls: Call[] = [];
    const provider = await createCodingProvider(
      { version: 1, capacity, bindings: [binding], workspace: "/srv/godseye", distro: "Ubuntu" },
      { platform: "linux", spawner: recordingSpawner(calls) },
    );
    expect(provider.capabilities()[0]?.reason).toBe(NOT_CONFIGURED_FOR_PROFILE);
    expect(calls).toEqual([]);
  });
  it("speaks the control protocol over pinned SSH and labels the weaker isolation", async () => {
    const calls: Call[] = [];
    const provider = await createCodingProvider(workVm(), {
      platform: "linux",
      spawner: recordingSpawner(calls),
      knownHostsFile: "/run/godseye/known_hosts",
    });
    const [capability] = provider.capabilities();
    expect([capability?.available, capability?.isolation]).toEqual([
      true,
      "disposable-vm-container",
    ]);
    const call = calls[0];
    expect(call?.command).toBe("/usr/bin/ssh");
    expect(call?.args).toEqual(
      expect.arrayContaining([
        "StrictHostKeyChecking=yes",
        "BatchMode=yes",
        "UserKnownHostsFile=/run/godseye/known_hosts",
        "godseye@10.20.3.10",
        "/srv/godseye/scripts/coding_work_vm_control.py",
        "readiness",
      ]),
    );
    expect(JSON.stringify(call?.args)).not.toContain(binding.broker.apiKey);
  });
  it("refuses an SSH identity stored inside the repository", async () => {
    await expect(createCodingProvider(workVm("scripts/work-vm-key"))).rejects.toThrow(
      /outside the repository/,
    );
  });
  it("refuses a host key that does not match its pinned fingerprint", () => {
    const value = workVm();
    const transport = "transport" in value ? value.transport : undefined;
    const parsed = CodingPrivateConfiguration.safeParse({
      ...value,
      transport: { ...transport, hostKeyFingerprint: `SHA256:${"A".repeat(43)}` },
    });
    expect(parsed.success).toBe(false);
  });
});
