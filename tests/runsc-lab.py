"""Disposable, unprivileged OCI evidence; deliberately NOT a Docker/quota qualification."""

import hashlib
import json
import os
import pathlib
import shutil
import signal
import socket
import subprocess
import sys
import tarfile
import tempfile

RUNTIME = "release-20261102.0"
ASSETS = {
    "runtime": ("artifacts/tools/runsc/release-20261102.0/gvisor-x86_64.tar.bz2", "6f6b1a8f0f4665a403238135167d0d990bfaeaff5544abf68f5e0d822b35484a"),
    "rootfs": ("artifacts/tools/alpine/3.24.4/alpine-minirootfs-3.24.4-x86_64.tar.gz", "cdaa38cb8de3537967ee5b6c9b6cd00cc962da2b018e6eea48696bb274923012"),
}


def checked_archive(workspace: pathlib.Path, key: str) -> pathlib.Path:
    name, digest = ASSETS[key]
    archive = workspace / name
    if archive.is_symlink() or not archive.is_file() or archive.stat().st_nlink != 1:
        raise RuntimeError("Missing safe pinned archives; run bun run runsc:install")
    if hashlib.sha256(archive.read_bytes()).hexdigest() != digest:
        raise RuntimeError("Pinned laboratory archive checksum mismatch")
    return archive


def extract_members(archive: pathlib.Path, target: pathlib.Path, selected: set[str] | None = None) -> None:
    # Extract only regular public binaries. No archive symlink/device or traversal is materialized.
    with tarfile.open(archive) as bundle:
        for entry in bundle.getmembers():
            clean = entry.name.removeprefix("./")
            if selected is not None and clean not in selected:
                continue
            path = pathlib.PurePosixPath(clean)
            if path.is_absolute() or ".." in path.parts or not entry.isfile():
                if entry.isdir():
                    continue
                raise RuntimeError("Unexpected archive entry")
            destination = target.joinpath(*path.parts)
            destination.parent.mkdir(parents=True, exist_ok=True)
            source = bundle.extractfile(entry)
            if source is None:
                raise RuntimeError("Missing archive member")
            with source, destination.open("xb") as output:
                shutil.copyfileobj(source, output)
            destination.chmod(0o755)


def command(args: list[str], timeout: int = 30) -> subprocess.CompletedProcess[str]:
    return subprocess.run(args, text=True, capture_output=True, timeout=timeout, check=False, env={"PATH": "/usr/bin:/bin", "LC_ALL": "C"})


def safe_remove(root: pathlib.Path) -> None:
    base = pathlib.Path("/tmp").resolve()
    if root.is_symlink() or root.resolve().parent != base or not root.name.startswith("godseye-runsc-lab-"):
        raise RuntimeError("Unsafe laboratory cleanup target")
    shutil.rmtree(root)


def positive_control(listener: socket.socket) -> bool:
    """Exercise only this fixture's own loopback listener; no host administration is contacted."""
    connection = socket.socket(listener.family)
    connection.settimeout(1)
    try:
        connection.connect(listener.getsockname())
        accepted, _ = listener.accept()
        accepted.close()
        return True
    finally:
        connection.close()


def no_connection(listener: socket.socket) -> bool:
    listener.settimeout(0.1)
    try:
        unexpected, _ = listener.accept()
        unexpected.close()
        return False
    except TimeoutError:
        return True


def main() -> dict:
    """Keep the complete fixture lifetime and cleanup under one owned temporary namespace tree."""
    workspace = pathlib.Path(sys.argv[1]).resolve(strict=True)
    if sys.platform != "linux" or os.uname().machine != "x86_64":
        raise RuntimeError("Explicit gVisor lab requires Linux x86_64 or WSL Ubuntu")
    if os.geteuid() == 0:
        raise RuntimeError("Run this lab as an unprivileged user, not root")
    runtime_archive = checked_archive(workspace, "runtime")
    rootfs_archive = checked_archive(workspace, "rootfs")
    probe = command(["unshare", "--user", "--map-root-user", "--mount", "--net", "--fork", "true"])
    if probe.returncode:
        raise RuntimeError("Unprivileged user/mount/network namespaces unavailable; no fallback admitted")
    root = pathlib.Path(tempfile.mkdtemp(prefix="godseye-runsc-lab-", dir="/tmp"))
    root.chmod(0o700)
    runtime_state = root / "state"
    tool = root / "tool"
    bundle = root / "bundle-a"
    rootfs = bundle / "rootfs"
    tool.mkdir()
    rootfs.mkdir(parents=True)
    listener4 = socket.socket()
    listener6 = socket.socket(socket.AF_INET6)
    proc = None
    cleanup_errors = []
    try:
        extract_members(runtime_archive, tool)
        extract_members(rootfs_archive, rootfs, {"bin/busybox", "lib/ld-musl-x86_64.so.1"})
        for name in ("etc", "tmp", "proc", "dev", "readonly-fixture"):
            (rootfs / name).mkdir(exist_ok=True)
        (rootfs / "readonly-fixture").chmod(0o777)
        (rootfs / "etc/fixture").write_text("fixture-cell-A\n")
        (rootfs / "quota-source").write_bytes(bytes(2 * 1024 * 1024))
        foreign = root / "bundle-b/rootfs/etc/fixture"
        foreign.parent.mkdir(parents=True)
        foreign.write_text("fixture-cell-B\n")
        listener4.bind(("127.0.0.1", 0))
        listener4.listen()
        listener6.bind(("::1", 0))
        listener6.listen()
        positive4 = positive_control(listener4)
        positive6 = positive_control(listener6)
        script = "\n".join([
            "/bin/busybox id -u",
            "/bin/busybox uname -r",
            "test -f /proc/gvisor/kernel_is_gvisor && echo GVISOR_MARKER",
            "/bin/busybox cat /etc/fixture",
            f"test ! -e {foreign} && echo CROSS_ROOT_DENIED",
            "/bin/busybox touch /readonly-fixture/write-attempt || echo READ_ONLY_DENIED",
            "/bin/busybox cp /quota-source /tmp/quota-check || echo TMPFS_BOUND",
            f"/bin/busybox nc -w1 127.0.0.1 {listener4.getsockname()[1]} || echo HOST_IPV4_DENIED",
            f"/bin/busybox nc -w1 ::1 {listener6.getsockname()[1]} || echo HOST_IPV6_DENIED",
        ])
        config = {
            "ociVersion": "1.2.0",
            "process": {"terminal": False, "user": {"uid": 1000, "gid": 1000}, "args": ["/bin/busybox", "sh", "-c", script], "env": ["PATH=/bin", "LC_ALL=C"], "cwd": "/", "noNewPrivileges": True, "capabilities": {name: [] for name in ("bounding", "effective", "inheritable", "permitted", "ambient")}, "rlimits": [{"type": "RLIMIT_NOFILE", "hard": 64, "soft": 64}]},
            "root": {"path": "rootfs", "readonly": True},
            "hostname": "godseye-fixture",
            "mounts": [{"destination": "/proc", "type": "proc", "source": "proc"}, {"destination": "/dev", "type": "tmpfs", "source": "tmpfs", "options": ["nosuid", "strictatime", "mode=755", "size=1m"]}, {"destination": "/tmp", "type": "tmpfs", "source": "tmpfs", "options": ["nosuid", "nodev", "mode=1777", "size=1m"]}],
            "linux": {"namespaces": [{"type": name} for name in ("pid", "ipc", "uts", "mount", "network")], "resources": {}},
        }
        (bundle / "config.json").write_text(json.dumps(config))
        version = command([str(tool / "runsc"), "--version"])
        if version.returncode or RUNTIME not in version.stdout:
            raise RuntimeError("Pinned runtime version did not match")
        args = ["unshare", "--user", "--map-root-user", "--mount", "--net", "--fork", str(tool / "runsc"), "--root", str(runtime_state), "--platform=systrap", "--network=none", "--gvisor-marker-file=true", "--ignore-cgroups=true", "run", "--bundle", str(bundle), "fixture-a"]
        proc = subprocess.Popen(args, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, start_new_session=True, env={"PATH": "/usr/bin:/bin", "LC_ALL": "C"})
        try:
            stdout, stderr = proc.communicate(timeout=30)
        except subprocess.TimeoutExpired:
            os.killpg(proc.pid, signal.SIGKILL)
            proc.communicate(timeout=5)
            raise RuntimeError("Bounded gVisor fixture timed out") from None
        lines = stdout.splitlines()
        if proc.returncode or not lines:
            raise RuntimeError("Pinned systrap OCI startup failed without a native fallback")
        return {
            "runtime": RUNTIME,
            "platform": "systrap",
            "hostKernel": os.uname().release,
            "guestKernel": lines[1] if len(lines) > 1 else "",
            "nonRootUid": lines[0] == "1000",
            "gvisorMarker": "GVISOR_MARKER" in lines,
            "ownFixtureVisible": "fixture-cell-A" in lines,
            "crossRootDenied": "CROSS_ROOT_DENIED" in lines,
            "readOnlyDenied": "READ_ONLY_DENIED" in lines and "Read-only file system" in stderr,
            "tmpfsBound": "TMPFS_BOUND" in lines and "No space left on device" in stderr,
            "hostIpv4ControlReachable": positive4,
            "hostIpv6ControlReachable": positive6,
            "hostIpv4Denied": "HOST_IPV4_DENIED" in lines and no_connection(listener4),
            "hostIpv6Denied": "HOST_IPV6_DENIED" in lines and no_connection(listener6),
            "networkProbesExecuted": all(message not in stderr for message in ("applet not found", "bad address", "unrecognized option", "invalid option")),
            "cgroupLimitsQualified": False,
            "persistentDataQuotaQualified": False,
            "dockerNetworkQualified": False,
            "checksumValidated": True,
            "signatureVerified": False,
        }
    finally:
        listener4.close()
        listener6.close()
        if proc is not None and proc.poll() is None:
            os.killpg(proc.pid, signal.SIGKILL)
            proc.wait(timeout=5)
        if tool.exists():
            try:
                result = command(["unshare", "--user", "--map-root-user", "--mount", "--net", "--fork", str(tool / "runsc"), "--root", str(runtime_state), "delete", "--force", "fixture-a"], 5)
                if result.returncode and runtime_state.exists() and any(runtime_state.iterdir()):
                    cleanup_errors.append("runtime deletion failed")
            except (subprocess.TimeoutExpired, OSError):
                cleanup_errors.append("runtime deletion failed")
        if cleanup_errors:
            raise RuntimeError("Laboratory cleanup was incomplete")
        safe_remove(root)


if __name__ == "__main__":
    try:
        print(json.dumps(main()))
    except Exception as error:
        # Fixed fixture diagnostics contain no provider data or host environment values.
        print(json.dumps({"error": str(error)}))
        sys.exit(1)
