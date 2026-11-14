"""Build an exact coding guest and execute it only inside an admitted transient service."""
import gzip
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import stat
import subprocess
import sys
import tarfile
import io
import time
import shutil
import uuid


def load(name: str, path: Path):
    specification = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(specification)
    specification.loader.exec_module(module)
    return module


def write_archive(destination: Path, entries: list, append: bool = False) -> str:
    """Stream deterministic newc bytes with finite files and bytes into gzip."""
    written = 0
    total = 0
    with gzip.GzipFile(filename=str(destination), mode='ab' if append else 'wb', mtime=0, compresslevel=1) as output:
        for index, (name, content, mode, major, minor) in enumerate(entries + [('TRAILER!!!', b'', 0, 0, 0)]):
            path = name.encode() + b'\0'
            data = content['path'].read_bytes() if isinstance(content, dict) else content.read_bytes() if isinstance(content, Path) else content
            if isinstance(content, dict) and hashlib.sha256(data).hexdigest() != content['sha256']:
                raise ValueError('Guest asset changed during image construction')
            total += len(data)
            if total > 1024 * 1024 * 1024 or len(name) > 200 or name.startswith('/') or '..' in name.split('/'):
                raise ValueError('Guest image exceeds fixed path/size policy')
            values = (index + 1, mode, 0, 0, 1, 0, len(data), 0, 0, major, minor, len(path), 0)
            header = b'070701' + ''.join(f'{value:08x}' for value in values).encode() + path
            output.write(header)
            written += len(header)
            padding = -written % 4
            output.write(b'\0' * padding)
            written += padding
            output.write(data)
            written += len(data)
            padding = -written % 4
            output.write(b'\0' * padding)
            written += padding
    return hashlib.sha256(destination.read_bytes()).hexdigest()


def build(workspace: Path, task_id: str, runner: str, task_document: dict | None = None, source_archive: bytes | None = None) -> dict:
    if str(uuid.UUID(task_id)) != task_id or runner not in ('codex', 'claude-code') or os.getuid() == 0:
        raise ValueError('Invalid guest task identity or host user')
    cache = workspace / 'artifacts/tools/coding-kvm/10.2.1'
    directory = cache / 'root/run' / task_id
    if directory.exists():
        raise ValueError('Task image already exists; physical replay is forbidden')
    directory.mkdir(parents=True)
    (directory / 'broker').mkdir()
    manifest = json.loads((workspace / 'artifacts/tools/coding-cli/manifest.json').read_text())
    assets = manifest['entries'] if isinstance(manifest, dict) else manifest
    files = {}
    for entry in assets:
        name = entry['absoluteGuestPath'].lstrip('/')
        path = Path(entry['absoluteSourcePath'])
        if not path.is_absolute() or path.is_symlink() or path.resolve() != path:
            raise ValueError('Linked guest asset refused')
        if hashlib.sha256(path.read_bytes()).hexdigest() != entry['sha256'] or name in files:
            raise ValueError('Guest asset differs or repeats')
        if runner == 'codex' and name == 'usr/bin/claude':
            continue
        if runner == 'claude-code' and name in ('usr/bin/codex', 'usr/bin/codex-code-mode-host', 'usr/bin/rg'):
            continue
        files[name] = ({'path': path, 'sha256': entry['sha256']}, stat.S_IFREG | 0o755, 0, 0)
    files['bin/busybox'] = (cache / 'root/usr/bin/busybox', stat.S_IFREG | 0o755, 0, 0)
    for name in ('sh', 'bash', 'cat', 'ls', 'pwd', 'printf', 'env', 'mkdir', 'rm', 'cp', 'mv', 'chmod', 'touch', 'head', 'tail', 'grep', 'sed', 'find', 'wc', 'sleep', 'true', 'false'):
        if 'bin/' + name not in files:
            files['bin/' + name] = (b'busybox', stat.S_IFLNK | 0o777, 0, 0)
    files['coding/worker.mjs'] = (workspace / 'scripts/coding_guest_worker.mjs', stat.S_IFREG | 0o444, 0, 0)
    files['coding/proxy.mjs'] = (workspace / 'scripts/coding_guest_proxy.mjs', stat.S_IFREG | 0o444, 0, 0)
    files['coding/drop.mjs'] = (workspace / 'scripts/coding_guest_drop.mjs', stat.S_IFREG | 0o444, 0, 0)
    files['coding/runner-config.mjs'] = (workspace / 'scripts/coding_runner_config.mjs', stat.S_IFREG | 0o444, 0, 0)
    task = {'runner': runner, 'syntheticFixture': True, 'input': 'Change answer.cjs to export 42 and run its Node test. Report the result.',
            'maxPatchBytes': 131072, 'testProfile': 'test'}
    if task_document is not None:
        task = task_document
    if task.get('labCase'):
        files['coding/adversary.mjs'] = (workspace / 'scripts/coding_guest_adversary.mjs', stat.S_IFREG | 0o444, 0, 0)
    if source_archive is not None:
        with tarfile.open(fileobj=io.BytesIO(source_archive), mode='r:') as source:
            for member in source.getmembers():
                if not member.isfile() or not member.name.startswith('source.git/') or '..' in member.name.split('/'):
                    raise ValueError('Invalid inert source archive entry')
                files[member.name] = (source.extractfile(member).read(), stat.S_IFREG | 0o600, 0, 0)
    files['task.json'] = (json.dumps(task).encode(), stat.S_IFREG | 0o444, 0, 0)
    files['etc/passwd'] = (b'root:x:0:0:root:/:/bin/sh\nrunner:x:1000:1000:runner:/home/runner:/bin/sh\n', stat.S_IFREG | 0o444, 0, 0)
    files['etc/group'] = (b'root:x:0:\nrunner:x:1000:\n', stat.S_IFREG | 0o444, 0, 0)
    init = b'''#!/bin/busybox sh
set -e
trap 'echo GODSEYE_POLICY_REJECTED; /bin/busybox poweroff -f' EXIT
/bin/busybox mount -t proc proc /proc
/bin/busybox mount -t sysfs sysfs /sys
/bin/busybox chmod 1777 /tmp
/bin/busybox mount -t devpts -o newinstance,ptmxmode=0666,mode=0620,gid=5 devpts /dev/pts
/bin/busybox mount -t tmpfs -o size=64m,nosuid,nodev tmpfs /dev/shm
/bin/busybox chmod 1777 /dev/shm
/bin/busybox ip link set lo up
test "$(/bin/busybox ls /sys/class/net)" = lo
/bin/busybox mkdir -p /sys/fs/cgroup
/bin/busybox mount -t cgroup2 none /sys/fs/cgroup
echo +pids > /sys/fs/cgroup/cgroup.subtree_control
/bin/busybox mkdir /sys/fs/cgroup/coding
echo 64 > /sys/fs/cgroup/coding/pids.max
test "$(/bin/busybox cat /sys/fs/cgroup/coding/pids.max)" = 64
/bin/busybox mkdir /sys/fs/cgroup/verification
echo 64 > /sys/fs/cgroup/verification/pids.max
test "$(/bin/busybox cat /sys/fs/cgroup/verification/pids.max)" = 64
/bin/busybox stty -F /dev/ttyS1 raw -echo
set +e
trap - EXIT
/usr/bin/node /coding/worker.mjs
echo GODSEYE_WORKER_EXIT=$?
/bin/busybox poweroff -f
'''
    if task.get('labCase') == 'pids-failure':
        init = init.replace(b'set +e', b'echo max > /sys/fs/cgroup/coding/pids.max\ntest "$(/bin/busybox cat /sys/fs/cgroup/coding/pids.max)" = 64\nset +e')
    files['init'] = (init, stat.S_IFREG | 0o755, 0, 0)
    for name, major, minor in (('console', 5, 1), ('ttyS0', 4, 64), ('ttyS1', 4, 65), ('null', 1, 3),
                               ('zero', 1, 5), ('full', 1, 7), ('random', 1, 8), ('urandom', 1, 9), ('tty', 5, 0)):
        files['dev/' + name] = (b'', stat.S_IFCHR | (0o600 if name.startswith('tty') or name == 'console' else 0o666), major, minor)
    files['dev/ptmx'] = (b'pts/ptmx', stat.S_IFLNK | 0o777, 0, 0)
    directories = {'proc', 'sys', 'tmp', 'run', 'home', 'home/runner', 'dev/pts', 'dev/shm'}
    for name in files:
        directories.update(str(parent) for parent in Path(name).parents if str(parent) != '.')
    entries = [(name, b'', stat.S_IFDIR | 0o755, 0, 0) for name in sorted(directories)]
    entries.extend((name, *content) for name, content in sorted(files.items()))
    # Immutable vendor binaries are compressed once. A second concatenated newc
    # archive contains the exact source/task/trusted worker for this allocation.
    base_files = [entry for entry in entries if entry[0].startswith(('usr/', 'lib', 'bin/', 'dev/', 'etc/')) and not stat.S_ISDIR(entry[2])]
    base_directories = sorted({str(parent) for entry in base_files for parent in Path(entry[0]).parents if str(parent) != '.'})
    base_entries = [(name, b'', stat.S_IFDIR | 0o755, 0, 0) for name in base_directories] + base_files
    base_identity = []
    for name, content, mode, major, minor in base_entries:
        content_hash = content['sha256'] if isinstance(content, dict) else hashlib.sha256(content.read_bytes() if isinstance(content, Path) else content).hexdigest()
        base_identity.append([name, content_hash, mode, major, minor])
    base_key = hashlib.sha256(json.dumps(base_identity, sort_keys=True).encode()).hexdigest()
    images = cache / 'images'
    images.mkdir(exist_ok=True)
    base_path = images / (base_key + '.gz')
    base_receipt = images / (base_key + '.json')
    if base_path.exists():
        if base_path.is_symlink() or hashlib.sha256(base_path.read_bytes()).hexdigest() != json.loads(base_receipt.read_text())['sha256']:
            raise ValueError('Cached immutable guest asset image changed')
    else:
        base_hash = write_archive(base_path, base_entries)
        base_receipt.write_text(json.dumps({'sha256': base_hash, 'manifestHash': base_key}))
    shutil.copyfile(base_path, directory / 'initrd.gz')
    base_names = {entry[0] for entry in base_files}
    overlay = [entry for entry in entries if entry[0] not in base_names]
    image_hash = write_archive(directory / 'initrd.gz', overlay, append=True)
    receipt = {'taskId': task_id, 'runner': runner, 'imageHash': image_hash, 'assets': len(assets), 'billing': 'synthetic-fixture-only'}
    (directory / 'image.json').write_text(json.dumps(receipt))
    return receipt


def execute(cache: Path, task_id: str) -> None:
    if str(uuid.UUID(task_id)) != task_id:
        raise ValueError('Invalid exact task identity')
    lab = load('coding_guest_lab', Path(__file__).with_name('coding_guest_lab.py'))
    directory = cache / 'root/run' / task_id
    receipt = json.loads((directory / 'image.json').read_text())
    if hashlib.sha256((directory / 'initrd.gz').read_bytes()).hexdigest() != receipt['imageHash']:
        raise ValueError('Frozen guest image changed')
    for _ in range(300):
        if (directory / 'release').exists():
            break
        time.sleep(0.1)
    else:
        raise ValueError('Native invocation was never durably released')
    root, confinement = lab.jail(cache, memory_bytes=5 * 1024 * 1024 * 1024, processes=64,
                                 broker_directory=Path('/tmp') / ('godseye-coding-broker-' + task_id), task_id=task_id)
    print('GODSEYE_PHYSICAL_READY ' + task_id + ' ' + receipt['imageHash'], flush=True)
    for _ in range(100):
        if Path('/run/' + task_id + '/revoked').exists():
            raise ValueError('Task was revoked before physical guest dispatch')
        if Path('/run/' + task_id + '/start').exists():
            break
        time.sleep(0.1)
    else:
        raise ValueError('Final physical guest dispatch was not authorized')
    command = ['/usr/bin/qemu-system-x86_64', '-accel', 'kvm', '-machine', 'q35', '-L', '/usr/share/qemu',
               '-cpu', 'host', '-m', '4096M', '-smp', '1', '-nodefaults', '-no-reboot', '-display', 'none',
               '-monitor', 'none', '-serial', 'stdio', '-nic', 'none', '-bios', '/usr/share/seabios/bios-256k.bin',
               '-kernel', '/boot/vmlinuz-7.0.0-30-generic', '-initrd', '/run/' + task_id + '/initrd.gz',
               '-chardev', 'socket,id=broker,path=/run/' + task_id + '/broker/broker.sock,server=off',
               '-device', 'isa-serial,chardev=broker,index=1', '-append', 'console=ttyS0 rootfstype=ramfs panic=-1 rdinit=/init',
               '-sandbox', 'on,obsolete=deny,elevateprivileges=deny,spawn=deny,resourcecontrol=deny']
    print('GODSEYE_CONFINEMENT ' + json.dumps(confinement), flush=True)
    os.execve(command[0], command, {'PATH': '/usr/bin:/bin', 'LC_ALL': 'C', 'LD_LIBRARY_PATH': '/usr/lib/x86_64-linux-gnu'})


if __name__ == '__main__':
    if sys.argv[1] == 'build':
        print(json.dumps(build(Path(sys.argv[2]), sys.argv[3], sys.argv[4])))
    elif sys.argv[1] == 'execute':
        execute(Path(sys.argv[2]), sys.argv[3])
    else:
        raise ValueError('Unknown fixed coding guest action')
