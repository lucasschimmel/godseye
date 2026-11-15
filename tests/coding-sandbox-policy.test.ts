import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const python = ["python3", "python"].find(
  (name) => spawnSync(name, ["-c", "import sys; assert sys.version_info >= (3, 10)"]).status === 0,
);
const scripts = resolve(import.meta.dirname, "../scripts");
const posix = process.platform !== "win32";

/** Run a short program in an isolated interpreter with the scripts directory importable. */
function py<T>(body: string, ...args: string[]): T {
  const program = [
    "import json, sys, importlib.util",
    "def load(name):",
    "    spec = importlib.util.spec_from_file_location(name, sys.argv[1] + '/' + name + '.py')",
    "    module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module); return module",
    "def attempt(call):",
    "    try:",
    "        return {'ok': call()}",
    "    except (ValueError, KeyError, RuntimeError) as error:",
    "        return {'error': str(error)}",
    body,
  ].join("\n");
  const run = spawnSync(python ?? "python3", ["-I", "-c", program, scripts, ...args], {
    encoding: "utf8",
  });
  if (run.status !== 0) throw new Error(`python failed: ${run.stderr}`);
  return JSON.parse(run.stdout) as T;
}

const TASK = "11111111-2222-4333-8444-555555555555";
const BINDS = {
  "/usr": "/usr",
  "/opt/coding": "/srv/cli",
  "/coding": "/srv/run/coding",
  "/task.json": "/srv/run/task.json",
  "/source.git": "/srv/run/source.git",
};

describe.skipIf(!python)("work-VM sandbox policy", () => {
  const verdicts = (mutation: string) =>
    py<Record<string, { error?: string; ok?: unknown }>>(
      [
        "policy = load('coding_sandbox_policy')",
        "binds = json.loads(sys.argv[2])",
        "def fresh(): return policy.oci_config('/srv/run/rootfs', binds, sys.argv[3])",
        "mutations = {}",
        "base = fresh(); mutations['valid'] = attempt(lambda: policy.validate_oci(base, binds))",
        mutation,
        "print(json.dumps(mutations))",
      ].join("\n"),
      JSON.stringify(BINDS),
      TASK,
    );

  it("accepts the reviewed bundle and rejects every widening of it", () => {
    const result = verdicts(
      [
        "def run(name, edit):",
        "    config = fresh(); edit(config); mutations[name] = attempt(lambda: policy.validate_oci(config, binds))",
        "run('rw-bind', lambda c: [m['options'].remove('ro') for m in c['mounts'] if m['destination'] == '/usr'])",
        "run('host-bind', lambda c: c['mounts'].append({'destination': '/etc', 'type': 'bind', 'source': '/etc', 'options': ['ro']}))",
        "run('host-network', lambda c: c['linux']['namespaces'].__setitem__(4, {'type': 'network', 'path': '/proc/1/ns/net'}))",
        "run('no-network-ns', lambda c: c['linux']['namespaces'].pop())",
        "run('extra-cap', lambda c: c['process']['capabilities']['bounding'].append('CAP_SYS_ADMIN'))",
        "run('ambient-cap', lambda c: c['process']['capabilities']['ambient'].append('CAP_KILL'))",
        "run('writable-root', lambda c: c['root'].update(readonly=False))",
        "run('new-privs', lambda c: c['process'].update(noNewPrivileges=False))",
        "run('unprivileged-worker', lambda c: c['process'].update(user={'uid': 1000, 'gid': 1000}))",
        "run('device-mount', lambda c: c['mounts'].append({'destination': '/dev/kvm', 'type': 'devtmpfs', 'source': 'x'}))",
        "run('no-memory-limit', lambda c: c['linux']['resources'].clear())",
        "run('other-usr-source', lambda c: [m.update(source='/home') for m in c['mounts'] if m['destination'] == '/usr'])",
      ].join("\n"),
    );
    expect(result.valid).toEqual({ ok: null });
    for (const name of Object.keys(result).filter((key) => key !== "valid"))
      expect(result[name]?.error, name).toBeTruthy();
  });

  it("derives exact, matching unit properties and controls", () => {
    const value = py<{ properties: string[]; controls: Record<string, string> }>(
      [
        "policy = load('coding_sandbox_policy')",
        "unit = policy.unit_name(sys.argv[2])",
        "print(json.dumps({'properties': policy.unit_properties(unit, 9999), 'controls': policy.expected_controls()}))",
      ].join("\n"),
      TASK,
    );
    expect(value.properties).toEqual(
      expect.arrayContaining([
        "--property=MemoryMax=2048M",
        "--property=MemorySwapMax=0",
        "--property=CPUQuota=100%",
        "--property=TasksMax=512",
        "--property=RuntimeMaxSec=180",
        "--property=OOMPolicy=kill",
        `--unit=godseye-coding-${TASK}.service`,
      ]),
    );
    expect(value.controls).toEqual({
      "memory.max": String(2048 * 1024 * 1024),
      "memory.swap.max": "0",
      "cpu.max": "100000 100000",
      "pids.max": "512",
    });
  });

  it("refuses malformed identities and a root service user", () => {
    const value = py<Record<string, { error?: string }>>(
      [
        "policy = load('coding_sandbox_policy')",
        "unit = policy.unit_name(sys.argv[2])",
        "out = {",
        "  'task': attempt(lambda: policy.unit_name('../../etc')),",
        "  'root-cgroup': attempt(lambda: policy.unit_cgroup(0, unit)),",
        "  'unit': attempt(lambda: policy.unit_cgroup(994, 'ssh.service')),",
        "  'env-root': attempt(lambda: policy.user_environment(0)),",
        "}",
        "out['cgroup'] = attempt(lambda: policy.unit_cgroup(994, unit))",
        "print(json.dumps(out))",
      ].join("\n"),
      TASK,
    );
    expect(value.task?.error).toBeTruthy();
    expect(value["root-cgroup"]?.error).toBeTruthy();
    expect(value.unit?.error).toBeTruthy();
    expect(value["env-root"]?.error).toBeTruthy();
    expect(value.cgroup).toEqual({
      ok: `/user.slice/user-994.slice/user@994.service/app.slice/godseye-coding-${TASK}.service`,
    });
  });

  it("starts runsc rootless with systrap, no network and the outer cgroup as the only limit", () => {
    const argv = py<string[]>(
      "policy = load('coding_sandbox_policy'); print(json.dumps(policy.runsc_arguments('/opt/runsc', '/s', '/b', 'c')))",
    );
    expect(argv).toEqual(
      expect.arrayContaining([
        "--platform=systrap",
        "--network=none",
        "--ignore-cgroups=true",
        "--map-root-user",
      ]),
    );
    expect(argv.some((value) => value.includes("host"))).toBe(false);
  });

  it("judges adversarial evidence strictly: missing or partial evidence fails", () => {
    const verdict = (name: string, markers: object) =>
      py<{ passed: boolean }>(
        "policy = load('coding_sandbox_policy'); print(json.dumps(policy.verdict_for_case(sys.argv[2], json.loads(sys.argv[3]))))",
        name,
        JSON.stringify(markers),
      ).passed;
    expect(
      verdict("escape", {
        uid: 1000,
        hostFilesVisible: [],
        writesSucceeded: [],
        privilegedOps: [],
      }),
    ).toBe(true);
    expect(
      verdict("escape", {
        uid: 1000,
        hostFilesVisible: ["/opt/godseye"],
        writesSucceeded: [],
        privilegedOps: [],
      }),
    ).toBe(false);
    expect(
      verdict("escape", { uid: 0, hostFilesVisible: [], writesSucceeded: [], privilegedOps: [] }),
    ).toBe(false);
    expect(verdict("egress", { connected: [], interfaces: ["lo"], routes: 0 })).toBe(true);
    expect(verdict("egress", { connected: ["10.20.1.10:22"], interfaces: ["lo"], routes: 0 })).toBe(
      false,
    );
    expect(verdict("egress", { connected: [], interfaces: ["lo", "eth0"], routes: 0 })).toBe(false);
    expect(verdict("exhaust-memory", {})).toBe(false);
    expect(verdict("exhaust-memory", { reachedLimit: true, peakMemoryBytes: 1979613184 })).toBe(
      true,
    );
    expect(verdict("exhaust-memory", { reachedLimit: true, peakMemoryBytes: 2 ** 33 })).toBe(false);
    expect(verdict("exhaust-pids", { forked: 230, refused: true, peakPids: 512 })).toBe(true);
    expect(verdict("exhaust-pids", { forked: 400, refused: false, peakPids: 852 })).toBe(false);
    expect(verdict("exhaust-disk", { refused: "ENOSPC", written: 134217728 })).toBe(true);
    expect(verdict("exhaust-disk", { refused: null, written: 2 ** 31 })).toBe(false);
    expect(verdict("hang", { started: true, sandboxEnded: true })).toBe(true);
    expect(verdict("hang", { started: true })).toBe(false);
    expect(verdict("not-a-case", { anything: true })).toBe(false);
  });
});

describe.skipIf(!python)("work-VM SSH gate", () => {
  const gate = (command: string | null) =>
    py<{ ok?: string[]; error?: string }>(
      [
        "gate = load('coding_work_vm_gate')",
        "command = json.loads(sys.argv[2])",
        "print(json.dumps(attempt(lambda: gate.permitted(command))))",
      ].join("\n"),
      JSON.stringify(command),
    );
  const line = (action: string, workspace = "/opt/godseye") =>
    `/usr/bin/env -i PATH=/usr/bin:/bin LC_ALL=C GODSEYE_CODING_PROFILE=work-vm /usr/bin/python3 -I ${workspace}/scripts/coding_work_vm_control.py ${workspace} ${action}`;

  it("permits exactly the production bridge actions", () => {
    for (const action of ["readiness", "source", "preflight", "run", "inspect", "stop"])
      expect(gate(line(action)).ok?.at(-1)).toBe(action);
  });
  it("refuses the laboratory action, shells, other workspaces and injected arguments", () => {
    for (const command of [
      line("lab"),
      line("run", "/tmp/evil"),
      `${line("run")} extra`,
      `${line("run")}; id`,
      "/bin/sh",
      "scp -t /tmp",
      "",
      null,
      `${line("run")}\n`,
    ])
      expect(gate(command).error, String(command)).toBeTruthy();
  });
});

describe.skipIf(!python)("work-VM qualification evidence gates readiness", () => {
  const readiness = (setup: string) =>
    py<{ gap: string | null; available: boolean }>(
      [
        "import tempfile, pathlib, os",
        "profile = load('coding_guest_profile')",
        "profile.runsc_sha256 = lambda root=None, runsc=None: 'r' * 64",
        "profile.source_hashes = lambda workspace: {'a.py': 'h'}",
        "workspace = pathlib.Path(tempfile.mkdtemp())",
        "(workspace / 'artifacts/work-vm/cli').mkdir(parents=True)",
        "cli = {'version': 'work-vm-cli-v1', 'files': {'codex': 'c', 'claude': 'd'}, 'versions': {'codex': '1', 'claude': '2'}}",
        "(workspace / profile.CLI_MANIFEST).write_text(json.dumps(cli))",
        "def gates(runner, passed=True):",
        "    return {name: {'passed': passed} for name in profile.RUNNER_GATES}",
        "proof = {'version': profile.QUALIFICATION_VERSION, 'runscSha256': 'r' * 64, 'sourceHashes': {'a.py': 'h'},",
        "         'cliFiles': cli['files'], 'shared': {n: {'passed': True} for n in profile.SHARED_GATES}, 'runners': {'codex': gates('codex')}}",
        setup,
        "print(json.dumps({'gap': profile.qualification_gap(workspace, 'codex')}))",
      ].join("\n"),
    );

  it("is unavailable without any evidence file", () => {
    expect(readiness("pass").gap).toMatch(/evidence is absent/);
  });
  it("is available only when every runner and shared gate is recorded as passed", () => {
    expect(
      readiness("(workspace / profile.QUALIFICATION).write_text(json.dumps(proof))").gap,
    ).toBeNull();
  });
  it("names the first unpassed gate, including shared gates only the owner can satisfy", () => {
    const missingShared = readiness(
      "proof['shared']['vm-egress-allowlist']['passed'] = False; (workspace / profile.QUALIFICATION).write_text(json.dumps(proof))",
    );
    expect(missingShared.gap).toBe("Work-VM qualification gate not passed: vm-egress-allowlist");
    const missingRunner = readiness(
      "proof['runners']['codex']['adversarial-escape']['passed'] = False; (workspace / profile.QUALIFICATION).write_text(json.dumps(proof))",
    );
    expect(missingRunner.gap).toBe(
      "Work-VM qualification gate not passed: codex:adversarial-escape",
    );
  });
  it("treats evidence as stale after any runtime source, runsc or CLI byte changes", () => {
    for (const edit of [
      "proof['sourceHashes'] = {'a.py': 'changed'}",
      "proof['runscSha256'] = 'x' * 64",
      "proof['cliFiles'] = {'codex': 'other', 'claude': 'd'}",
    ])
      expect(
        readiness(`${edit}; (workspace / profile.QUALIFICATION).write_text(json.dumps(proof))`).gap,
      ).toMatch(/stale/);
  });
});

describe.skipIf(!python || !posix)("work-VM sandbox runner preparation", () => {
  it("materializes only plain inert source files and refuses traversal", () => {
    const value = py<Record<string, { error?: string; ok?: unknown }>>(
      [
        "import io, tarfile, tempfile, pathlib",
        "runner = load('coding_sandbox_runner')",
        "def archive(entries):",
        "    buffer = io.BytesIO()",
        "    with tarfile.open(fileobj=buffer, mode='w') as t:",
        "        for name, data, kind in entries:",
        "            info = tarfile.TarInfo(name); info.size = len(data); info.type = kind",
        "            t.addfile(info, io.BytesIO(data))",
        "    return buffer.getvalue()",
        "def write(entries):",
        "    return attempt(lambda: bool(runner._write_tree(pathlib.Path(tempfile.mkdtemp()), archive(entries))))",
        "plain = ('source.git/HEAD', b'ref', tarfile.REGTYPE)",
        "print(json.dumps({",
        "  'plain': write([plain]),",
        "  'traversal': write([(b'source.git/../../x'.decode(), b'x', tarfile.REGTYPE)]),",
        "  'outside': write([(b'other/x'.decode(), b'x', tarfile.REGTYPE)]),",
        "  'symlink': write([(b'source.git/l'.decode(), b'', tarfile.SYMTYPE)]),",
        "}))",
      ].join("\n"),
    );
    expect(value.plain).toEqual({ ok: true });
    for (const name of ["traversal", "outside", "symlink"])
      expect(value[name]?.error, name).toBeTruthy();
  });

  it("parses systemd's final unit result and the guest markers", () => {
    const value = py<{ result: string | null; none: string | null; markers: unknown[] }>(
      [
        "runner = load('coding_sandbox_runner')",
        "lines = ['STDERR Running as unit: x', 'STDERR Finished with result: oom-kill', 'GODSEYE_ADVERSARY {\"case\": \"escape\"}', 'GODSEYE_ADVERSARY plain-marker']",
        "print(json.dumps({'result': runner.unit_result(lines), 'none': runner.unit_result(['x']), 'markers': runner.adversary_markers(lines)}))",
      ].join("\n"),
    );
    expect(value).toEqual({
      result: "oom-kill",
      none: null,
      markers: [{ case: "escape" }, "plain-marker"],
    });
  });

  it("refuses a replayed task directory and a root host user", () => {
    const value = py<Record<string, { error?: string }>>(
      [
        "import tempfile, pathlib, os",
        "runner = load('coding_sandbox_runner')",
        "workspace = pathlib.Path(tempfile.mkdtemp())",
        "(workspace / 'scripts').mkdir()",
        "for name in ('coding_sandbox_worker.mjs', 'coding_sandbox_proxy.mjs', 'coding_runner_config.mjs'):",
        "    (workspace / 'scripts' / name).write_text('//')",
        "task = {'runner': 'codex', 'syntheticFixture': True}",
        "tid = sys.argv[2]",
        "first = attempt(lambda: runner.prepare(workspace, tid, task, None, 'r' * 64)['imageHash'])",
        "replay = attempt(lambda: runner.prepare(workspace, tid, task, None, 'r' * 64))",
        "bundle = json.loads((workspace / 'artifacts/work-vm/run' / tid / 'bundle/config.json').read_text())",
        "print(json.dumps({'first': {'ok': bool(first.get('ok'))}, 'replay': replay, 'process': {'ok': bundle['process']['args']}}))",
      ].join("\n"),
      TASK,
    );
    expect(value.first).toEqual({ ok: true });
    expect(value.replay?.error).toMatch(/replaying/);
    expect(value.process).toEqual({ ok: ["/usr/bin/node", "/coding/worker.mjs"] });
  });
});

describe.skipIf(!python)("work-VM qualification harness verdicts", () => {
  it("accepts the fixture chain only with a passing test, a patch, both commands and a physical stop", () => {
    const verdict = (override: string) =>
      py<{ ok: boolean; why: string }>(
        [
          "q = load('coding_sandbox_qualify')",
          "state = {'state': 'succeeded', 'stopped': True, 'guestResult': {'runner': 'codex', 'patch': '+module.exports = 42;', 'test': {'code': 0}},",
          "         'fixtureState': {'commands': q.EXPECTED_COMMANDS, 'completed': True}}",
          override,
          "ok, why = q.chain_passed(state, 'codex')",
          "print(json.dumps({'ok': ok, 'why': why}))",
        ].join("\n"),
      );
    expect(verdict("pass").ok).toBe(true);
    expect(verdict("state['stopped'] = False").why).toMatch(/stopped/);
    expect(verdict("state['guestResult']['test']['code'] = 1").why).toMatch(/testPassed/);
    expect(verdict("state['guestResult']['patch'] = ''").why).toMatch(/patchEdits/);
    expect(verdict("state['fixtureState']['commands'] = []").why).toMatch(/commands/);
    expect(verdict("state['guestResult']['runner'] = 'claude-code'").why).toMatch(/runner/);
  });
  it("derives memory-ceiling and process-ceiling evidence from host observations", () => {
    const merged = py<Record<string, unknown>>(
      [
        "q = load('coding_sandbox_qualify')",
        "print(json.dumps(q.merged_markers({'unitResult': 'oom-kill', 'stopped': True, 'state': 'failed',",
        "  'peak': {'pids': 72, 'memoryBytes': 5}, 'adversary': ['x', {'case': 'hang', 'started': True}]})))",
      ].join("\n"),
    );
    expect(merged).toMatchObject({
      reachedLimit: true,
      peakPids: 72,
      peakMemoryBytes: 5,
      sandboxEnded: true,
      started: true,
    });
  });
});
