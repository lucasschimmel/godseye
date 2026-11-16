"""Bounded native private files for the local Hermes preparation surface."""

from contextlib import contextmanager
import fcntl
import hashlib
import json
import os
from pathlib import Path
import pwd
import stat
import tempfile
from typing import Iterator

MAX_FILE_BYTES = 131072


class DurabilityUncertain(RuntimeError):
    """The new valid pointer is visible but directory durability was not confirmed."""


def document(value: object) -> bytes:
    """Canonical UTF-8 encoding for immutable configuration digests."""
    return (json.dumps(value, sort_keys=True, indent=2, ensure_ascii=True) + "\n").encode()


def digest(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def runtime_root(workspace: Path) -> Path:
    """Bind native ext4 storage to the real account and canonical workspace."""
    home = Path(pwd.getpwuid(os.getuid()).pw_dir).resolve(strict=True)
    return home / ".local/share/godseye-hermes" / digest(str(workspace).encode())


def no_aliases(path: Path) -> None:
    for candidate in [*reversed(path.parents), path]:
        if candidate.is_symlink():
            raise RuntimeError("Linked Hermes path is refused")
        if candidate.exists() and candidate.resolve(strict=True) != candidate:
            raise RuntimeError("Aliased Hermes path is refused")


def private_directory(path: Path) -> None:
    """Never adopt an existing shared or foreign runtime directory."""
    no_aliases(path)
    path.mkdir(mode=0o700, parents=True, exist_ok=True)
    existing_directory(path)


def existing_directory(path: Path) -> None:
    """Read-only verification must never create or adopt a missing profile/revision."""
    no_aliases(path)
    info = path.lstat()
    if not stat.S_ISDIR(info.st_mode) or info.st_uid != os.getuid() or info.st_mode & 0o077:
        raise RuntimeError("Hermes directory is not private and owned")


def regular(path: Path, private: bool = True) -> os.stat_result:
    no_aliases(path)
    info = path.lstat()
    if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1:
        raise RuntimeError("Hermes file is not a single regular file")
    if private and (info.st_uid != os.getuid() or info.st_mode & 0o077):
        raise RuntimeError("Hermes file is not private and owned")
    return info


def read_bytes(path: Path, private: bool = True) -> bytes:
    """Open with no-follow and verify the descriptor before bounded reading."""
    before = regular(path, private)
    descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    with os.fdopen(descriptor, "rb") as stream:
        current = os.fstat(stream.fileno())
        if (before.st_dev, before.st_ino) != (current.st_dev, current.st_ino) or current.st_nlink != 1:
            raise RuntimeError("Hermes file changed during opening")
        content = stream.read(MAX_FILE_BYTES + 1)
        if len(content) > MAX_FILE_BYTES:
            raise RuntimeError("Hermes file exceeds the preparation limit")
        return content


def read_json(path: Path, private: bool = True) -> object:
    return json.loads(read_bytes(path, private))


def sync_directory(path: Path) -> None:
    descriptor = os.open(path, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def write_new(path: Path, content: bytes) -> None:
    existing_directory(path.parent)
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    with os.fdopen(descriptor, "wb") as stream:
        stream.write(content)
        stream.flush()
        os.fsync(stream.fileno())


def replace_json(path: Path, value: object) -> None:
    """Preserve the previous pointer before publication; flag uncertain post-publication sync."""
    existing_directory(path.parent)
    if path.exists():
        regular(path)
    descriptor, name = tempfile.mkstemp(prefix=".pointer-", dir=path.parent)
    stage = Path(name)
    try:
        with os.fdopen(descriptor, "wb") as stream:
            stream.write(document(value))
            stream.flush()
            os.fsync(stream.fileno())
        if path.exists():
            regular(path)
        os.replace(stage, path)
        try:
            sync_directory(path.parent)
        except OSError as error:
            raise DurabilityUncertain("Hermes pointer published; durability requires inspection") from error
    finally:
        if stage.exists():
            regular(stage)
            stage.unlink()


@contextmanager
def exclusive(root: Path) -> Iterator[None]:
    """OS-held preparation lock releases after process death without PID inference."""
    private_directory(root)
    path = root / ".operation.lock"
    if path.exists():
        regular(path)
    descriptor = os.open(path, os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
    try:
        info = os.fstat(descriptor)
        if info.st_uid != os.getuid() or info.st_nlink != 1 or info.st_mode & 0o077:
            raise RuntimeError("Unsafe Hermes operation lock")
        fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
        yield
    finally:
        os.close(descriptor)
