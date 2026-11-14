"""Trusted typed scratch-file worker. This file executes only inside the disposable sandbox."""
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import sys

NAMES = ('godseye_workspace_list', 'godseye_workspace_read', 'godseye_workspace_write',
         'godseye_workspace_search', 'godseye_json_validate')
SENSITIVE = re.compile(r'secret|credential|password|token|api_key', re.I)
root = Path('/workspace')
policy = None
written = read = output = calls = 0


def logical(value: str, directory: bool = False) -> Path:
    if directory and value == '.':
        return root
    parts = value.split('/') if isinstance(value, str) else []
    if (not parts or len(value) > 160 or len(parts) > 8 or parts[0] not in ('scratch', 'artifacts')
            or (not directory and len(parts) < 2)
            or any(not re.fullmatch(r'[A-Za-z0-9._-]+', part) or part in ('.', '..')
                   or part.startswith('.env') or SENSITIVE.search(part) for part in parts)):
        raise ValueError('Workspace path refused')
    current = root
    for part in parts:
        current = current / part
        if current.exists() or current.is_symlink():
            info = current.lstat()
            if stat.S_ISLNK(info.st_mode) or (not stat.S_ISDIR(info.st_mode) and
                    (not stat.S_ISREG(info.st_mode) or info.st_nlink != 1)):
                raise ValueError('Workspace special file refused')
    return current


def files() -> list[Path]:
    result = []
    for directory, subdirs, names in os.walk(root, followlinks=False):
        if len(subdirs) + len(names) > 64:
            raise ValueError('Workspace directory bound exceeded')
        for name in subdirs + names:
            path = Path(directory, name)
            logical(path.relative_to(root).as_posix(), directory=True)
        result.extend(Path(directory, name) for name in names)
        if len(result) > 8:
            raise ValueError('Workspace file count exceeded')
    return sorted(result)


def text(path: Path) -> str:
    global read
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    with os.fdopen(fd, 'rb') as stream:
        info = os.fstat(stream.fileno())
        if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1 or info.st_size > 16384:
            raise ValueError('Workspace file refused')
        data = stream.read(16385)
    if read + len(data) > policy['maxReadBytes']:
        raise ValueError('Workspace read budget exhausted')
    read += len(data)
    return data.decode('utf-8', errors='strict')


def write(path: Path, content: str) -> None:
    global written
    data = content.encode('utf-8', errors='strict')
    known = files()
    live = sum(item.stat().st_size for item in known)
    old = path.stat().st_size if path.exists() else 0
    if (len(data) > 16384 or written + len(data) > policy['maxWriteBytes']
            or live - old + len(data) > policy['maxWorkspaceBytes']
            or (not path.exists() and len(known) >= 8)):
        raise ValueError('Workspace write budget exhausted')
    path.parent.mkdir(parents=True, exist_ok=True)
    # Only this trusted single-thread worker can mutate the tmpfs. Task bytes never
    # execute and no host mount or other writer exists, so checked parent components
    # cannot be replaced between validation and this no-follow atomic publication.
    temporary = path.parent / '.godseye-write'
    fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    try:
        with os.fdopen(fd, 'wb') as stream:
            stream.write(data)
        os.replace(temporary, path)
    finally:
        if temporary.exists():
            temporary.unlink()
    written += len(data)


def bounded_json(value: object, depth: int = 0) -> None:
    if depth > 16:
        raise ValueError('JSON depth exceeded')
    if isinstance(value, dict):
        for item in value.values():
            bounded_json(item, depth + 1)
    elif isinstance(value, list):
        for item in value:
            bounded_json(item, depth + 1)


def execute(name: str, arguments: dict) -> object:
    global calls
    expected = {'godseye_workspace_list': {'path'}, 'godseye_workspace_read': {'path'},
                'godseye_workspace_write': {'path', 'content'},
                'godseye_workspace_search': {'path', 'text'}, 'godseye_json_validate': {'content'}}
    if (name not in policy['tools'] or name not in expected or set(arguments) != expected[name]
            or any(not isinstance(value, str) or len(value.encode()) > 16384 for value in arguments.values())
            or calls >= policy['maxCalls']):
        raise ValueError('Tool call refused')
    calls += 1
    if name == 'godseye_json_validate':
        parsed = json.loads(arguments['content'], parse_constant=lambda _: (_ for _ in ()).throw(ValueError('Nonfinite JSON')))
        bounded_json(parsed)
        return {'valid': True, 'normalized': json.dumps(parsed, ensure_ascii=False, separators=(',', ':'), allow_nan=False)}
    path = logical(arguments['path'], directory=name.endswith(('_list', '_search')))
    if name.endswith('_write'):
        write(path, arguments['content'])
        return {'path': arguments['path'], 'bytes': len(arguments['content'].encode())}
    if name.endswith('_read'):
        return {'path': arguments['path'], 'content': text(path)}
    if name.endswith('_list'):
        entries = sorted(path.iterdir())
        if len(entries) > 64:
            raise ValueError('Workspace directory bound exceeded')
        return {'entries': [{'path': item.relative_to(root).as_posix(), 'kind': 'directory' if item.is_dir() else 'file'}
                            for item in entries if logical(item.relative_to(root).as_posix(), directory=True)]}
    needle = arguments['text']
    if not needle:
        raise ValueError('Empty search refused')
    candidates = [item for item in files() if item == path or path in item.parents]
    return {'matches': [{'path': item.relative_to(root).as_posix(), 'line': index, 'text': line}
                        for item in candidates for index, line in enumerate(text(item).splitlines(), 1) if needle in line]}


def artifacts() -> list[dict]:
    result = []
    for path in files():
        if path.is_relative_to(root / 'artifacts'):
            data = path.read_bytes()
            if len(data) > 16384:
                raise ValueError('Artifact bound exceeded')
            result.append({'path': path.relative_to(root).as_posix(), 'contentUtf8': data.decode('utf-8'),
                           'sha256': hashlib.sha256(data).hexdigest(), 'bytes': len(data)})
    return result


def main() -> None:
    global policy, output
    manifest = json.loads(sys.stdin.buffer.readline(131073))
    policy = manifest['policy']
    if os.getuid() != 1000 or not Path('/proc/gvisor/kernel_is_gvisor').exists():
        raise RuntimeError('Worker is not an admitted nonroot gVisor sandbox')
    (root / 'scratch').mkdir()
    (root / 'artifacts').mkdir()
    for item in manifest['workspace']['files']:
        write(logical(item['path']), item['content'])
    print(json.dumps({'kind': 'ready', 'nonRoot': True, 'gvisor': True}), flush=True)
    for raw in sys.stdin.buffer:
        if len(raw) > 131072:
            raise ValueError('Worker frame exceeded')
        message = json.loads(raw)
        before_read, before_written = read, written
        try:
            value = execute(message['name'], message['arguments'])
            result = json.dumps(value, ensure_ascii=False, separators=(',', ':'))
            exported = artifacts()
            size = len(result.encode()) + sum(item['bytes'] for item in exported)
            if output + size > policy['maxOutputBytes']:
                raise ValueError('Tool output budget exhausted')
            output += size
            response = {'state': 'succeeded', 'result': result, 'artifacts': exported}
        except (ValueError, OSError, UnicodeError, RecursionError, TypeError):
            response = {'state': 'failed', 'result': '{"error":"Bounded tool operation refused"}', 'artifacts': []}
        usage = {'readBytes': read - before_read, 'writeBytes': written - before_written,
                 'workspaceBytes': sum(item.stat().st_size for item in files())}
        print(json.dumps({'kind': 'result', 'callId': message['callId'], **response, 'usage': usage}), flush=True)


if __name__ == '__main__':
    main()
