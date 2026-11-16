"""Install a pinned, signed Ubuntu KVM toolchain in the project cache only."""
import hashlib
import json
import lzma
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import urllib.request

BASE = 'https://archive.ubuntu.com/ubuntu/'
PINS = {'qemu-system-x86': '1:10.2.1+ds-1ubuntu3.3',
        'qemu-system-data': '1:10.2.1+ds-1ubuntu3.3',
        'linux-image-7.0.0-30-generic': '7.0.0-30.30',
        'busybox-static': '1:1.37.0-7ubuntu1'}
MAX_BYTES = 100 * 1024 * 1024


def sealed_tree(root: Path) -> dict:
    """Bind every runtime byte and link while refusing escapes from the extraction root."""
    manifest = {}
    for path in sorted(root.rglob('*')):
        if not path.resolve().is_relative_to(root):
            raise ValueError('Linked runtime path escapes extraction root')
        if path.is_symlink():
            manifest[str(path.relative_to(root))] = {'link': os.readlink(path)}
        elif path.is_file():
            manifest[str(path.relative_to(root))] = {'sha256': sha(path.read_bytes())}
        elif not path.is_dir():
            raise ValueError('Unexpected runtime filesystem node')
    return manifest


def sha(content: bytes) -> str:
    return hashlib.sha256(content).hexdigest()


def download(url: str, target: Path) -> bytes:
    with urllib.request.urlopen(url, timeout=90) as response:
        content = response.read(MAX_BYTES + 1)
    if len(content) > MAX_BYTES:
        raise ValueError('Tool download exceeds bound')
    target.write_bytes(content)
    return content


def catalog(cache: Path) -> dict:
    records = {}
    for suite in ('resolute', 'resolute-updates'):
        release = cache / (suite + '.InRelease')
        download(BASE + 'dists/' + suite + '/InRelease', release)
        subprocess.run(['gpgv', '--keyring', '/usr/share/keyrings/ubuntu-archive-keyring.gpg', str(release)],
                       check=True, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
        name = 'main/binary-amd64/Packages.xz'
        section = release.read_text().split('SHA256:\n', 1)[1].split('\nSHA', 1)[0]
        expected = next(line.split() for line in section.splitlines() if line.endswith(' ' + name))
        content = download(BASE + 'dists/' + suite + '/' + name, cache / (suite + '.Packages.xz'))
        if sha(content) != expected[0] or len(content) != int(expected[1]):
            raise ValueError('Signed package index differs')
        for paragraph in lzma.decompress(content).decode().split('\n\n'):
            record = dict(line.split(': ', 1) for line in paragraph.splitlines()
                          if ': ' in line and not line.startswith(' '))
            if record.get('Architecture') in ('amd64', 'all'):
                records[record.get('Package')] = record
    return records


def install(cache: Path) -> None:
    if os.getuid() == 0 or cache.resolve() != cache or not str(cache).endswith('/artifacts/tools/coding-kvm/10.2.1'):
        raise ValueError('Expected a non-root exact project tool cache')
    cache.mkdir(parents=True, exist_ok=True)
    root = cache / 'root'
    root.mkdir(exist_ok=True)
    if root.is_symlink():
        raise ValueError('Linked extraction root denied')
    sealed_tree(root)
    prior = cache / 'provenance.json'
    frozen = json.loads(prior.read_text()) if prior.exists() else None
    records = catalog(cache)
    installed = {}

    def extract(name: str) -> None:
        if name in installed:
            return
        record = records[name]
        if frozen and frozen['packages'].get(name, {}).get('sha256') != record['SHA256']:
            raise ValueError('Dependency archive differs from frozen runtime manifest')
        if name in PINS and record['Version'] != PINS[name]:
            raise ValueError('Pinned package unavailable: ' + name + ' ' + record['Version'])
        filename = record['Filename']
        if not re.fullmatch(r'pool/[A-Za-z0-9_./+~-]+\.deb', filename) or '..' in filename:
            raise ValueError('Invalid archive filename')
        path = cache / Path(filename).name
        content = path.read_bytes() if path.exists() else download(BASE + filename, path)
        if sha(content) != record['SHA256'] or len(content) != int(record['Size']):
            raise ValueError('Signed package digest/size differs')
        subprocess.run(['dpkg-deb', '--extract', str(path), str(root)], check=True)
        installed[name] = {'version': record['Version'], 'sha256': record['SHA256'], 'source': BASE + filename}

    for package in PINS:
        extract(package)
    for package in ('seabios', 'qemu-system-common', 'libaio1t64', 'libbpf1', 'libfdt1', 'libfuse3-4',
                    'libibverbs1', 'libjpeg-turbo8', 'libnuma1', 'libpixman-1-0', 'libpmem1',
                    'librdmacm1t64', 'libsasl2-2', 'libslirp0', 'liburing2', 'libndctl6', 'libdaxctl1',
                    'libnl-3-200', 'libnl-route-3-200'):
        extract(package)
    env = {'PATH': '/usr/bin:/bin', 'LC_ALL': 'C', 'LD_LIBRARY_PATH': str(root / 'usr/lib/x86_64-linux-gnu')}
    qemu = root / 'usr/bin/qemu-system-x86_64'
    result = subprocess.run([str(qemu), '--version'], env=env, capture_output=True, text=True)
    if result.returncode:
        raise ValueError('QEMU cannot start: ' + result.stderr)
    # Build an independently hash-bound VMM root, including the exact host-resolved
    # loader/libraries. No system library remains an ambient runtime dependency.
    linked = subprocess.check_output(['ldd', str(qemu)], env=env, text=True)
    for line in linked.splitlines():
        match = re.search(r'(?:=>\s+)?(/[^\s]+)\s+\(', line)
        if not match:
            continue
        source = Path(match.group(1))
        if source.is_relative_to(root):
            continue
        destination = root / str(source).lstrip('/')
        destination.parent.mkdir(parents=True, exist_ok=True)
        if destination.is_symlink():
            raise ValueError('Linked library destination denied')
        shutil.copyfile(source.resolve(), destination)
    binaries = {str(path.relative_to(cache)): sha(path.read_bytes()) for path in
                (qemu, root / 'usr/bin/busybox', root / 'boot/vmlinuz-7.0.0-30-generic')}
    provenance = {'version': 'coding-kvm-v1', 'packages': installed, 'binaries': binaries,
                  'files': sealed_tree(root), 'qemuVersion': result.stdout.splitlines()[0],
                  'qualification': 'not-qualified'}
    (cache / 'provenance.json').write_text(json.dumps(provenance, indent=2) + '\n')
    print(json.dumps({'qemuVersion': provenance['qemuVersion'], 'packages': len(installed),
                      'qualification': 'not-qualified'}))


if __name__ == '__main__':
    install(Path(sys.argv[1]).absolute())
