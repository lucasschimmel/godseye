"""Install the two pinned coding CLIs for the work-VM sandbox profile (explicit operator action).

Only the integrity-pinned npm archives already reviewed in coding_cli_install.py are fetched (sha512
integrity from the pinned registry metadata). Node, Git and the shell come from the Debian host and are
mounted read-only into every sandbox. Only `--version` runs here; no model, repository or network command.
"""
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys

MANIFEST_VERSION = 'work-vm-cli-v1'
PROBES = {'codex': 'codex', 'claude': 'claude'}


def load_installer():
    path = Path(__file__).absolute().with_name('coding_cli_install.py')
    specification = importlib.util.spec_from_file_location('coding_cli_install', path)
    module = importlib.util.module_from_spec(specification)
    specification.loader.exec_module(module)
    return module


def file_hashes(root: Path) -> dict:
    result = {}
    for path in sorted(root.rglob('*')):
        if path.is_symlink():
            raise ValueError('Linked CLI asset refused')
        if path.is_file():
            result[path.relative_to(root).as_posix()] = hashlib.sha256(path.read_bytes()).hexdigest()
    return result


def install(workspace: Path) -> dict:
    if os.getuid() == 0:
        raise ValueError('CLI installation requires the unprivileged service user')
    installer = load_installer()
    cache = workspace / 'artifacts/work-vm/cli'
    destination = cache / 'bin'
    if destination.exists():
        raise ValueError('Work-VM CLI assets already installed; remove them explicitly to reinstall')
    stage = cache / 'stage'
    downloads = cache / 'download'
    for directory in (stage, downloads):
        directory.mkdir(parents=True)
    os.environ.clear()
    os.environ.update({'PATH': '/usr/bin:/bin', 'LC_ALL': 'C', 'HOME': str(cache / 'home')})
    provenance = {name: installer.npm_binary(name, downloads, stage) for name in installer.PINS}
    shutil.move(str(stage / 'usr/bin'), str(destination))
    shutil.rmtree(stage)
    shutil.rmtree(downloads / 'licenses', ignore_errors=True)
    versions = {}
    for name in PROBES:
        probe = subprocess.run([str(destination / name), '--version'], capture_output=True, text=True, timeout=30,
                               cwd=cache, env={'PATH': '/usr/bin:/bin', 'LC_ALL': 'C', 'HOME': str(cache / 'home'),
                                               'DISABLE_AUTOUPDATER': '1', 'CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC': '1'})
        if probe.returncode:
            raise ValueError('Version probe failed: ' + name)
        versions[name] = probe.stdout.strip().splitlines()[0]
    shutil.rmtree(downloads, ignore_errors=True)
    shutil.rmtree(cache / 'home', ignore_errors=True)
    document = {'version': MANIFEST_VERSION, 'files': file_hashes(destination), 'versions': versions,
                'provenance': provenance, 'qualification': 'version-probe-only; sandbox qualification required'}
    (cache / 'manifest.json').write_text(json.dumps(document, indent=2, sort_keys=True) + '\n')
    return {'versions': versions, 'files': len(document['files'])}


if __name__ == '__main__':
    print(json.dumps(install(Path(sys.argv[1]).resolve(strict=True))))
