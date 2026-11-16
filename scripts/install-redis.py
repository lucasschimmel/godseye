"""Extract signed Ubuntu Redis packages into an unprivileged project-local cache."""

import hashlib
import json
import lzma
import os
from pathlib import Path
import platform
import re
import shutil
import stat
import subprocess
import sys
import tempfile
import urllib.request

VERSION = "8.0.5"
PACKAGE_VERSION = "5:8.0.5-1ubuntu0.1"
BASE = "https://archive.ubuntu.com/ubuntu/"
KEYRING = "/usr/share/keyrings/ubuntu-archive-keyring.gpg"
PACKAGES = ("redis-server", "redis-tools", "liblzf1")
MAX_DOWNLOAD = 100 * 1024 * 1024


def download(url: str, target: Path) -> bytes:
    """Download bounded HTTPS bytes; callers verify signed metadata hashes."""
    with urllib.request.urlopen(url, timeout=90) as response:
        content = response.read(MAX_DOWNLOAD + 1)
    if len(content) > MAX_DOWNLOAD:
        raise RuntimeError("Official Redis package download exceeded its configured bound")
    safe_leaf(target)
    target.write_bytes(content)
    return content


def safe_leaf(path: Path) -> None:
    """Reject existing links and multiply linked cache files before read/write."""
    if path.is_symlink():
        raise RuntimeError("Refusing a linked Redis cache file")
    if path.exists():
        info = path.lstat()
        if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1:
            raise RuntimeError("Refusing a non-private Redis cache file")


def tree_description(root: Path) -> dict[str, tuple[str, str]]:
    """Describe immutable tool bytes, checking every directory and leaf without following links."""
    if root.is_symlink() or not root.is_dir() or root.resolve() != root:
        raise RuntimeError("Refusing an unsafe Redis extraction root")
    result = {}
    for directory, directories, files in os.walk(root, followlinks=False):
        for name in directories + files:
            path = Path(directory) / name
            info = path.lstat()
            relative = str(path.relative_to(root))
            if stat.S_ISLNK(info.st_mode):
                target = os.readlink(path)
                if not path.resolve().is_relative_to(root):
                    raise RuntimeError("Redis package link escapes its extraction root")
                result[relative] = ("link", target)
            elif stat.S_ISDIR(info.st_mode):
                result[relative] = ("directory", "")
            elif stat.S_ISREG(info.st_mode) and info.st_nlink == 1:
                result[relative] = ("file", hashlib.sha256(path.read_bytes()).hexdigest())
            else:
                raise RuntimeError("Refusing an unsafe Redis extraction entry")
    return result


def signed_index(cache: Path, suite: str, component: str) -> list[dict[str, str]]:
    """Verify archive signatures and package-index SHA256 before selecting packages."""
    release = cache / f"{suite}.InRelease"
    download(f"{BASE}dists/{suite}/InRelease", release)
    verified = subprocess.run(
        ["gpgv", "--keyring", KEYRING, str(release)], capture_output=True, text=True, check=True
    )
    if "Good signature" not in verified.stderr:
        raise RuntimeError("Ubuntu archive signature was not verified")
    index_name = f"{component}/binary-amd64/Packages.xz"
    sha_section = release.read_text().split("SHA256:\n", 1)[1].split("\nSHA", 1)[0]
    expected = next(line.split() for line in sha_section.splitlines() if line.endswith(f" {index_name}"))
    compressed = download(f"{BASE}dists/{suite}/{index_name}", cache / f"{suite}-{component}.Packages.xz")
    if hashlib.sha256(compressed).hexdigest() != expected[0] or len(compressed) != int(expected[1]):
        raise RuntimeError("Ubuntu Redis package index failed signed SHA256/size verification")
    records = []
    for paragraph in lzma.decompress(compressed).decode().split("\n\n"):
        record = dict(line.split(": ", 1) for line in paragraph.splitlines() if ": " in line and not line.startswith(" "))
        if record.get("Package") in PACKAGES and record.get("Architecture") == "amd64":
            records.append(record)
    return records


def main() -> None:
    """Extract packages only: no apt install, sudo, service or system configuration."""
    if platform.machine() != "x86_64" or os.getuid() == 0:
        raise RuntimeError("The Redis laboratory installer requires non-root Ubuntu amd64")
    cache = Path(sys.argv[1]).absolute()
    if cache.resolve() != cache or not str(cache).endswith("/artifacts/tools/redis/8.0.5"):
        raise RuntimeError("Refusing an unexpected or linked Redis tool cache")
    cache.mkdir(parents=True, exist_ok=True)
    destination = cache / "root"
    if destination.exists() or destination.is_symlink():
        tree_description(destination)
    catalog = {}
    sources = []
    for suite in ("resolute", "resolute-updates", "resolute-security"):
        catalog.update((record["Package"], record) for record in signed_index(cache, suite, "universe"))
        sources.append(f"{BASE}dists/{suite}/InRelease")
    evidence = []
    staging = Path(tempfile.mkdtemp(prefix=".redis-owned-stage-", dir=cache))
    staged_root = staging / "root"
    staged_root.mkdir(mode=0o700)
    try:
        for package in PACKAGES:
            record = catalog[package]
            if package.startswith("redis-") and record["Version"] != PACKAGE_VERSION:
                raise RuntimeError("Pinned patched Redis package version unavailable; review installer pin")
            filename = record["Filename"]
            if not re.fullmatch(r"pool/[A-Za-z0-9_./+~-]+\.deb", filename) or ".." in filename:
                raise RuntimeError("Unexpected official Redis package filename")
            archive = cache / Path(filename).name
            safe_leaf(archive)
            content = archive.read_bytes() if archive.exists() else download(BASE + filename, archive)
            if hashlib.sha256(content).hexdigest() != record["SHA256"] or len(content) != int(record["Size"]):
                raise RuntimeError("Redis package failed signed-metadata SHA256/size verification")
            subprocess.run(["dpkg-deb", "--extract", str(archive), str(staged_root)], check=True)
            evidence.append({"package": package, "version": record["Version"], "source": BASE + filename, "sha256": record["SHA256"]})
        staged_tree = tree_description(staged_root)
        if destination.exists():
            if tree_description(destination) != staged_tree:
                raise RuntimeError("Existing Redis tool cache differs from verified package bytes")
        else:
            staged_root.rename(destination)
    finally:
        if staging.parent != cache or staging.resolve() != staging or staging.stat().st_uid != os.getuid():
            raise RuntimeError("Refusing unsafe Redis staging cleanup")
        shutil.rmtree(staging)
    env = {**os.environ, "LD_LIBRARY_PATH": str(destination / "usr/lib/x86_64-linux-gnu")}
    version = subprocess.check_output([str(destination / "usr/bin/redis-server"), "--version"], env=env, text=True).strip()
    result = {"version": version, "containment": "native-process-lab-only", "sources": sources, "verification": "gpgv Ubuntu archive keyring + signed index SHA256 + package SHA256", "packages": evidence}
    safe_leaf(cache / "provenance.json")
    (cache / "provenance.json").write_text(json.dumps(result, indent=2) + "\n")
    print(json.dumps({"version": version, "cache": "artifacts/tools/redis/8.0.5", "verification": result["verification"], "containment": result["containment"]}))


if __name__ == "__main__":
    main()
