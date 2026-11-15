"""Debian work-VM host profile for the coding runner.

The owner decision is that, on the server, the disposable work VM (Debian, no nested KVM) is the
isolation boundary and each task runs in a gVisor (runsc systrap) or rootless-container sandbox. This is
WEAKER than the KVM microVM profile (one shared Linux kernel per VM instead of one per task, plus a
user-space kernel or namespaces) and is reported as 'disposable-vm-container'. This module only verifies
host facts. It never runs repository code and never reports availability on its own: the runner stays
unavailable until sandbox qualification evidence exists.
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
POLICY = {'taskMemoryMiB': 4096, 'cpuMilliCores': 1000, 'taskPids': 64, 'taskRuntimeSeconds': 180}


def _read(root: Path, path: str) -> str:
    return (root / path.lstrip('/')).read_text()


def parse_os_release(text: str) -> dict:
    values = {}
    for line in text.splitlines():
        if '=' in line and not line.startswith('#'):
            key, value = line.split('=', 1)
            values[key] = value.strip().strip('"')
    return values


def collect_facts(root: Path = Path('/'), sandbox: str = 'runsc-systrap', runsc: str = '/usr/local/bin/runsc') -> dict:
    """Observe host facts. 'root' is injectable so the profile can be tested against a fixture tree."""
    release = parse_os_release(_read(root, '/etc/os-release'))
    runsc_path = root / runsc.lstrip('/')
    runsc_sha = hashlib.sha256(runsc_path.read_bytes()).hexdigest() if runsc_path.is_file() else None
    userns = root / 'proc/sys/user/max_user_namespaces'
    system = os.uname()
    return {
        'osId': release.get('ID'), 'osVersion': release.get('VERSION_ID'), 'machine': system.machine,
        'kernel': system.release, 'pid1': _read(root, '/proc/1/comm').strip(),
        'cgroupControllers': sorted(_read(root, '/sys/fs/cgroup/cgroup.controllers').split())
        if (root / 'sys/fs/cgroup/cgroup.controllers').is_file() else None,
        'uid': os.getuid(), 'machineId': hashlib.sha256((root / 'etc/machine-id').read_bytes()).hexdigest()
        if (root / 'etc/machine-id').is_file() else None,
        'sandbox': sandbox, 'runscSha256': runsc_sha,
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


def work_vm_readiness(workspace: Path, document: dict) -> dict:
    """Never available until a sandbox runner and qualification evidence exist (see docs)."""
    versions = {}
    manifest = workspace / 'artifacts/tools/coding-cli/manifest.json'
    if manifest.is_file():
        observed = json.loads(manifest.read_text()).get('observedVersions', {})
        versions = {key: observed[name] for key, name in (('codex', 'codex'), ('claude-code', 'claude')) if name in observed}
    result = {'available': False, 'versions': versions,
              'reason': 'Work-VM sandbox runner qualification evidence is absent'}
    try:
        host_profile(collect_facts(), os.environ.get('GODSEYE_RUNSC_SHA256'))
    except (OSError, ValueError) as error:
        result['reason'] = str(error)[:512]
    return result
