"""Extract official signed Ubuntu PostgreSQL packages into a disposable project cache."""

import hashlib
import json
import lzma
import os
from pathlib import Path
import platform
import re
import subprocess
import sys
import urllib.request

VERSION = "18.6"
DEBIAN_VERSION = "18.6-0ubuntu0.26.04.1"
BASE = "https://archive.ubuntu.com/ubuntu/"
KEYRING = "/usr/share/keyrings/ubuntu-archive-keyring.gpg"
PACKAGES = ("postgresql-18", "postgresql-client-18", "libpq5", "libicu78", "libnuma1", "liburing2", "libxslt1.1")
MAX_DOWNLOAD = 100 * 1024 * 1024


def download(url: str, path: Path) -> bytes:
    """Read a bounded HTTPS artifact; signatures/hashes are checked by the caller."""
    with urllib.request.urlopen(url, timeout=90) as response:
        content = response.read(MAX_DOWNLOAD + 1)
    if len(content) > MAX_DOWNLOAD:
        raise RuntimeError("Official package download exceeded the configured bound")
    path.write_bytes(content)
    return content


def digest(content: bytes) -> str:
    return hashlib.sha256(content).hexdigest()


def signed_index(cache: Path, suite: str) -> tuple[list[dict[str, str]], dict[str, str]]:
    """Authenticate index bytes against an archive-keyring verified InRelease."""
    release = cache / f"{suite}.InRelease"
    download(f"{BASE}dists/{suite}/InRelease", release)
    verified = subprocess.run(
        ["gpgv", "--keyring", KEYRING, str(release)], capture_output=True, text=True, check=True
    )
    if "Good signature" not in verified.stderr:
        raise RuntimeError("Ubuntu archive signature was not verified")
    index_name = "main/binary-amd64/Packages.xz"
    sha_section = release.read_text().split("SHA256:\n", 1)[1].split("\nSHA", 1)[0]
    expected = next(line.split() for line in sha_section.splitlines() if line.endswith(f" {index_name}"))
    compressed = download(f"{BASE}dists/{suite}/{index_name}", cache / f"{suite}.Packages.xz")
    if digest(compressed) != expected[0] or len(compressed) != int(expected[1]):
        raise RuntimeError("Ubuntu package index failed its signed SHA256/size verification")
    records = []
    for paragraph in lzma.decompress(compressed).decode().split("\n\n"):
        record = dict(line.split(": ", 1) for line in paragraph.splitlines() if ": " in line and not line.startswith(" "))
        if record.get("Package") in PACKAGES and record.get("Architecture") == "amd64":
            records.append(record)
    return records, {"suite": suite, "source": f"{BASE}dists/{suite}/InRelease", "verification": "gpgv Ubuntu archive keyring + signed index SHA256", "indexSha256": expected[0]}


def main() -> None:
    if platform.machine() != "x86_64" or os.getuid() == 0:
        raise RuntimeError("The native lab requires a non-root Ubuntu amd64 user")
    cache = Path(sys.argv[1]).absolute()
    if cache.resolve() != cache or not str(cache).endswith("/artifacts/tools/postgres/18.6"):
        raise RuntimeError("Refusing an unexpected or linked PostgreSQL tool cache")
    cache.mkdir(parents=True, exist_ok=True)
    destination = cache / "root"
    destination.mkdir(exist_ok=True)
    catalog: dict[str, dict[str, str]] = {}
    sources = []
    for suite in ("resolute", "resolute-updates"):
        records, source = signed_index(cache, suite)
        sources.append(source)
        catalog.update((record["Package"], record) for record in records)
    evidence = []
    for package in PACKAGES:
        record = catalog[package]
        if package.startswith("postgresql-") and record["Version"] != DEBIAN_VERSION:
            raise RuntimeError("Pinned PostgreSQL package version is unavailable; review the installer pin")
        filename = record["Filename"]
        if not re.fullmatch(r"pool/[A-Za-z0-9_./+~-]+\.deb", filename) or ".." in filename:
            raise RuntimeError("Unexpected official package filename")
        archive = cache / Path(filename).name
        content = archive.read_bytes() if archive.exists() else download(BASE + filename, archive)
        if digest(content) != record["SHA256"] or len(content) != int(record["Size"]):
            raise RuntimeError("Official Debian package failed signed-metadata SHA256/size verification")
        subprocess.run(["dpkg-deb", "--extract", str(archive), str(destination)], check=True)
        evidence.append({"package": package, "version": record["Version"], "source": BASE + filename, "sha256": record["SHA256"]})
    env = {**os.environ, "LD_LIBRARY_PATH": str(destination / "usr/lib/x86_64-linux-gnu")}
    version = subprocess.check_output([str(destination / "usr/lib/postgresql/18/bin/postgres"), "--version"], env=env, text=True).strip()
    result = {"version": version, "containment": "native-process-lab-only", "sources": sources, "packages": evidence}
    (cache / "provenance.json").write_text(json.dumps(result, indent=2) + "\n")
    print(json.dumps({"version": version, "verification": "Ubuntu archive gpgv signed metadata and package SHA256", "cache": "artifacts/tools/postgres/18.6", "containment": result["containment"]}))


if __name__ == "__main__":
    main()
