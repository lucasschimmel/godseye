"""Debian work-VM host profile for the coding runner.

The owner decision is that, on the server, the disposable work VM (Debian, no nested KVM) is the
isolation boundary and each task runs in a gVisor (runsc systrap) sandbox. This is WEAKER than the KVM
microVM profile (one shared Linux kernel per VM instead of one per task, plus a user-space kernel) and is
reported as 'disposable-vm-container'. This module verifies host facts and recorded qualification
evidence. It never runs repository code, and it reports availability only when every required
qualification gate has recorded evidence that matches the current binaries and runtime sources.
"""
import hashlib
import json
import os
from pathlib import Path

PROFILE = 'work-vm'
ISOLATION = 'disposable-vm-container'
SUPPORTED_DEBIAN = ('12', '13')
REQUIRED_CONTROLLERS = frozenset({'cpu', 'memory', 'pids'})
SANDBOXES = ('runsc-systrap', 'rootless-container')
POLICY = {'taskMemoryMiB': 2048, 'cpuMilliCores': 1000, 'taskPids': 512, 'taskRuntimeSeconds': 180}
RUNSC = '/usr/bin/runsc'
# gVisor release-20261109.0, the same apt package (20261109.0) the pro VM runs; verified 2026-11-15.
PINNED_RUNSC_SHA256 = 'c58f1dc2a3855487bf3bedc2edf074123ad433f1d98fb7f451f56790e87b5c9f'
CLI_MANIFEST = 'artifacts/work-vm/cli/manifest.json'
QUALIFICATION = 'artifacts/work-vm/qualification.json'
QUALIFICATION_VERSION = 'work-vm-qualification-v1'
RUNTIME_SOURCES = ('coding_sandbox_policy.py', 'coding_sandbox_service.py', 'coding_sandbox_runner.py',
                   'coding_sandbox_worker.mjs', 'coding_sandbox_proxy.mjs', 'coding_sandbox_adversary.mjs',
                   'coding_work_vm_control.py', 'coding_guest_profile.py', 'coding_guest_broker.py',
                   'coding_guest_source.py', 'coding_guest_control.py', 'coding_runner_config.mjs',
                   'coding_cli_fixture.py', 'model_attempt_evidence.py')
# Every runner needs these gates; the shared gates belong to the VM, not to one runner.
RUNNER_GATES = ('cli-chain', 'adversarial-index', 'adversarial-test-mutation', 'adversarial-background',
                'adversarial-attributes', 'adversarial-escape', 'adversarial-egress', 'adversarial-exhaustion',
                'stop-revocation-cleanup')
SHARED_GATES = ('vm-egress-allowlist', 'owner-acceptance')


def _read(root: Path, path: str) -> str:
    return (root / path.lstrip('/')).read_text()


def parse_os_release(text: str) -> dict:
    values = {}
    for line in text.splitlines():
        if '=' in line and not line.startswith('#'):
            key, value = line.split('=', 1)
            values[key] = value.strip().strip('"')
    return values


def file_sha256(path: Path) -> str | None:
    return hashlib.sha256(path.read_bytes()).hexdigest() if path.is_file() else None


def runsc_sha256(root: Path = Path('/'), runsc: str = RUNSC) -> str | None:
    return file_sha256(root / runsc.lstrip('/'))


def collect_facts(root: Path = Path('/'), sandbox: str = 'runsc-systrap', runsc: str = RUNSC) -> dict:
    """Observe host facts. 'root' is injectable so the profile can be tested against a fixture tree."""
    release = parse_os_release(_read(root, '/etc/os-release'))
    userns = root / 'proc/sys/user/max_user_namespaces'
    system = os.uname()
    return {
        'osId': release.get('ID'), 'osVersion': release.get('VERSION_ID'), 'machine': system.machine,
        'kernel': system.release, 'pid1': _read(root, '/proc/1/comm').strip(),
        'cgroupControllers': sorted(_read(root, '/sys/fs/cgroup/cgroup.controllers').split())
        if (root / 'sys/fs/cgroup/cgroup.controllers').is_file() else None,
        'uid': os.getuid(), 'machineId': hashlib.sha256((root / 'etc/machine-id').read_bytes()).hexdigest()
        if (root / 'etc/machine-id').is_file() else None,
        'sandbox': sandbox, 'runscSha256': runsc_sha256(root, runsc),
        'userNamespaces': int(userns.read_text()) if userns.is_file() else 0,
        'kvmDevice': (root / 'dev/kvm').exists(),
    }


def host_profile(facts: dict, expected_runsc_sha256: str | None = None) -> dict:
    """Stable policy identity. Raises ValueError on any difference from the documented Debian profile."""
    if facts.get('osId') != 'debian' or facts.get('osVersion') not in SUPPORTED_DEBIAN:
        raise ValueError('Work-VM profile applies only to Debian 12 or 13')
    if facts.get('machine') != 'x86_64':
        raise ValueError('Work-VM profile applies only to x86_64')
    if facts.get('pid1') != 'systemd':
        raise ValueError('Work-VM profile requires systemd as init')
    controllers = facts.get('cgroupControllers')
    if controllers is None:
        raise ValueError('Unified cgroup v2 hierarchy is unavailable')
    if not REQUIRED_CONTROLLERS.issubset(controllers):
        raise ValueError('Required unified cgroup controllers are unavailable')
    if facts.get('uid') == 0:
        raise ValueError('Coding bridge must run as the unprivileged service user')
    sandbox = facts.get('sandbox')
    if sandbox not in SANDBOXES:
        raise ValueError('Unknown task sandbox')
    if sandbox == 'runsc-systrap':
        if not expected_runsc_sha256 or facts.get('runscSha256') != expected_runsc_sha256:
            raise ValueError('runsc binary is absent or differs from the pinned digest')
    elif facts.get('userNamespaces', 0) < 1:
        raise ValueError('Rootless container sandbox requires user namespaces')
    return {'version': 'local-coding-host-work-vm-v1', 'profile': PROFILE, 'isolation': ISOLATION,
            'sandbox': sandbox, 'kernel': facts['kernel'], 'architecture': facts['machine'],
            'machineHash': facts.get('machineId'), 'controllers': controllers,
            'kvm': 'not-required', 'policy': POLICY}


def stable_host_profile() -> dict:
    """Host identity bound to this process's actual runsc digest (used to detect drift during a run)."""
    return host_profile(collect_facts(), PINNED_RUNSC_SHA256)


def source_hashes(workspace: Path) -> dict:
    return {name: hashlib.sha256((workspace / 'scripts' / name).read_bytes()).hexdigest() for name in RUNTIME_SOURCES}


def cli_manifest(workspace: Path) -> dict:
    manifest = json.loads((workspace / CLI_MANIFEST).read_text())
    if manifest.get('version') != 'work-vm-cli-v1' or not {'codex', 'claude'} <= set(manifest['files']):
        raise ValueError('Work-VM CLI manifest differs from the reviewed layout')
    return manifest


def runtime_identity(workspace: Path) -> dict:
    manifest = cli_manifest(workspace)
    runsc = runsc_sha256()
    if runsc != PINNED_RUNSC_SHA256:
        raise ValueError('runsc is absent or differs from the pinned digest')
    for name, expected in manifest['files'].items():
        path = workspace / 'artifacts/work-vm/cli/bin' / name
        if file_sha256(path) != expected:
            raise ValueError('Coding CLI bytes changed: ' + name)
    digest = lambda value: hashlib.sha256(json.dumps(value, sort_keys=True).encode()).hexdigest()  # noqa: E731
    return {'versions': {'codex': manifest['versions']['codex'], 'claude-code': manifest['versions']['claude']},
            'pinnedRuntimeHash': digest({'runsc': runsc, 'cli': manifest['files']}),
            'guestImageHash': digest({'sources': source_hashes(workspace), 'cli': manifest['files']})}


def qualification_gap(workspace: Path, runner: str) -> str | None:
    """None when recorded evidence is complete and current for this runner, else the exact first gap."""
    path = workspace / QUALIFICATION
    if not path.is_file():
        return 'Work-VM sandbox runner qualification evidence is absent'
    proof = json.loads(path.read_text())
    if proof.get('version') != QUALIFICATION_VERSION:
        return 'Work-VM qualification evidence has an unknown version'
    if proof.get('runscSha256') != runsc_sha256() or proof.get('sourceHashes') != source_hashes(workspace):
        return 'Work-VM qualification evidence is stale: sandbox sources or runsc changed'
    if proof.get('cliFiles') != cli_manifest(workspace)['files']:
        return 'Work-VM qualification evidence is stale: coding CLI bytes changed'
    gates = {**proof.get('shared', {}), **{f'{runner}:{name}': value for name, value in proof.get('runners', {}).get(runner, {}).items()}}
    for gate in (*SHARED_GATES, *(f'{runner}:{name}' for name in RUNNER_GATES)):
        if gates.get(gate, {}).get('passed') is not True:
            return 'Work-VM qualification gate not passed: ' + gate
    return None


def work_vm_readiness(workspace: Path, document: dict) -> dict:
    """Available only when host facts hold and every qualification gate has current recorded evidence."""
    versions = {}
    try:
        manifest = cli_manifest(workspace)
        versions = {'codex': manifest['versions']['codex'], 'claude-code': manifest['versions']['claude']}
    except (OSError, ValueError, KeyError):
        pass
    result = {'available': False, 'versions': versions, 'reason': 'Work-VM sandbox runner qualification evidence is absent'}
    try:
        host_profile(collect_facts(), PINNED_RUNSC_SHA256)
        runners = sorted({binding['runner'] for binding in document.get('bindings', [])})
        if not runners:
            result['reason'] = 'No private coding binding'
            return result
        gaps = [qualification_gap(workspace, runner) for runner in runners]
        if not any(gaps):
            result.update({'available': True, 'reason': 'Work-VM sandbox qualification evidence is complete and current'})
        else:
            result['reason'] = next(gap for gap in gaps if gap)
    except (OSError, ValueError, KeyError, TypeError) as error:
        result['reason'] = str(error)[:512]
    return result
