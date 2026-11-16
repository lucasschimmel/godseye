"""Separate frozen API execution environment; preserve the existing core tool manifest."""

import fcntl
import json
import os
from pathlib import Path
import runpy
import shutil
import subprocess
import sys
from hermes_catalog import COMMIT, VERSION
from hermes_files import document, existing_directory, private_directory, read_json, regular, replace_json, write_new
from hermes_install_files import detach_build_hardlinks, digest, tree_hashes, read_json as read_install_json

CONTROLLER_SOURCES = ("hermes_gateway.py", "hermes_gateway_broker.py", "hermes_gateway_reply.py", "hermes_gateway_tools_reply.py", "hermes_gateway_state.py", "hermes_gateway_transport.py", "hermes_gateway_events.py", "hermes_tools_bridge.py", "hermes_tools_policy.py", "model_attempt_evidence.py", "hermes_runtime_install.py", "hermes_files.py")

def controller_hashes(workspace: Path) -> dict:
    return {name: digest(workspace / "scripts" / name) for name in CONTROLLER_SOURCES}

def verify_controller(root: Path, workspace: Path) -> None:
    if read_json(root / "controller-provenance.json") != controller_hashes(workspace):
        raise RuntimeError("Hermes native controller sources changed; explicit local runtime qualification is required")


EXECUTION_REVISION = "0.23.1-api-v1"


def execution_root(tool: Path) -> Path:
    return tool.parent.parent / "execution" / EXECUTION_REVISION


def execution_hashes(root: Path, tool: Path) -> dict:
    """Runtime symlinks may name only its own environment or the separately verified Python."""
    result = {}
    for name in ("source", "venv"):
        result[name] = tree_hashes(root / name, tool.parent.parent)
        for path in (root / name).rglob("*"):
            if path.is_symlink():
                target = path.resolve(strict=True)
                if not target.is_relative_to(root) and not target.is_relative_to(tool / "python"):
                    raise RuntimeError("Execution runtime link leaves its exact installation")
    return result


def verify_execution(root: Path, tool: Path) -> dict:
    existing_directory(root)
    receipt = read_json(root / "provenance.json")
    expected = {"schema": 1, "hermesVersion": VERSION, "hermesCommit": COMMIT,
                "extras": ["sms"], "policy": "frozen-minimal-api-no-sms-activation",
                "coreManifestSha256": digest(tool / "immutable-files.json"),
                "lockSha256": digest(tool / "source/uv.lock")}
    if receipt != expected or read_install_json(root / "immutable-files.json") != execution_hashes(root, tool):
        raise RuntimeError("Hermes API execution environment differs from its frozen provenance")
    return receipt


def install(workspace: Path) -> dict:
    """Publish completion only after a fresh frozen build and actual aiohttp import succeed."""
    installer = runpy.run_path(str(workspace / "scripts/install-hermes.py"))
    tool = installer["resolve_root"](str(workspace), False)
    installer["verify_install"](tool)
    root = execution_root(tool)
    private_directory(root.parent)
    lock = root.parent / ".installation.lock"
    descriptor = os.open(lock, os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
    try:
        regular(lock)
        fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
        if root.exists():
            verify_execution(root, tool)
            replace_json(root / "controller-provenance.json", controller_hashes(workspace))
            verify_controller(root, workspace)
            return {"status": "installed", "version": VERSION, "extras": ["sms"]}
        private_directory(root)
        write_new(root / "installation.json", document({"schema": 1, "hermesCommit": COMMIT, "ownerUid": os.getuid()}))
        # PM wheel building writes derived metadata; never run it against the immutable core source.
        shutil.copytree(tool / "source", root / "source", symlinks=True)
        (root / "source").chmod(0o700)
        environment = installer["child_environment"](tool)
        for name in ("HOME", "XDG_CACHE_HOME", "XDG_CONFIG_HOME", "XDG_DATA_HOME"):
            target = root / "build-home" / name.lower()
            private_directory(target)
            environment[name] = str(target)
        environment["HERMES_HOME"] = str(root / "build-home/hermes")
        command = [str(tool / "python/bin/python3.14"), "-B", "-m", "pm.build_env",
                   "--source", str(root / "source"), "--out", str(root / "venv"),
                   "--python", str(tool / "python/bin/python3.14"), "--cache", str(root / "cache"),
                   "--sealed", "--extra", "sms"]
        result = subprocess.run(command, cwd=root / "source", env=environment,
                                stdin=subprocess.DEVNULL, capture_output=True, timeout=900)
        if result.returncode != 0:
            raise RuntimeError("Frozen API execution build failed; retained incomplete tree is not adopted")
        detach_build_hardlinks(root / "venv")
        result = subprocess.run([str(root / "venv/bin/python"), "-I", "-B", "-c",
                                 "import aiohttp; assert aiohttp.__version__ == '3.14.5'"],
                                env=environment, capture_output=True, timeout=30)
        if result.returncode != 0:
            raise RuntimeError("Frozen aiohttp runtime failed its actual import probe")
        installer["verify_install"](tool)
        replace_json(root / "immutable-files.json", execution_hashes(root, tool))
        replace_json(root / "provenance.json", {
            "schema": 1, "hermesVersion": VERSION, "hermesCommit": COMMIT, "extras": ["sms"],
            "policy": "frozen-minimal-api-no-sms-activation",
            "coreManifestSha256": digest(tool / "immutable-files.json"),
            "lockSha256": digest(tool / "source/uv.lock"),
        })
        verify_execution(root, tool)
        replace_json(root / "controller-provenance.json", controller_hashes(workspace))
        verify_controller(root, workspace)
        return {"status": "installed", "version": VERSION, "extras": ["sms"]}
    finally:
        os.close(descriptor)


def main() -> None:
    os.umask(0o077)
    payload = json.loads(sys.stdin.buffer.read(8193))
    if (sys.platform != "linux" or os.getuid() == 0 or set(payload) != {"workspace"}
            or not isinstance(payload["workspace"], str)):
        raise ValueError("Invalid local runtime install request")
    workspace = Path(payload["workspace"])
    if not workspace.is_absolute() or workspace.resolve(strict=True) != workspace:
        raise ValueError("Invalid native workspace")
    print(json.dumps(install(workspace)))


if __name__ == "__main__":
    try:
        main()
    except Exception:
        print(json.dumps({"status": "unavailable", "message": "Local Hermes execution installation refused; retained state is preserved"}))
        sys.exit(1)
