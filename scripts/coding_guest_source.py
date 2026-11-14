"""Copy inert Git object bytes; all Git interpretation and checkout run in the guest."""
import hashlib
import io
import json
import os
from pathlib import Path
import re
import stat
import tarfile
import zlib

MAX_SOURCE_BYTES = 64 * 1024 * 1024
MAX_SOURCE_FILES = 10000
OBJECT_PATH = re.compile(r'(?:[a-f0-9]{2}/[a-f0-9]{38}|pack/pack-[a-f0-9]{40}\.(?:pack|idx|rev))')


def snapshot(source: Path, commit_sha: str) -> tuple[bytes, dict]:
    """Read an exact private registered object directory without invoking host Git."""
    if not re.fullmatch('[a-f0-9]{40}', commit_sha):
        raise ValueError('Invalid source commit')
    if source.resolve() != source or not source.is_dir():
        raise ValueError('Source registration must be an absolute unlinked directory')
    objects = source / '.git/objects'
    if not objects.is_dir() or objects.is_symlink() or (objects / 'info/alternates').exists():
        raise ValueError('Linked/shared/alternate Git objects are unsupported')
    if (source / '.git').is_symlink():
        raise ValueError('Source worktree metadata must be task-independent')
    members = []
    total = 0
    opened = []
    directory_flags = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW

    def walk(directory_fd: int, prefix: str = '') -> None:
        nonlocal total
        names = sorted(os.listdir(directory_fd))
        if len(names) > MAX_SOURCE_FILES or prefix.count('/') > 1:
            raise ValueError('Source directory enumeration exceeds bounds')
        for name in names:
            relative = prefix + name
            metadata = os.stat(name, dir_fd=directory_fd, follow_symlinks=False)
            if stat.S_ISDIR(metadata.st_mode):
                if not re.fullmatch(r'(?:[a-f0-9]{2}|pack|info)', relative):
                    raise ValueError('Unsupported source directory')
                descriptor = os.open(name, directory_flags, dir_fd=directory_fd)
                try:
                    walk(descriptor, relative + '/')
                finally:
                    os.close(descriptor)
                continue
            if not stat.S_ISREG(metadata.st_mode) or metadata.st_nlink != 1 or not OBJECT_PATH.fullmatch(relative):
                raise ValueError('Unsupported source object metadata')
            if len(members) >= MAX_SOURCE_FILES or total + metadata.st_size > MAX_SOURCE_BYTES:
                raise ValueError('Source object snapshot exceeds bounds')
            descriptor = os.open(name, os.O_RDONLY | os.O_NOFOLLOW, dir_fd=directory_fd)
            with os.fdopen(descriptor, 'rb') as stream:
                actual = os.fstat(stream.fileno())
                if actual.st_nlink != 1 or (actual.st_dev, actual.st_ino, actual.st_size) != (metadata.st_dev, metadata.st_ino, metadata.st_size):
                    raise ValueError('Source object changed during staging')
                content = stream.read(MAX_SOURCE_BYTES - total + 1)
            total += len(content)
            if total > MAX_SOURCE_BYTES or len(content) != metadata.st_size:
                raise ValueError('Source object changed size')
            members.append(('source.git/objects/' + relative, content))

    try:
        root_fd = os.open('/', directory_flags)
        opened.append(root_fd)
        for component in (*source.parts[1:], '.git', 'objects'):
            root_fd = os.open(component, directory_flags, dir_fd=root_fd)
            opened.append(root_fd)
        walk(root_fd)
    finally:
        for descriptor in reversed(opened):
            os.close(descriptor)
    if not members:
        raise ValueError('Source has no independent Git object storage')
    commit_object = next((content for name, content in members if name == 'source.git/objects/' + commit_sha[:2] + '/' + commit_sha[2:]), None)
    if commit_object is None:
        raise ValueError('Source commit must have an independently verified loose object')
    decoder = zlib.decompressobj()
    decoded = decoder.decompress(commit_object, 1024 * 1024 + 1)
    if len(decoded) > 1024 * 1024 or not decoder.eof or decoder.unused_data or not decoded.startswith(b'commit '):
        raise ValueError('Invalid or oversized source commit object')
    if hashlib.sha1(decoded).hexdigest() != commit_sha:
        raise ValueError('Source commit object does not match requested SHA')
    header, body = decoded.split(b'\0', 1)
    if not re.fullmatch(rb'commit [0-9]+', header) or int(header.split(b' ')[1]) != len(body):
        raise ValueError('Source commit object size differs')
    tree = re.match(rb'tree ([a-f0-9]{40})\n', body)
    if tree is None:
        raise ValueError('Source commit has no exact tree identity')
    stored = {name.removeprefix('source.git/objects/').replace('/', ''): content for name, content in members
              if re.fullmatch(r'source.git/objects/[a-f0-9]{2}/[a-f0-9]{38}', name)}
    required = {commit_sha}
    expanded_bytes = 0

    def closure(object_sha: str, expected_type: bytes, depth: int = 0) -> None:
        nonlocal expanded_bytes
        if object_sha in required:
            return
        if depth > 64 or len(required) >= MAX_SOURCE_FILES or object_sha not in stored:
            raise ValueError('Requested tree closure is unavailable as bounded loose objects')
        decoder = zlib.decompressobj()
        raw = decoder.decompress(stored[object_sha], MAX_SOURCE_BYTES - expanded_bytes + 1)
        expanded_bytes += len(raw)
        if expanded_bytes > MAX_SOURCE_BYTES or not decoder.eof or decoder.unused_data or hashlib.sha1(raw).hexdigest() != object_sha:
            raise ValueError('Requested source object digest/size differs')
        object_header, object_body = raw.split(b'\0', 1)
        if object_header != expected_type + b' ' + str(len(object_body)).encode():
            raise ValueError('Requested source object type/size differs')
        required.add(object_sha)
        if expected_type == b'tree':
            offset = 0
            while offset < len(object_body):
                end = object_body.index(b'\0', offset)
                mode, name = object_body[offset:end].split(b' ', 1)
                name.decode('utf-8', errors='strict')
                child = object_body[end + 1:end + 21]
                if len(child) != 20 or name in (b'.', b'..', b'.git') or b'/' in name or not name:
                    raise ValueError('Requested tree has an unsupported path')
                if mode not in (b'40000', b'100644', b'100755', b'120000'):
                    raise ValueError('Requested source submodule or special mode is unsupported')
                closure(child.hex(), b'tree' if mode == b'40000' else b'blob', depth + 1)
                offset = end + 21

    closure(tree.group(1).decode(), b'tree')
    members = [(name, content) for name, content in members
               if name.removeprefix('source.git/objects/').replace('/', '') in required]
    total = sum(len(content) for _, content in members)
    members.extend([('source.git/HEAD', (commit_sha + '\n').encode()),
                    ('source.git/refs/heads/assigned', (commit_sha + '\n').encode()),
                    ('source.git/config', b'[core]\nrepositoryformatversion = 0\nbare = true\n')])
    output = io.BytesIO()
    with tarfile.open(fileobj=output, mode='w', format=tarfile.USTAR_FORMAT) as archive:
        for name, content in members:
            entry = tarfile.TarInfo(name)
            entry.mode = 0o600
            entry.size = len(content)
            archive.addfile(entry, io.BytesIO(content))
    archive_bytes = output.getvalue()
    if len(archive_bytes) > MAX_SOURCE_BYTES + MAX_SOURCE_FILES * 1024:
        raise ValueError('Source archive overhead exceeds bounds')
    return archive_bytes, {'commitSha': commit_sha, 'archiveHash': hashlib.sha256(archive_bytes).hexdigest(),
                           'files': len(members), 'objectBytes': total, 'interpretation': 'guest-only'}


def evidence_json(value: dict) -> str:
    return json.dumps(value, sort_keys=True, separators=(',', ':'))
