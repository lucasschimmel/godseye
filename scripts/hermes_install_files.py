"""Private, bounded filesystem operations for the local Hermes tool installer."""

import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import shutil
import stat
import tarfile
import tempfile
import urllib.request

MAX_DOWNLOAD_BYTES = 256 * 1024 * 1024
MAX_EXTRACT_BYTES = 1024 * 1024 * 1024
MAX_ARCHIVE_ENTRIES = 100_000


def private_directory(path: Path) -> None:
    """Create only real, current-user-owned private directories beneath an existing root."""
    if not path.is_absolute() or path.is_symlink() or path.resolve() != path:
        raise RuntimeError("Linked Hermes directories are refused")
    if not path.exists():
        private_directory(path.parent)
        path.mkdir(mode=0o700)
    info = path.lstat()
    if not stat.S_ISDIR(info.st_mode) or info.st_uid != os.getuid():
        raise RuntimeError("Hermes directory ownership is invalid")
    if info.st_mode & 0o077:
        raise RuntimeError("Hermes private directory permissions are too broad")


def regular_file(path: Path) -> None:
    """Refuse links, devices, foreign ownership and multiply linked metadata."""
    info = path.lstat()
    if (not stat.S_ISREG(info.st_mode) or info.st_nlink != 1
            or info.st_uid != os.getuid()):
        raise RuntimeError("Unsafe Hermes installation file")


def read_json(path: Path) -> dict:
    """Read bounded installer-owned non-sensitive metadata."""
    regular_file(path)
    if path.stat().st_size > MAX_EXTRACT_BYTES:
        raise RuntimeError("Hermes metadata exceeds its bound")
    return json.loads(path.read_text(encoding="utf-8"))


def write_json(path: Path, value: dict) -> None:
    """Publish complete private metadata without truncating an existing file."""
    if path.exists() or path.is_symlink():
        regular_file(path)
    fd, temporary = tempfile.mkstemp(prefix=".hermes-metadata-", dir=path.parent)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            json.dump(value, handle, indent=2, sort_keys=True)
            handle.write("\n")
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, path)
        descriptor = os.open(path.parent, os.O_DIRECTORY)
        try:
            os.fsync(descriptor)
        finally:
            os.close(descriptor)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def digest(path: Path) -> str:
    """Hash a file incrementally without loading archives or environments into memory."""
    regular_file(path)
    with path.open("rb") as handle:
        return hashlib.file_digest(handle, "sha256").hexdigest()


def download(url: str, target: Path, expected: str) -> None:
    """Retain only bounded HTTPS downloads matching the reviewed immutable pin."""
    if target.exists() or target.is_symlink():
        if digest(target) != expected:
            raise RuntimeError("Cached Hermes download differs from its reviewed hash")
        return
    descriptor, temporary = tempfile.mkstemp(prefix=".hermes-download-", dir=target.parent)
    try:
        with os.fdopen(descriptor, "wb") as handle:
            with urllib.request.urlopen(url, timeout=120) as response:
                if not response.geturl().startswith("https://"):
                    raise RuntimeError("Hermes download redirected away from HTTPS")
                size = 0
                while chunk := response.read(1024 * 1024):
                    size += len(chunk)
                    if size > MAX_DOWNLOAD_BYTES:
                        raise RuntimeError("Hermes download exceeded its bound")
                    handle.write(chunk)
            handle.flush()
            os.fsync(handle.fileno())
        if digest(Path(temporary)) != expected:
            raise RuntimeError("Hermes download failed reviewed SHA256 verification")
        os.rename(temporary, target)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def tree_hashes(root: Path, containment: Path) -> dict[str, str]:
    """Describe immutable source/runtime bytes, including confined links, without following links."""
    if (root.is_symlink() or root.resolve() != root or not root.is_dir()
            or root.lstat().st_uid != os.getuid() or not root.is_relative_to(containment)):
        raise RuntimeError("Hermes tree root is not a real owned confined directory")
    result = {}
    for directory, directories, files in os.walk(root, followlinks=False):
        for name in sorted(directories + files):
            path = Path(directory) / name
            relative = path.relative_to(root).as_posix()
            info = path.lstat()
            if info.st_uid != os.getuid():
                raise RuntimeError("Hermes install contains foreign-owned entries")
            if stat.S_ISLNK(info.st_mode):
                if not path.resolve().is_relative_to(containment):
                    raise RuntimeError("Hermes runtime link escapes its owned installation")
                result[relative] = "link:" + os.readlink(path)
            elif stat.S_ISREG(info.st_mode):
                result[relative] = digest(path)
            elif not stat.S_ISDIR(info.st_mode):
                raise RuntimeError("Hermes install contains a special file")
    return result


def detach_build_hardlinks(root: Path) -> None:
    """Materialize PM cache-linked files privately without mutating their shared cache inode."""
    if root.is_symlink() or root.resolve() != root or not root.is_dir():
        raise RuntimeError("Hermes build output root is unsafe")
    for directory, _directories, files in os.walk(root, followlinks=False):
        for name in files:
            path = Path(directory) / name
            info = path.lstat()
            if stat.S_ISREG(info.st_mode) and info.st_nlink > 1:
                if info.st_uid != os.getuid() or path.resolve() != path:
                    raise RuntimeError("Hermes build hardlink is unsafe")
                descriptor, temporary = tempfile.mkstemp(prefix=".hermes-copy-", dir=path.parent)
                try:
                    source = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
                    with os.fdopen(source, "rb") as reader, os.fdopen(descriptor, "wb") as writer:
                        shutil.copyfileobj(reader, writer)
                        writer.flush()
                        os.fchmod(writer.fileno(), stat.S_IMODE(info.st_mode))
                        os.fsync(writer.fileno())
                    os.replace(temporary, path)
                finally:
                    if os.path.exists(temporary):
                        os.unlink(temporary)


def extract(archive: Path, target: Path, prefix: str, allow_links: bool) -> None:
    """Extract a hash-verified archive through bounded path/type checks into a private stage."""
    private_directory(target.parent)
    staging = Path(tempfile.mkdtemp(prefix=".hermes-extract-", dir=target.parent))
    try:
        with tarfile.open(archive, "r:gz") as package:
            members = package.getmembers()
            if len(members) > MAX_ARCHIVE_ENTRIES or sum(m.size for m in members) > MAX_EXTRACT_BYTES:
                raise RuntimeError("Hermes archive expansion exceeded its bounds")
            for member in members:
                parts = PurePosixPath(member.name).parts
                if (not parts or parts[0] != prefix or ".." in parts
                        or PurePosixPath(member.name).is_absolute()
                        or not (member.isfile() or member.isdir() or (allow_links and member.issym()))):
                    raise RuntimeError("Unsafe Hermes archive entry")
                if member.issym():
                    candidate = staging / member.name
                    if not (candidate.parent / member.linkname).resolve().is_relative_to(staging):
                        raise RuntimeError("Hermes archive link escapes its stage")
            package.extractall(staging, members=members, filter="data")
        extracted = staging / prefix
        tree_hashes(extracted, staging)
        if target.exists() or target.is_symlink():
            raise RuntimeError("Refusing to replace an existing Hermes extraction")
        extracted.rename(target)
    finally:
        if staging.parent != target.parent or staging.resolve() != staging:
            raise RuntimeError("Refusing unsafe Hermes staging cleanup")
        shutil.rmtree(staging)
