"""Extract authenticated Ubuntu packages into a project-local pgBackRest lab cache."""

import importlib.util
import gzip
import json
import lzma
import os
from pathlib import Path
import platform
import re
import subprocess
import sys

PIN = "2.60.0-1.pgdg26.04+1"
PACKAGES = ("libssh2-1t64", "libxml2-16")
PGDG_BASE = "https://apt.postgresql.org/pub/repos/apt/"
PGDG_FINGERPRINT = "B97B0AFCAA1A47F044F244A07FCC7D46ACCC4CF8"


def main() -> None:
    """Reuse the signed PostgreSQL installer download/hash primitives without mutating it."""
    if platform.machine() != "x86_64" or os.getuid() == 0:
        raise RuntimeError("The native lab requires a non-root Ubuntu amd64 user")
    spec = importlib.util.spec_from_file_location("signed_pg", Path(__file__).with_name("install-postgres.py"))
    helper = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(helper)
    cache = Path(sys.argv[1]).absolute()
    if cache.resolve() != cache or not str(cache).endswith("/artifacts/tools/pgbackrest/2.60.0"):
        raise RuntimeError("Refusing an unexpected or linked pgBackRest tool cache")
    cache.mkdir(parents=True, exist_ok=True)
    destination = cache / "root"
    destination.mkdir(exist_ok=True)
    catalog, sources = {}, []
    for suite in ("resolute", "resolute-updates"):
        release = cache / f"{suite}.InRelease"
        helper.download(f"{helper.BASE}dists/{suite}/InRelease", release)
        subprocess.run(["gpgv", "--keyring", helper.KEYRING, str(release)], capture_output=True, check=True)
        sha = release.read_text().split("SHA256:\n", 1)[1].split("\nSHA", 1)[0]
        for component in ("main",):
            name = f"{component}/binary-amd64/Packages.xz"
            expected = next(line.split() for line in sha.splitlines() if line.endswith(" " + name))
            index = cache / f"{suite}.{component}.Packages.xz"
            content = helper.download(f"{helper.BASE}dists/{suite}/{name}", index)
            if helper.digest(content) != expected[0] or len(content) != int(expected[1]):
                raise RuntimeError("Ubuntu index failed signed SHA256/size verification")
            for paragraph in lzma.decompress(content).decode().split("\n\n"):
                record = dict(line.split(": ", 1) for line in paragraph.splitlines() if ": " in line and not line.startswith(" "))
                if record.get("Package") in PACKAGES and record.get("Architecture") == "amd64":
                    catalog[record["Package"]] = record
            sources.append({"suite": suite, "component": component, "source": f"{helper.BASE}dists/{suite}/InRelease", "indexSha256": expected[0], "verification": "gpgv Ubuntu archive keyring + signed index SHA256"})
    # Project-local keyring, with the complete primary fingerprint pinned to the official download page.
    key = cache / "pgdg.asc"
    keyring = cache / "pgdg.gpg"
    helper.download("https://www.postgresql.org/media/keys/ACCC4CF8.asc", key)
    keyhome = cache / "gnupg"
    keyhome.mkdir(mode=0o700, exist_ok=True)
    keymeta = subprocess.check_output(["gpg", "--homedir", str(keyhome), "--batch", "--with-colons", "--show-keys", str(key)], text=True)
    fingerprints = [line.split(":")[9] for line in keymeta.splitlines() if line.startswith("fpr:")]
    if not fingerprints or fingerprints[0] != PGDG_FINGERPRINT:
        raise RuntimeError("PGDG archive primary key fingerprint differs")
    subprocess.run(["gpg", "--homedir", str(keyhome), "--batch", "--yes", "--dearmor", "--output", str(keyring), str(key)], check=True, capture_output=True)
    release = cache / "pgdg.InRelease"
    helper.download(PGDG_BASE + "dists/resolute-pgdg/InRelease", release)
    verified = subprocess.run(["gpgv", "--status-fd", "1", "--keyring", str(keyring), str(release)], check=True, capture_output=True, text=True)
    if "VALIDSIG " + PGDG_FINGERPRINT not in verified.stdout:
        raise RuntimeError("PGDG signed release signer differs")
    index_name = "main/binary-amd64/Packages.gz"
    sha = release.read_text().split("SHA256:\n", 1)[1].split("\nSHA", 1)[0]
    expected = next(line.split() for line in sha.splitlines() if line.endswith(" " + index_name))
    content = helper.download(PGDG_BASE + "dists/resolute-pgdg/" + index_name, cache / "pgdg.Packages.gz")
    if helper.digest(content) != expected[0] or len(content) != int(expected[1]):
        raise RuntimeError("PGDG package index failed signed SHA256/size verification")
    for paragraph in gzip.decompress(content).decode().split("\n\n"):
        record = dict(line.split(": ", 1) for line in paragraph.splitlines() if ": " in line and not line.startswith(" "))
        if record.get("Package") == "pgbackrest" and record.get("Architecture") == "amd64":
            catalog["pgbackrest"] = record
            break
    sources.append({"suite": "resolute-pgdg", "source": PGDG_BASE + "dists/resolute-pgdg/InRelease", "indexSha256": expected[0], "signerFingerprint": PGDG_FINGERPRINT, "verification": "gpgv pinned PGDG key + signed index SHA256"})
    if catalog["pgbackrest"]["Version"] != PIN:
        raise RuntimeError("Pinned pgBackRest package changed; review upstream security fixes and installer pin")
    packages = []
    for name in (*PACKAGES, "pgbackrest"):
        record = catalog[name]
        filename = record["Filename"]
        if not re.fullmatch(r"pool/[A-Za-z0-9_./+~-]+\.deb", filename) or ".." in filename:
            raise RuntimeError("Unexpected official package filename")
        archive = cache / Path(filename).name
        base = PGDG_BASE if name == "pgbackrest" else helper.BASE
        content = archive.read_bytes() if archive.exists() else helper.download(base + filename, archive)
        if helper.digest(content) != record["SHA256"] or len(content) != int(record["Size"]):
            raise RuntimeError("Package failed signed SHA256/size verification")
        subprocess.run(["dpkg-deb", "--extract", str(archive), str(destination)], check=True)
        packages.append({"package": name, "version": record["Version"], "sha256": record["SHA256"], "source": base + filename})
    pg_lib = cache.parents[1] / "postgres/18.6/root/usr/lib/x86_64-linux-gnu"
    env = {**os.environ, "LD_LIBRARY_PATH": str(destination / "usr/lib/x86_64-linux-gnu") + ":" + str(pg_lib)}
    version = subprocess.check_output([str(destination / "usr/bin/pgbackrest"), "version"], env=env, text=True).strip()
    result = {"version": version, "sources": sources, "packages": packages, "containment": "native-process-lab-only", "securityGap": None}
    (cache / "provenance.json").write_text(json.dumps(result, indent=2) + "\n")
    print(json.dumps({"version": version, "verification": "Ubuntu archive signatures and SHA256", "securityGap": result["securityGap"]}))


if __name__ == "__main__":
    main()
