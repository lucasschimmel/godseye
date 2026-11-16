"""Explicit local staging of pinned public runtime files; no packages or host configuration."""
import hashlib
import json
import os
from pathlib import Path
import re
import runpy
import shutil
import sys
import tarfile
from hermes_files import private_directory, regular, read_json, replace_json
from hermes_install_files import read_json as read_install_json

REVISION = 'typed-files-v4'
RUNSC_SHA = '6f6b1a8f0f4665a403238135167d0d990bfaeaff5544abf68f5e0d822b35484a'
DENIED = re.compile(r'secret|credential|password|token|api_key', re.I)


def digest(path: Path) -> str:
    regular(path, False)
    return hashlib.sha256(path.read_bytes()).hexdigest()


def location(workspace: Path) -> tuple[Path, Path]:
    installer = runpy.run_path(str(workspace / 'scripts/install-hermes.py'))
    tool = installer['resolve_root'](str(workspace), False)
    worker_hash = digest(workspace / 'scripts/hermes_tools_worker.py')[:16]
    return tool.parent.parent / 'tool-executor' / (REVISION + '-' + worker_hash), tool


def hashes(root: Path) -> dict[str, str]:
    return {path.relative_to(root).as_posix(): digest(path) for path in sorted(root.rglob('*')) if path.is_file()}


def verify(workspace: Path) -> Path:
    root, _ = location(workspace)
    if root.resolve(strict=True) != root or root.is_symlink():
        raise ValueError('Aliased tool installation refused')
    receipt = read_json(root / 'manifest.json')
    if (receipt.get('revision') != REVISION or receipt.get('files') != hashes(root / 'payload')
            or receipt.get('workerSha256') != digest(workspace / 'scripts/hermes_tools_worker.py')):
        raise ValueError('Sealed tool runtime differs from its manifest')
    return root


def install(workspace: Path) -> dict:
    root, tool = location(workspace)
    if root.exists():
        verify(workspace)
        return {'state': 'installed', 'revision': REVISION}
    private_directory(root.parent)
    private_directory(root)
    payload = root / 'payload'
    private_directory(payload)
    filesystem = payload / 'rootfs'
    filesystem.mkdir(mode=0o755)
    source_manifest = read_install_json(tool / 'immutable-files.json')['python']

    def copy_python(source: Path, target: Path) -> None:
        relative = source.relative_to(tool / 'python').as_posix()
        if digest(source) != source_manifest.get(relative):
            raise ValueError('Pinned Python file changed')
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(source, target)
        target.chmod(0o755 if source.name == 'python3.14' else 0o644)

    copy_python(tool / 'python/bin/python3.14', filesystem / 'python/bin/python3.14')
    for path in (tool / 'python/lib/python3.14').rglob('*'):
        relative = path.relative_to(tool / 'python')
        if ('site-packages' in relative.parts or '__pycache__' in relative.parts or 'test' in relative.parts
                or any(DENIED.search(part) for part in relative.parts)):
            continue
        if path.is_file() and not path.is_symlink() and path.suffix in ('.py', '.so'):
            copy_python(path, filesystem / 'python' / relative)
    libraries = ['libpthread.so.0', 'libdl.so.2', 'libutil.so.1', 'libm.so.6', 'librt.so.1', 'libc.so.6']
    for name in libraries:
        source = Path('/usr/lib/x86_64-linux-gnu') / name
        regular(source, False)
        target = filesystem / 'usr/lib/x86_64-linux-gnu' / name
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(source, target)
    loader = Path('/usr/lib/x86_64-linux-gnu/ld-linux-x86-64.so.2')
    regular(loader, False)
    (filesystem / 'lib64').mkdir()
    shutil.copyfile(loader, filesystem / 'lib64/ld-linux-x86-64.so.2')
    # Public shared libraries are copied as fixed regular files, then sealed by exact
    # digests. No ldd output or task-controlled library paths are traversed.
    (filesystem / 'lib').mkdir()
    for name in libraries:
        shutil.copyfile(filesystem / 'usr/lib/x86_64-linux-gnu' / name, filesystem / 'lib' / name)
    shutil.copyfile(workspace / 'scripts/hermes_tools_worker.py', filesystem / 'worker.py')
    for name in ('proc', 'dev', 'tmp', 'workspace'):
        (filesystem / name).mkdir(mode=0o755)
    archive = workspace / 'artifacts/tools/runsc/release-20261102.0/gvisor-x86_64.tar.bz2'
    if digest(archive) != RUNSC_SHA:
        raise ValueError('Pinned runsc archive mismatch')
    with tarfile.open(archive) as bundle:
        for entry in bundle:
            relative = Path(entry.name.removeprefix('./'))
            if relative.is_absolute() or '..' in relative.parts or not (entry.isdir() or entry.isfile()):
                raise ValueError('Pinned runsc member refused')
            if entry.isdir():
                continue
            destination = payload / relative
            destination.parent.mkdir(parents=True, exist_ok=True)
            with bundle.extractfile(entry) as source, destination.open('xb') as target:
                shutil.copyfileobj(source, target)
            destination.chmod(0o755)
    (payload / 'runsc').chmod(0o755)
    filesystem.chmod(0o755)
    for path in filesystem.rglob('*'):
        path.chmod(0o755 if path.is_dir() or path.name in ('python3.14', 'ld-linux-x86-64.so.2') else 0o644)
    replace_json(root / 'manifest.json', {'revision': REVISION, 'files': hashes(payload),
                 'workerSha256': digest(workspace / 'scripts/hermes_tools_worker.py')})
    verify(workspace)
    return {'state': 'installed', 'revision': REVISION}


if __name__ == '__main__':
    os.umask(0o077)
    if sys.platform != 'linux' or os.getuid() == 0:
        raise RuntimeError('Tool staging requires unprivileged Linux')
    workspace = Path(sys.argv[1]).resolve(strict=True)
    print(json.dumps(install(workspace)))
