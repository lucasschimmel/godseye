"""Networkless real KVM boot probe, never a coding admission qualification."""
import gzip
import json
import hashlib
import os
from pathlib import Path
import stat
import subprocess
import sys
import time


def jail(cache: Path, memory_bytes: int = 512 * 1024 * 1024, processes: int = 32, broker_directory: Path | None = None, task_id: str | None = None) -> tuple[Path, dict]:
    """Verify cgroup controls and seal the VMM filesystem before guest execution."""
    root = cache / 'root'
    provenance = json.loads((cache / 'provenance.json').read_text())
    for name, entry in provenance['files'].items():
        path = root / name
        if not path.resolve().is_relative_to(root):
            raise ValueError('Runtime link escapes jail')
        if 'sha256' in entry and hashlib.sha256(path.read_bytes()).hexdigest() != entry['sha256']:
            raise ValueError('Runtime bytes changed')
        if 'link' in entry and (not path.is_symlink() or os.readlink(path) != entry['link']):
            raise ValueError('Runtime link changed')
    # A finite externally enforced scope must already own this process.
    relative = Path('/proc/self/cgroup').read_text().strip().split('::', 1)[1]
    group = Path('/sys/fs/cgroup') / relative.lstrip('/')
    controls = {name: (group / name).read_text().strip() for name in ('memory.max', 'pids.max', 'cpu.max')}
    if controls['memory.max'] == 'max' or int(controls['memory.max']) > memory_bytes:
        raise ValueError('VMM memory ceiling is absent')
    if controls['pids.max'] == 'max' or int(controls['pids.max']) > processes or controls['cpu.max'].startswith('max '):
        raise ValueError('VMM process/CPU ceiling is absent')
    (root / 'dev').mkdir(exist_ok=True)
    (root / 'tmp').mkdir(exist_ok=True)
    for name in ('kvm', 'null', 'urandom'):
        (root / 'dev' / name).touch(exist_ok=True)
    # The caller has already entered fresh user/mount/network/PID namespaces.
    subprocess.run(['/usr/bin/mount', '--bind', str(root), str(root)], check=True)
    if broker_directory is not None:
        if task_id is None or broker_directory != Path('/tmp') / ('godseye-coding-broker-' + task_id):
            raise ValueError('Unexpected private broker directory')
        metadata = broker_directory.lstat()
        if metadata.st_uid != os.getuid() or stat.S_IMODE(metadata.st_mode) != 0o700 or not stat.S_ISDIR(metadata.st_mode):
            raise ValueError('Broker socket directory identity changed')
        target = root / 'run' / task_id / 'broker'
        if target.is_symlink() or not target.is_dir():
            raise ValueError('Broker target changed')
        subprocess.run(['/usr/bin/mount', '--bind', str(broker_directory), str(target)], check=True)
        subprocess.run(['/usr/bin/mount', '-o', 'remount,bind,ro', str(target)], check=True)
    for name in ('kvm', 'null', 'urandom'):
        subprocess.run(['/usr/bin/mount', '--bind', '/dev/' + name, str(root / 'dev' / name)], check=True)
    subprocess.run(['/usr/bin/mount', '-o', 'remount,bind,ro', str(root)], check=True)
    subprocess.run(['/usr/bin/mount', '-t', 'tmpfs', '-o', 'size=4m,nosuid,nodev,noexec', 'tmpfs', str(root / 'tmp')], check=True)
    evidence = {'cgroup': relative, 'controls': controls, 'uidMap': Path('/proc/self/uid_map').read_text().strip(),
                'networkNamespace': os.readlink('/proc/self/ns/net'), 'mountNamespace': os.readlink('/proc/self/ns/mnt'),
                'rootReadOnly': True, 'hostDiskMounts': False}
    os.chroot(root)
    os.chdir('/')
    return Path('/'), evidence


def archive(entries: list[tuple[str, bytes, int, int, int]]) -> bytes:
    """Encode a deterministic newc initramfs without privileged filesystem nodes."""
    result = bytearray()
    for index, (name, data, mode, major, minor) in enumerate(entries + [('TRAILER!!!', b'', 0, 0, 0)]):
        path = name.encode() + b'\0'
        values = (index + 1, mode, 0, 0, 1, 0, len(data), 0, 0, major, minor, len(path), 0)
        header = b'070701' + ''.join(f'{value:08x}' for value in values).encode()
        result.extend(header + path)
        result.extend(b'\0' * (-len(result) % 4))
        result.extend(data)
        result.extend(b'\0' * (-len(result) % 4))
    return bytes(result)


def probe(cache: Path, confined: bool = False) -> None:
    if not confined and (os.getuid() != 1000 or os.geteuid() != 1000):
        raise ValueError('Probe must run after privilege drop')
    root = cache / 'root'
    init = b'''#!/bin/busybox sh
/bin/busybox mount -t proc proc /proc
/bin/busybox mount -t sysfs sysfs /sys
echo GODSEYE_GUEST_BEGIN
/bin/busybox uname -r
/bin/busybox id
echo NETWORK_INTERFACES
/bin/busybox ls /sys/class/net
echo HOST_DISKS
/bin/busybox ls /sys/block
if test -e /mnt/d/Developer; then echo HOST_PATH_EXPOSED; else echo HOST_PATH_ABSENT; fi
echo GODSEYE_GUEST_COMPLETE
/bin/busybox poweroff -f
'''
    entries = [(name, b'', stat.S_IFDIR | 0o755, 0, 0) for name in ('bin', 'proc', 'sys', 'dev', 'tmp')]
    entries += [('bin/busybox', (root / 'usr/bin/busybox').read_bytes(), stat.S_IFREG | 0o755, 0, 0),
                ('init', init, stat.S_IFREG | 0o755, 0, 0),
                ('dev/console', b'', stat.S_IFCHR | 0o600, 5, 1),
                ('dev/ttyS0', b'', stat.S_IFCHR | 0o600, 4, 64)]
    initrd = cache / 'probe-initrd.gz'
    initrd.write_bytes(gzip.compress(archive(entries), mtime=0))
    confinement = None
    if confined:
        target = root / 'probe-initrd.gz'
        target.write_bytes(initrd.read_bytes())
        root, confinement = jail(cache)
        initrd = Path('/probe-initrd.gz')
    env = {'PATH': '/usr/bin:/bin', 'LC_ALL': 'C',
           'LD_LIBRARY_PATH': str(root / 'usr/lib/x86_64-linux-gnu')}
    command = [str(root / 'usr/bin/qemu-system-x86_64'), '-accel', 'kvm', '-machine', 'q35',
               '-L', str(root / 'usr/share/qemu'),
               '-cpu', 'host', '-m', '256M', '-smp', '1', '-nodefaults', '-no-reboot',
               '-display', 'none', '-monitor', 'none', '-serial', 'stdio', '-nic', 'none',
               '-bios', str(root / 'usr/share/seabios/bios-256k.bin'),
               '-kernel', str(root / 'boot/vmlinuz-7.0.0-30-generic'), '-initrd', str(initrd),
               '-append', 'console=ttyS0 quiet panic=-1 rdinit=/init',
               '-sandbox', 'on,obsolete=deny,elevateprivileges=deny,spawn=deny,resourcecontrol=deny']
    started = time.monotonic()
    try:
        result = subprocess.run(command, env=env, stdin=subprocess.DEVNULL, capture_output=True, timeout=25)
    except subprocess.TimeoutExpired as error:
        print((error.stdout or b'')[-16384:].decode(errors='replace'))
        print((error.stderr or b'')[-2048:].decode(errors='replace'))
        raise ValueError('KVM guest boot timed out and QEMU was killed') from None
    output = result.stdout.decode(errors='replace')
    if len(result.stdout) > 65536 or result.returncode or 'GODSEYE_GUEST_COMPLETE' not in output:
        raise ValueError('KVM probe failed: ' + output[-8192:] + result.stderr.decode(errors='replace'))
    evidence = {'qualification': 'boot-probe-only', 'uid': os.getuid(), 'groups': os.getgroups(),
                'accelerator': 'kvm-only', 'machine': 'q35', 'network': 'none', 'disks': 'none',
                'elapsedSeconds': time.monotonic() - started, 'exitCode': result.returncode,
                'stdout': output, 'stderr': result.stderr.decode(errors='replace'), 'confinement': confinement}
    if not confined:
        (cache / 'boot-probe.json').write_text(json.dumps(evidence, indent=2) + '\n')
    print(json.dumps(evidence))


if __name__ == '__main__':
    probe(Path(sys.argv[1]), '--jail' in sys.argv)
