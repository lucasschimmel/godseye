import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const python = ["python3", "python"].find(
  (name) => spawnSync(name, ["-c", "import sys; assert sys.version_info >= (3, 10)"]).status === 0,
);
const scripts = resolve(import.meta.dirname, "../scripts");
const PINNED = "a".repeat(64);
const GOOD = {
  osId: "debian",
  osVersion: "13",
  machine: "x86_64",
  kernel: "6.12.0",
  pid1: "systemd",
  cgroupControllers: ["cpu", "memory", "pids", "io"],
  uid: 1000,
  machineId: "m",
  sandbox: "runsc-systrap",
  runscSha256: PINNED,
  userNamespaces: 0,
  kvmDevice: false,
};

function verdict(override: Record<string, unknown>, expectedSha: string | null = PINNED) {
  const program = [
    "import json,sys; sys.path.insert(0, sys.argv[1]); import coding_guest_profile as p",
    "facts = json.loads(sys.argv[2])",
    "try:",
    "    r = p.host_profile(facts, json.loads(sys.argv[3]))",
    "    print(json.dumps({'ok': r}))",
    "except ValueError as e:",
    "    print(json.dumps({'error': str(e)}))",
  ].join("\n");
  const run = spawnSync(
    python ?? "python3",
    [
      "-I",
      "-c",
      program,
      scripts,
      JSON.stringify({ ...GOOD, ...override }),
      JSON.stringify(expectedSha),
    ],
    { encoding: "utf8" },
  );
  return JSON.parse(run.stdout) as { ok?: Record<string, unknown>; error?: string };
}

describe.skipIf(!python)("Debian work-VM host profile checks", () => {
  it("accepts Debian 13 with systemd, cgroup v2 controllers and the pinned runsc", () => {
    expect(verdict({}).ok).toMatchObject({
      isolation: "disposable-vm-container",
      sandbox: "runsc-systrap",
      kvm: "not-required",
    });
  });
  it("rejects a runsc binary that differs from the pinned digest", () => {
    expect(verdict({ runscSha256: "b".repeat(64) }).error).toMatch(/pinned digest/);
  });
  it("rejects a host without cgroup v2", () => {
    expect(verdict({ cgroupControllers: null }).error).toMatch(/cgroup v2/);
  });
  it("rejects missing pids controller", () => {
    expect(verdict({ cgroupControllers: ["cpu", "memory"] }).error).toMatch(/controllers/);
  });
  it("rejects a non-systemd init", () => {
    expect(verdict({ pid1: "init" }).error).toMatch(/systemd/);
  });
  it("rejects running as root", () => {
    expect(verdict({ uid: 0 }).error).toMatch(/unprivileged/);
  });
  it("rejects a non-Debian host", () => {
    expect(verdict({ osId: "ubuntu" }).error).toMatch(/Debian/);
  });
  it("requires user namespaces for the rootless-container sandbox", () => {
    expect(verdict({ sandbox: "rootless-container", userNamespaces: 0 }, null).error).toMatch(
      /user namespaces/,
    );
  });
});
