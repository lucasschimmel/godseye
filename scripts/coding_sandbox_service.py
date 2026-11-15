"""Trusted pre-exec check inside an already hard-capped per-task user service, then the gVisor sandbox.

argv: <expected runsc sha256> <runsc> <task run directory> <image hash> <container id>
The unit's cgroup must carry exactly the reviewed memory/cpu/tasks ceilings, the runsc binary must match its
pinned digest, the OCI bundle must satisfy the sandbox policy and the host controller must durably release
this exact invocation (after its own final authorization) before the sandbox is started. Revocation before
release means the sandbox never starts.
"""
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import sys
import time

RELEASE_WAIT_SECONDS = 30


def load_policy():
    path = Path(__file__).with_name('coding_sandbox_policy.py')
    specification = importlib.util.spec_from_file_location('coding_sandbox_policy', path)
    module = importlib.util.module_from_spec(specification)
    specification.loader.exec_module(module)
    return module


def observed_controls() -> dict:
    group = Path('/sys/fs/cgroup') / Path('/proc/self/cgroup').read_text().strip().split('::', 1)[1].lstrip('/')
    return {name: (group / name).read_text().strip() for name in ('memory.max', 'memory.swap.max', 'cpu.max', 'pids.max')}


def wait_for_release(directory: Path, image_hash: str, invocation: str) -> None:
    for _ in range(RELEASE_WAIT_SECONDS * 20):
        if (directory / 'revoked').exists():
            raise RuntimeError('Task was revoked before sandbox dispatch')
        release = directory / 'release'
        if release.is_file() and not release.is_symlink():
            if json.loads(release.read_text()) != {'imageHash': image_hash, 'invocationId': invocation}:
                raise RuntimeError('Sandbox release differs from this invocation')
            return
        time.sleep(0.05)
    raise RuntimeError('Sandbox dispatch was never released')


def main() -> None:
    policy = load_policy()
    expected_sha, executable, run_directory, image_hash, container = sys.argv[1:]
    directory = Path(run_directory)
    if os.getuid() == 0:
        raise RuntimeError('Sandbox service must run as the unprivileged service user')
    if observed_controls() != policy.expected_controls():
        raise RuntimeError('Effective sandbox service controls differ')
    if hashlib.sha256(Path(executable).read_bytes()).hexdigest() != expected_sha:
        raise RuntimeError('runsc differs from its pinned digest')
    bundle = directory / 'bundle'
    policy.validate_oci(json.loads((bundle / 'config.json').read_text()))
    wait_for_release(directory, image_hash, os.environ['INVOCATION_ID'])
    arguments = policy.runsc_arguments(executable, str(directory / 'oci'), str(bundle), container)
    os.environ.clear()
    os.environ.update({'PATH': '/usr/bin:/bin', 'LC_ALL': 'C'})
    os.execv(arguments[0], arguments)


if __name__ == '__main__':
    main()
