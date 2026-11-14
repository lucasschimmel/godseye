"""Install a pinned Hermes source and sealed Python runtime without global changes or model calls."""

import fcntl
import hashlib
import json
import os
from pathlib import Path
import platform
import pwd
import shutil
import subprocess
import sys
import uuid

from hermes_install_files import (
    detach_build_hardlinks, digest, download, extract, private_directory, read_json,
    regular_file, tree_hashes, write_json,
)

VERSION = "0.23.1"
COMMIT = "3b421578588243f920886e6fe79a6faa87ea026e"
SOURCE_SHA256 = "2525046f165880c22f177f2214c8da3e26c58cb0aeab5bd09aad940556538897"
SOURCE_URL = f"https://codeload.github.com/NousResearch/hermes-agent/tar.gz/{COMMIT}"
PYTHON_VERSION = "3.14.9"
PYTHON_SHA256 = "dfa4c5a40c47f338f41658017be550c72247c391e6bfb1fa4da03ebc8451abdf"
PYTHON_URL = "https://github.com/astral-sh/python-build-standalone/releases/download/20261021/cpython-3.14.9+20261021-x86_64-unknown-linux-gnu-install_only.tar.gz"


def resolve_root(workspace: str, create: bool) -> Path:
    """Bind an ext4 user-owned private tool root to the actual public workspace identity."""
    path = Path(workspace)
    if not path.is_absolute() or not path.is_dir() or path.resolve() != path:
        raise RuntimeError("Hermes workspace must be a real absolute directory")
    if not (path / "package.json").is_file() or not (path / "scripts/install-hermes.py").is_file():
        raise RuntimeError("Hermes workspace identity is missing")
    task_home = Path(pwd.getpwuid(os.getuid()).pw_dir)
    key = hashlib.sha256(str(path).encode()).hexdigest()
    root = task_home / ".local/share/godseye-hermes" / key
    marker = root / ".godseye-hermes.json"
    expected = {"schema": 1, "workspace": str(path), "workspaceHash": key, "ownerUid": os.getuid()}
    # Existing account .local/share may be public; only the managed subtree must be private.
    for parent in (task_home, task_home / ".local", task_home / ".local/share"):
        if parent.is_symlink() or (parent.exists() and parent.resolve() != parent):
            raise RuntimeError("Linked Hermes account storage is refused")
        if not parent.exists() and create:
            parent.mkdir(mode=0o700)
    if root.exists() and not marker.exists():
        raise RuntimeError("Existing Hermes workspace root has no ownership marker")
    if create:
        base = root.parent
        if not base.exists():
            base.mkdir(mode=0o700)
        private_directory(base)
        private_directory(root)
        if not marker.exists():
            write_json(marker, expected)
    if marker.exists():
        private_directory(root)
        if read_json(marker) != expected:
            raise RuntimeError("Hermes workspace ownership marker differs")
    return root / "tools" / VERSION


def child_environment(root: Path) -> dict[str, str]:
    """Keep provider credentials, preload flags and account configuration out of bootstrap children."""
    task_home = root / "bootstrap-home"
    for path in (task_home, task_home / "cache", task_home / "config", task_home / "data"):
        private_directory(path)
    return {
        "PATH": "/usr/bin:/bin", "HOME": str(task_home),
        "XDG_CACHE_HOME": str(task_home / "cache"),
        "XDG_CONFIG_HOME": str(task_home / "config"),
        "XDG_DATA_HOME": str(task_home / "data"),
        "HERMES_HOME": str(task_home / ".hermes"),
        "HERMES_RUNTIME_DIR": str(root / "runtime"),
        "HERMES_INSTALL_ROOT": str(root / "identity"),
        "PYTHONDONTWRITEBYTECODE": "1", "PYTHONNOUSERSITE": "1",
        "UV_LINK_MODE": "copy", "LANG": "C.UTF-8", "LC_ALL": "C.UTF-8",
    }


def execute(command: list[str], root: Path, timeout: int = 900) -> str:
    """Capture upstream output locally in memory; expose only a fixed failure classification."""
    try:
        result = subprocess.run(command, cwd=root / "source", env=child_environment(root),
                                stdin=subprocess.DEVNULL, capture_output=True, text=True,
                                timeout=timeout, check=False)
    except (OSError, subprocess.TimeoutExpired):
        raise RuntimeError("Hermes bootstrap process failed or exceeded its deadline") from None
    if result.returncode != 0:
        raise RuntimeError("Hermes frozen dependency build failed without changing global packages")
    return result.stdout


def offline_smoke(root: Path) -> dict:
    """Probe real installed imports and version with network denied before application imports."""
    program = """
import json, socket, sys
def refuse(*args, **kwargs):
    raise RuntimeError('Hermes installation smoke forbids network access')
socket.socket.connect = refuse
socket.socket.connect_ex = refuse
socket.create_connection = refuse
socket.getaddrinfo = refuse
import openai
from hermes_cli import __version__
from hermes_cli._startup_fast import print_fast_version_info
print_fast_version_info(check_updates=False)
print(json.dumps({'hermesVersion': __version__, 'pythonVersion': sys.version.split()[0],
                  'openaiSdkVersion': openai.__version__, 'network': 'denied', 'modelCalls': 0}))
"""
    output = execute([str(root / "venv/bin/python"), "-B", "-c", program], root, 60)
    data = json.loads(output.strip().splitlines()[-1])
    if data["hermesVersion"] != VERSION or data["pythonVersion"] != PYTHON_VERSION:
        raise RuntimeError("Hermes installed runtime version differs from its reviewed pin")
    return data


def immutable_files(root: Path) -> dict:
    """Bind source, exact Python and application environment bytes to the completion receipt."""
    return {name: tree_hashes(root / name, root) for name in ("source", "python", "venv", "identity")}


def verify_install(root: Path) -> dict:
    """Fail closed on missing, modified or foreign pre-existing runtime bytes."""
    receipt = read_json(root / "provenance.json")
    if (receipt.get("version") != VERSION or receipt.get("commit") != COMMIT
            or receipt.get("sourceSha256") != SOURCE_SHA256
            or receipt.get("pythonSha256") != PYTHON_SHA256):
        raise RuntimeError("Existing Hermes provenance differs from reviewed pins")
    if immutable_files(root) != read_json(root / "immutable-files.json"):
        raise RuntimeError("Existing Hermes runtime bytes differ from the completed installation")
    return receipt


def verify_extraction(target: Path, reference: Path, root: Path, name: str) -> None:
    """Refuse changed archive entries; preserve and replace only known build-derived additions."""
    actual, expected = tree_hashes(target, root), tree_hashes(reference, root)
    bytecode = lambda path: name == "python" and "/__pycache__/" in path and path.endswith(".pyc")
    if any(actual.get(path) != value and not bytecode(path) for path, value in expected.items()):
        raise RuntimeError("Existing Hermes extraction differs from verified archive")
    additions = set(actual) - set(expected)
    for path in additions:
        derived_python = bytecode(path)
        derived_source = name == "source" and path in {
            "hermes_agent.egg-info/PKG-INFO", "hermes_agent.egg-info/dependency_links.txt",
            "hermes_agent.egg-info/top_level.txt", "hermes_agent.egg-info/requires.txt",
            "hermes_agent.egg-info/entry_points.txt", "hermes_agent.egg-info/SOURCES.txt",
        }
        if not (derived_python or derived_source):
            raise RuntimeError("Existing Hermes extraction contains unrecognized additions")
    if additions or any(actual.get(path) != value for path, value in expected.items()):
        # PM's build backend creates egg-info/bytecode. Do not execute those retained bytes on retry.
        target.rename(root / f"interrupted-{name}-{uuid.uuid4().hex}")
        reference.rename(target)


def install(root: Path) -> dict:
    """Build only in a marker-owned fixed prefix so virtualenv paths survive publication."""
    private_directory(root.parent)
    private_directory(root)
    progress = root / ".godseye-install.json"
    expected = {"schema": 1, "version": VERSION, "commit": COMMIT, "ownerUid": os.getuid()}
    if progress.exists():
        if read_json(progress) != expected:
            raise RuntimeError("Hermes in-progress installation marker differs")
    elif any(root.iterdir()):
        raise RuntimeError("Refusing an unowned pre-existing Hermes tool directory")
    else:
        write_json(progress, expected)
    for name, url, checksum, prefix, links in (
        ("source", SOURCE_URL, SOURCE_SHA256, f"hermes-agent-{COMMIT}", False),
        ("python", PYTHON_URL, PYTHON_SHA256, "python", True),
    ):
        archive = root / f"{name}.tar.gz"
        download(url, archive, checksum)
        target = root / name
        if not target.exists():
            extract(archive, target, prefix, links)
        else:
            # Every retry compares the extraction with the immutable archive before executing it.
            check = root / f".{name}-verified"
            if check.exists() or check.is_symlink():
                raise RuntimeError("Hermes verification staging already exists")
            extract(archive, check, prefix, links)
            try:
                verify_extraction(target, check, root, name)
            finally:
                if check.exists():
                    shutil.rmtree(check)
    venv = root / "venv"
    build_state = root / ".dependency-build.json"
    build_identity = {**expected, "sourceSha256": SOURCE_SHA256, "pythonSha256": PYTHON_SHA256}
    if venv.exists() or venv.is_symlink():
        if not build_state.exists() or read_json(build_state) != build_identity:
            raise RuntimeError("Refusing an unowned incomplete Hermes venv")
        if venv.is_symlink() or venv.resolve() != venv:
            raise RuntimeError("Refusing a linked incomplete Hermes venv")
        detach_build_hardlinks(venv)
        tree_hashes(venv, root)
        # Preserve interrupted bytes for inspection. Never remove an ambiguous partial generation.
        venv.rename(root / f"interrupted-venv-{uuid.uuid4().hex}")
    write_json(build_state, build_identity)
    execute([str(root / "python/bin/python3.14"), "-B", "-m", "pm.build_env",
             "--source", str(root / "source"), "--out", str(venv), "--sealed",
             "--python", str(root / "python/bin/python3.14"), "--cache", str(root / "cache")], root)
    detach_build_hardlinks(venv)
    private_directory(root / "identity")
    write_json(root / "identity/install-stamp.json", {
        "baseVersion": VERSION, "displayVersion": VERSION, "commit": COMMIT,
        "source": "commit-build", "updateMechanism": "external", "payload": "full",
    })
    smoke = offline_smoke(root)
    write_json(root / "immutable-files.json", immutable_files(root))
    receipt = {"schema": 1, "version": VERSION, "commit": COMMIT,
               "sourceUrl": SOURCE_URL, "sourceSha256": SOURCE_SHA256,
               "pythonUrl": PYTHON_URL, "pythonSha256": PYTHON_SHA256,
               "dependencyLockSha256": digest(root / "source/uv.lock"),
               "installPolicy": "frozen-core-sealed-no-global-changes", "smoke": smoke}
    write_json(root / "provenance.json", receipt)
    return receipt


def main() -> None:
    """Consume only public workspace/action metadata and return safe installation state."""
    if sys.platform != "linux" or platform.machine() != "x86_64" or os.getuid() == 0:
        raise RuntimeError("Hermes installer requires non-root Linux x64 or WSL2 Ubuntu")
    request = json.loads(sys.stdin.read(16_385))
    if set(request) != {"workspace", "action"} or request["action"] not in ("install", "status", "smoke"):
        raise RuntimeError("Invalid Hermes installation request")
    root = resolve_root(request["workspace"], request["action"] == "install")
    if not root.exists():
        if request["action"] != "install":
            print(json.dumps({"version": VERSION, "commit": COMMIT, "status": "not-installed", "root": str(root)}))
            return
        private_directory(root.parent)
        private_directory(root)
        write_json(root / ".godseye-install.json", {"schema": 1, "version": VERSION,
                   "commit": COMMIT, "ownerUid": os.getuid()})
    private_directory(root)
    lock = root / ".install.lock"
    descriptor = os.open(lock, os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
    try:
        regular_file(lock)
        fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
        if (root / "provenance.json").exists():
            receipt = verify_install(root)
        elif request["action"] == "install":
            receipt = install(root)
        else:
            raise RuntimeError("Hermes installation is incomplete. No runtime authority available")
        if request["action"] == "smoke":
            receipt = {**receipt, "smoke": offline_smoke(root)}
        print(json.dumps({"version": VERSION, "commit": COMMIT, "status": "installed",
                          "root": str(root), "python": str(root / "venv/bin/python"),
                          "source": str(root / "source"), "smoke": receipt["smoke"]}))
    finally:
        os.close(descriptor)


if __name__ == "__main__":
    try:
        main()
    except (RuntimeError, OSError, ValueError, KeyError, TypeError):
        # Never forward raw upstream paths, requests, provider messages or configuration to a caller.
        print(json.dumps({"error": "Hermes local installation failed. No model was called or global package installed"}))
        sys.exit(1)
