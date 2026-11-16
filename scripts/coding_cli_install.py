"""Install explicit native CLI pins into a project-local guest asset cache.

Only --version/--help probes run outside KVM; no model or repository command does.
Npm lifecycle scripts are never executed. Guest entries are regular files only.
"""
import base64
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tarfile
import urllib.request

def installation_catalog():
    """Load the exact trusted sibling under isolated Python, without ambient import paths."""
    script = Path(__file__).absolute()
    sibling = script.with_name('coding_guest_install.py')
    if script.resolve() != script or sibling.is_symlink() or sibling.resolve() != sibling:
        raise ValueError('Aliased installer source denied')
    specification = importlib.util.spec_from_file_location('coding_guest_install', sibling)
    if specification is None or specification.loader is None:
        raise ValueError('Exact installer catalog unavailable')
    module = importlib.util.module_from_spec(specification)
    specification.loader.exec_module(module)
    return module.BASE, module.catalog


BASE, catalog = installation_catalog()

CODEX = '0.167.0-alpha.4.1'
CLAUDE = '2.1.215'
NODE = '24.22.1'
GIT = '1:2.53.0-1ubuntu1.1'
BASH = '5.3-2ubuntu1'
MAX_DOWNLOAD = 256 * 1024 * 1024
MAX_EXPANDED = 768 * 1024 * 1024
PINS = {
    'codex': ('@openai/codex', CODEX + '-linux-x64',
              'sha512-EmCCWJdkZgQQemaw1a1xbqGJMfR9ZrI8V+zdnwv+tkw5SCoj55WRhP2+u5LNY6KrFn0FGjY9C+Ckw/OO2K9RRg=='),
    'claude': ('@anthropic-ai/claude-code-linux-x64', CLAUDE,
               'sha512-zwDeTitQD3v0/GxX3hl1PTY54j7iF3/hA9QGFM95yind9hBkvLyv6aU9WdH7089s3AICfI6hZ74AFXtBRp6bzQ=='),
}


def sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def download(url: str, target: Path) -> bytes:
    """Read bounded fixed HTTPS origins; freeze every selected archive digest."""
    if not url.startswith(('https://registry.npmjs.org/', 'https://nodejs.org/dist/', BASE)):
        raise ValueError('Download origin denied')
    if target.is_symlink():
        raise ValueError('Linked download target denied')
    if target.exists():
        if target.stat().st_size > MAX_DOWNLOAD:
            raise ValueError('Cached download too large')
        return target.read_bytes()
    with urllib.request.urlopen(url, timeout=90) as response:
        if not response.url.startswith(url.split('/dist/')[0] if '/dist/' in url else url):
            raise ValueError('Unexpected download redirect')
        content = response.read(MAX_DOWNLOAD + 1)
    if len(content) > MAX_DOWNLOAD:
        raise ValueError('Download exceeds bound')
    target.write_bytes(content)
    return content


def unpack_selected(content: bytes, suffix: str, destination: Path) -> None:
    with tarfile.open(fileobj=io.BytesIO(content), mode='r:*') as archive:
        if sum(item.size for item in archive.getmembers()) > MAX_EXPANDED:
            raise ValueError('Expanded archive exceeds bound')
        selected = [item for item in archive.getmembers() if item.name.endswith(suffix)]
        if len(selected) != 1 or not selected[0].isfile():
            raise ValueError('Expected exactly one regular executable: ' + suffix)
        stream = archive.extractfile(selected[0])
        if stream is None:
            raise ValueError('Missing executable bytes')
        destination.parent.mkdir(parents=True, exist_ok=True)
        if destination.is_symlink():
            raise ValueError('Linked executable destination denied')
        destination.write_bytes(stream.read())
        destination.chmod(0o755)


def legal_notice(content: bytes, suffix: str, destination: Path) -> None:
    with tarfile.open(fileobj=io.BytesIO(content), mode='r:*') as archive:
        member = next(item for item in archive.getmembers() if item.name.endswith(suffix) and item.isfile())
        if member.size > 1024 * 1024:
            raise ValueError('Legal notice exceeds bound')
        source = archive.extractfile(member)
        if source is None or destination.is_symlink():
            raise ValueError('Invalid legal notice asset')
        destination.parent.mkdir(exist_ok=True)
        destination.write_bytes(source.read())


def npm_binary(name: str, cache: Path, root: Path) -> dict:
    package, version, integrity = PINS[name]
    url = 'https://registry.npmjs.org/' + package + '/' + version
    metadata = json.loads(download(url, cache / (name + '-metadata.json')))
    if metadata['name'] != package or metadata['version'] != version or metadata['dist']['integrity'] != integrity:
        raise ValueError('Pinned npm metadata differs')
    source = metadata['dist']['tarball']
    content = download(source, cache / (name + '.tgz'))
    if 'sha512-' + base64.b64encode(hashlib.sha512(content).digest()).decode() != integrity:
        raise ValueError('Npm archive integrity differs')
    suffix = '/x86_64-unknown-linux-musl/bin/codex' if name == 'codex' else '/claude'
    unpack_selected(content, suffix, root / 'usr/bin' / name)
    if name == 'codex':
        unpack_selected(content, '/codex-path/rg', root / 'usr/bin/rg')
        unpack_selected(content, '/bin/codex-code-mode-host', root / 'usr/bin/codex-code-mode-host')
        unpack_selected(content, '/codex-resources/bwrap', root / 'usr/bin/codex-resources/bwrap')
    legal_notice(content, '/README.md' if name == 'codex' else '/LICENSE.md',
                 cache / 'licenses' / (name + '.txt'))
    return {'package': package, 'version': version, 'source': source,
            'integrity': integrity, 'sha256': sha(content)}


def node_binary(cache: Path, root: Path) -> dict:
    basename = 'node-v' + NODE + '-linux-x64.tar.xz'
    origin = 'https://nodejs.org/dist/v' + NODE + '/'
    sums = download(origin + 'SHASUMS256.txt', cache / ('node-' + NODE + '-SHASUMS256.txt')).decode()
    expected = next(line.split()[0] for line in sums.splitlines() if line.split()[-1] == basename)
    content = download(origin + basename, cache / basename)
    if sha(content) != expected:
        raise ValueError('Official Node distribution checksum differs')
    unpack_selected(content, '/bin/node', root / 'usr/bin/node')
    legal_notice(content, '/LICENSE', cache / 'licenses/node.txt')
    return {'version': NODE, 'source': origin + basename, 'sha256': expected,
            'verification': 'official HTTPS checksum; frozen recursive manifest'}


def ubuntu_binary(name: str, version: str, guest_path: str, cache: Path, root: Path, records: dict) -> dict:
    record = records[name]
    if record['Version'] != version:
        raise ValueError('Reviewed Ubuntu executable pin unavailable: ' + name)
    filename = record['Filename']
    if not re.fullmatch(r'pool/[A-Za-z0-9_./+~-]+\.deb', filename) or '..' in filename:
        raise ValueError('Invalid package filename')
    content = download(BASE + filename, cache / Path(filename).name)
    if len(content) != int(record['Size']) or sha(content) != record['SHA256']:
        raise ValueError('Signed Ubuntu package digest differs: ' + name)
    archive = subprocess.run(['dpkg-deb', '--fsys-tarfile', str(cache / Path(filename).name)],
                             check=True, capture_output=True, timeout=30).stdout
    unpack_selected(archive, '/usr/bin/' + name, root / guest_path)
    legal_notice(archive, '/usr/share/doc/' + name + '/copyright', cache / 'licenses' / (name + '.txt'))
    # Local fixture commands are built-ins. No remote transports, perl helpers,
    # hooks, global Git configuration or source checkout are imported.
    return {'version': version, 'source': BASE + filename, 'sha256': sha(content),
            'verification': 'Ubuntu InRelease gpgv and signed package index'}


def elf_closure(root: Path) -> dict:
    """Snapshot exact WSL-resolved ELF libraries, dereferencing regular files only."""
    libraries = {}
    binaries = [path for directory in (root / 'usr/bin', root / 'bin') if directory.exists()
                for path in directory.rglob('*') if path.is_file()]
    for binary in sorted(binaries):
        linked = subprocess.run(['ldd', str(binary)], capture_output=True, text=True, timeout=15)
        if linked.returncode and 'not a dynamic executable' not in linked.stderr + linked.stdout:
            raise ValueError('ELF dependency discovery failed: ' + binary.name)
        if 'not found' in linked.stdout:
            raise ValueError('ELF library missing')
        for line in linked.stdout.splitlines():
            match = re.search(r'(?:=>\s+)?(/[^\s]+)\s+\(', line)
            if not match:
                continue
            source = Path(match.group(1)).resolve(strict=True)
            if not source.is_file() or not str(source).startswith(('/usr/lib/', '/lib/')):
                raise ValueError('Unexpected ELF dependency')
            guest = match.group(1)
            destination = root / guest.lstrip('/')
            destination.parent.mkdir(parents=True, exist_ok=True)
            if destination.is_symlink():
                raise ValueError('Linked ELF destination denied')
            shutil.copyfile(source, destination)
            destination.chmod(0o755)
            libraries[guest] = {'sha256': sha(source.read_bytes()), 'source': str(source)}
    return libraries


def asset_entries(root: Path) -> list[dict]:
    entries = []
    for path in sorted(root.rglob('*')):
        if path.is_symlink() or not path.resolve().is_relative_to(root):
            raise ValueError('Linked asset path denied')
        if path.is_file():
            entries.append({'absoluteGuestPath': '/' + path.relative_to(root).as_posix(),
                            'absoluteSourcePath': str(path), 'sha256': sha(path.read_bytes()),
                            'mode': 0o755})
        elif not path.is_dir():
            raise ValueError('Unexpected asset node')
    return entries


def install(cache: Path) -> None:
    """Install only in the exact project asset directory as the normal WSL user."""
    expected = Path(__file__).resolve().parent.parent / 'artifacts/tools/coding-cli'
    if os.getuid() == 0 or cache != expected or cache.is_symlink():
        raise ValueError('Expected non-root exact project CLI cache')
    cache.mkdir(parents=True, exist_ok=True)
    os.environ.clear()
    os.environ.update({'PATH': '/usr/bin:/bin', 'HOME': str(cache / 'install-home'), 'LC_ALL': 'C'})
    root = cache / 'root'
    root.mkdir(exist_ok=True)
    asset_entries(root)
    manifest = cache / 'manifest.json'
    frozen = json.loads(manifest.read_text()) if manifest.exists() else None
    if frozen and frozen['entries'] != asset_entries(root):
        raise ValueError('Frozen asset bytes differ')
    provenance = {name: npm_binary(name, cache, root) for name in PINS}
    provenance['node'] = node_binary(cache, root)
    records = catalog(cache)
    provenance['git'] = ubuntu_binary('git', GIT, 'usr/bin/git', cache, root, records)
    provenance['bash'] = ubuntu_binary('bash', BASH, 'bin/bash', cache, root, records)
    provenance['elfLibraries'] = elf_closure(root)
    observed = {}
    for name in ('codex', 'claude', 'node', 'git', 'bash'):
        env = {'PATH': '/usr/bin:/bin', 'HOME': str(cache / 'probe-home'), 'LC_ALL': 'C',
               'CLAUDE_CONFIG_DIR': str(cache / 'probe-home/claude'), 'CODEX_HOME': str(cache / 'probe-home/codex'),
               'DISABLE_AUTOUPDATER': '1', 'CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC': '1'}
        executable = root / ('bin/bash' if name == 'bash' else 'usr/bin/' + name)
        result = subprocess.run([str(executable), '--version'], env=env,
                                capture_output=True, text=True, timeout=30, cwd=cache)
        if result.returncode:
            raise ValueError('Version probe failed: ' + name + ' ' + result.stderr[:300])
        observed[name] = result.stdout.strip() if name != 'bash' else result.stdout.splitlines()[0]
        for subcommand in ([], ['exec']) if name == 'codex' else [[]]:
            if name not in ('codex', 'claude'):
                continue
            help_result = subprocess.run([str(root / 'usr/bin' / name), *subcommand, '--help'], env=env,
                                         capture_output=True, text=True, timeout=30, cwd=cache)
            if help_result.returncode:
                raise ValueError('Help probe failed: ' + name)
            (cache / (name + ('-exec' if subcommand else '') + '-help.txt')).write_text(help_result.stdout)
    entries = asset_entries(root)
    document = {'version': 'coding-cli-assets-v3', 'entries': entries, 'provenance': provenance,
                'observedVersions': observed, 'qualification': 'version-help-only; KVM proof required'}
    if frozen and frozen['entries'] != entries:
        # Reviewed additions: real Bash/libtinfo and the exact Codex vendored bwrap.
        # Every pre-existing byte/mode/path remains fixed; later reinstalls are exact.
        added = [entry for entry in entries if entry not in frozen['entries']]
        additions = {'coding-cli-assets-v1': {'/bin/bash', '/usr/lib/x86_64-linux-gnu/libtinfo.so.6',
                                            '/usr/bin/codex-resources/bwrap'},
                     'coding-cli-assets-v2': {'/usr/bin/codex-resources/bwrap'}}
        allowed = additions.get(frozen['version'])
        if (allowed is None or
                any(entry not in entries for entry in frozen['entries']) or
                {entry['absoluteGuestPath'] for entry in added} != allowed):
            raise ValueError('Reinstalled asset bytes differ from reviewed manifest migration')
    manifest.write_text(json.dumps(document, indent=2) + '\n')
    print(json.dumps({'versions': observed, 'files': len(entries), 'manifest': str(manifest)}))


if __name__ == '__main__':
    install(Path(sys.argv[1]).absolute())
