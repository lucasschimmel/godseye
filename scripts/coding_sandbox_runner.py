"""Host-side lifecycle of one gVisor task sandbox on the disposable work VM (profile 'work-vm').

The unprivileged service user prepares an immutable per-task bundle, starts it as a hard-capped transient
unit in its own systemd manager and brokers model traffic over stdio. Repository code only ever runs inside
the sandbox. The caller (coding_work_vm_control.py) supplies the authorization and attempt callbacks.
"""
import base64
from datetime import datetime
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import queue
import re
import shutil
import stat
import subprocess
import tarfile
import threading
import time

MAX_FRAME = 1048576
MAX_OUTPUT = 4 * MAX_FRAME
RUNSC = '/usr/bin/runsc'
RUN_ROOT = 'artifacts/work-vm/run'
CLI_ROOT = 'artifacts/work-vm/cli/bin'
GUEST_SCRIPTS = {'worker.mjs': 'coding_sandbox_worker.mjs', 'proxy.mjs': 'coding_sandbox_proxy.mjs',
                 'runner-config.mjs': 'coding_runner_config.mjs'}
SERVICE_SCRIPT = 'coding_sandbox_service.py'


def load(name: str, path: Path):
    specification = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(specification)
    specification.loader.exec_module(module)
    return module


policy = load('coding_sandbox_policy', Path(__file__).with_name('coding_sandbox_policy.py'))


def digest(content: bytes) -> str:
    return hashlib.sha256(content).hexdigest()


def atomic(path: Path, value: dict) -> None:
    temporary = path.with_name(path.name + '.pending-' + os.urandom(8).hex())
    descriptor = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    with os.fdopen(descriptor, 'w') as stream:
        json.dump(value, stream, sort_keys=True)
        stream.flush()
        os.fsync(stream.fileno())
    os.replace(temporary, path)


def run_directory(workspace: Path, task_id: str) -> Path:
    return workspace / RUN_ROOT / policy.task_identity(task_id)


def manager_environment() -> dict:
    return policy.user_environment(os.getuid())


def systemctl(*arguments: str) -> subprocess.CompletedProcess:
    return subprocess.run(['/usr/bin/systemctl', '--user', *arguments], env=manager_environment(),
                          capture_output=True, text=True, timeout=10)


def unit_properties(unit: str) -> dict:
    result = systemctl('show', unit, '--property=InvocationID', '--property=ActiveState', '--property=LoadState',
                       '--property=ControlGroup', '--property=Result')
    if result.returncode:
        raise ValueError('User service manager inspection unavailable')
    return dict(line.split('=', 1) for line in result.stdout.splitlines() if '=' in line)


def cgroup_empty(cgroup: str) -> bool:
    group = Path('/sys/fs/cgroup') / cgroup.lstrip('/')
    return not group.exists() or not (group / 'cgroup.procs').read_text().strip()


def stopped(value: dict) -> bool:
    """Physical stop proof: this exact invocation is inactive and its whole cgroup is empty."""
    unit = policy.unit_name(value['taskId'])
    if value.get('unit') != unit or value.get('cgroup') != policy.unit_cgroup(os.getuid(), unit):
        raise ValueError('Retained sandbox service identity changed')
    if not value.get('invocationId') or not re.fullmatch('[a-f0-9]{32}', value['invocationId']):
        return False
    if value['bootId'] != Path('/proc/sys/kernel/random/boot_id').read_text().strip():
        return False
    native = unit_properties(unit)
    if native.get('InvocationID') and native['InvocationID'] != value['invocationId']:
        return False
    return native.get('ActiveState') in ('inactive', 'failed') and cgroup_empty(value['cgroup'])


def delete_container(directory: Path, runsc_binary: str, container: str) -> None:
    """Remove gVisor's own bookkeeping for an already-stopped container; failure is not hidden."""
    command = ['/usr/bin/unshare', '--user', '--map-root-user', '--mount', '--net', '--fork', runsc_binary,
               '--root', str(directory / 'oci'), 'delete', '--force', container]
    subprocess.run(command, env={'PATH': '/usr/bin:/bin', 'LC_ALL': 'C'}, capture_output=True, timeout=15)


def release_sandbox_files(directory: Path) -> None:
    """Drop the bulky per-task inputs; state.json and logs stay as evidence."""
    for name in ('rootfs', 'coding', 'source.git', 'bundle', 'oci', 'task.json'):
        target = directory / name
        if target.is_dir() and not target.is_symlink():
            shutil.rmtree(target, ignore_errors=True)
        elif target.exists():
            target.unlink()


def _write_tree(destination: Path, source_archive: bytes) -> str:
    """Materialize the inert source object closure; only plain files under source.git/ are accepted."""
    names = []
    with tarfile.open(fileobj=io.BytesIO(source_archive), mode='r:') as archive:
        for member in archive.getmembers():
            parts = member.name.split('/')
            if not member.isfile() or parts[0] != 'source.git' or '..' in parts or '' in parts:
                raise ValueError('Invalid inert source archive entry')
            target = destination / member.name
            target.parent.mkdir(parents=True, exist_ok=True)
            data = archive.extractfile(member).read()
            target.write_bytes(data)
            target.chmod(0o644)
            names.append([member.name, digest(data)])
    for path in (destination / 'source.git').rglob('*'):
        if path.is_dir():
            path.chmod(0o755)
    return digest(json.dumps(sorted(names)).encode())


def _prepare_rootfs(directory: Path) -> Path:
    rootfs = directory / 'rootfs'
    for name in ('etc', 'proc', 'dev', 'tmp', 'home/runner', 'seed', 'workspace', 'verification', 'usr',
                 'opt/coding', 'coding', 'source.git'):
        (rootfs / name).mkdir(parents=True, exist_ok=True)
    for link, target in (('bin', 'usr/bin'), ('lib', 'usr/lib'), ('lib64', 'usr/lib64'), ('sbin', 'usr/sbin')):
        (rootfs / link).symlink_to(target)
    (rootfs / 'task.json').write_bytes(b'')
    (rootfs / 'etc/passwd').write_text('root:x:0:0:root:/:/bin/sh\nrunner:x:1000:1000:runner:/home/runner:/bin/sh\n')
    (rootfs / 'etc/group').write_text('root:x:0:\nrunner:x:1000:\n')
    return rootfs


def prepare(workspace: Path, task_id: str, task: dict, source_archive: bytes | None, runsc_sha: str) -> dict:
    """Create the immutable bundle. Replay is refused: a task directory exists at most once."""
    directory = run_directory(workspace, task_id)
    if directory.exists():
        raise ValueError('Native allocation exists; inspect instead of replaying')
    if os.getuid() == 0 or task['runner'] not in ('codex', 'claude-code'):
        raise ValueError('Invalid sandbox task identity or host user')
    directory.mkdir(parents=True, mode=0o700)
    (directory / 'coding').mkdir(mode=0o755)
    scripts = {}
    sources = dict(GUEST_SCRIPTS)
    if task.get('labCase'):
        sources['adversary.mjs'] = 'coding_sandbox_adversary.mjs'
    for name, source in sources.items():
        content = (workspace / 'scripts' / source).read_bytes()
        (directory / 'coding' / name).write_bytes(content)
        (directory / 'coding' / name).chmod(0o444)
        scripts[name] = digest(content)
    task_bytes = json.dumps(task, sort_keys=True).encode()
    (directory / 'task.json').write_bytes(task_bytes)
    source_hash = _write_tree(directory, source_archive) if source_archive else None
    if source_archive is None:
        (directory / 'source.git').mkdir(mode=0o755)
    rootfs = _prepare_rootfs(directory)
    binds = {'/usr': '/usr', '/opt/coding': str(workspace / CLI_ROOT), '/coding': str(directory / 'coding'),
             '/task.json': str(directory / 'task.json'), '/source.git': str(directory / 'source.git')}
    config = policy.oci_config(str(rootfs), binds, task_id)
    policy.validate_oci(config, binds)
    (directory / 'bundle').mkdir(mode=0o700)
    (directory / 'oci').mkdir(mode=0o700)
    config_bytes = json.dumps(config, sort_keys=True).encode()
    (directory / 'bundle/config.json').write_bytes(config_bytes)
    image_hash = digest(json.dumps({'scripts': scripts, 'task': digest(task_bytes), 'config': digest(config_bytes),
                                    'source': source_hash, 'runsc': runsc_sha}, sort_keys=True).encode())
    receipt = {'taskId': task_id, 'runner': task['runner'], 'imageHash': image_hash, 'scripts': scripts}
    atomic(directory / 'image.json', receipt)
    return receipt


def _launch(workspace: Path, directory: Path, task_id: str, image_hash: str, runsc_sha: str, seconds: int):
    unit = policy.unit_name(task_id)
    command = ['/usr/bin/systemd-run', '--user', '--pipe', '--wait', '--collect',
               *policy.unit_properties(unit, seconds), '/usr/bin/python3', '-I', '-B',
               str(workspace / 'scripts' / SERVICE_SCRIPT), runsc_sha, RUNSC, str(directory), image_hash,
               policy.container_id(task_id)]
    return subprocess.Popen(command, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                            env=manager_environment())


def _pump(stream, sink: queue.Queue, limit: int, tag: str) -> None:
    total = 0
    for raw in iter(lambda: stream.readline(MAX_FRAME * 2 + 64), b''):
        total += len(raw)
        sink.put((tag, raw if total <= limit else None))
        if total > limit:
            return
    sink.put((tag, b''))


def _frame(line: bytes, last_id: int) -> dict:
    frame = json.loads(line)
    if set(frame) != {'id', 'method', 'path', 'headers', 'body'} or frame['id'] != last_id + 1 or frame['id'] > 16:
        raise ValueError('Sandbox broker frame identity differs')
    return frame


def unit_result(lines: list[str]) -> str | None:
    """The service result systemd-run reports when the transient unit ends (e.g. success, oom-kill, timeout)."""
    for line in reversed(lines):
        found = re.fullmatch(r'STDERR Finished with result: ([a-z-]+)', line.strip())
        if found:
            return found.group(1)
    return None


def adversary_markers(lines: list[str]) -> list:
    """Structured and plain regression markers reported by the sandbox, in order."""
    markers: list = []
    for line in lines:
        if line.startswith('GODSEYE_ADVERSARY '):
            text = line.split(' ', 1)[1].strip()
            try:
                markers.append(json.loads(text))
            except ValueError:
                markers.append(text)
    return markers


def _collect_result(lines: list[str]) -> tuple[dict, list]:
    matches = [line.split(' ', 1)[1].strip() for line in lines if line.startswith('GODSEYE_RESULT ')]
    if len(matches) != 1:
        raise ValueError('Sandbox produced no unique bounded result')
    return json.loads(base64.b64decode(matches[0], validate=True)), adversary_markers(lines)


def supervise(process, directory: Path, handle, authorize, deadline: float, out_lines: list[str]) -> None:
    """Pump sandbox stdio until it exits; serve broker frames; enforce deadline, output bound and revocation."""
    sink: queue.Queue = queue.Queue()
    for stream, tag in ((process.stdout, 'out'), (process.stderr, 'err')):
        threading.Thread(target=_pump, args=(stream, sink, MAX_OUTPUT, tag), daemon=True).start()
    last_id = 0
    open_streams = 2
    while open_streams or process.poll() is None:
        if time.time() >= deadline or (directory / 'revoked').exists():
            raise ValueError('Native task deadline or revocation')
        try:
            tag, raw = sink.get(timeout=0.1)
        except queue.Empty:
            continue
        if raw is None:
            raise ValueError('Native output bound exceeded')
        if raw == b'':
            open_streams -= 1
            continue
        text = raw.decode(errors='replace').rstrip('\r\n')
        if tag == 'err':
            out_lines.append('STDERR ' + text[:512])
            continue
        if not text.startswith('GODSEYE_BROKER '):
            out_lines.append(text)
            continue
        frame = _frame(text.split(' ', 1)[1].encode(), last_id)
        last_id = frame['id']
        atomic(directory / 'broker-observation.json', {'requestCount': last_id, 'route': frame['path']})
        response = handle({**frame, 'body': base64.b64decode(frame['body'], validate=True).decode()})
        authorize()
        wire = json.dumps({**response, 'id': frame['id']}).encode() + b'\n'
        if len(wire) > MAX_FRAME:
            raise ValueError('Broker response exceeds frame bound')
        process.stdin.write(wire)
        process.stdin.flush()


def sample_peaks(cgroup: str, peaks: dict, finished: threading.Event) -> None:
    """Record the highest observed task count and memory of the exact unit cgroup (ceiling evidence)."""
    group = Path('/sys/fs/cgroup') / cgroup.lstrip('/')
    while not finished.is_set():
        for name, key in (('pids.current', 'pids'), ('memory.current', 'memoryBytes')):
            try:
                peaks[key] = max(peaks.get(key, 0), int((group / name).read_text()))
            except (OSError, ValueError):
                pass
        finished.wait(0.2)


def unit_identity(directory: Path, value: dict, task_id: str, process, authorize) -> None:
    """Capture the exact service invocation receipt before the sandbox is released."""
    unit = policy.unit_name(task_id)
    for _ in range(400):
        native = unit_properties(unit)
        if native.get('InvocationID'):
            value['invocationId'] = native['InvocationID']
            atomic(directory / 'state.json', value)
            authorize()
            atomic(directory / 'release', {'imageHash': value['imageHash'], 'invocationId': value['invocationId']})
            return
        if process.poll() is not None:
            raise ValueError('Sandbox service failed before invocation receipt')
        time.sleep(0.05)
    raise ValueError('Sandbox invocation receipt unavailable')


def finalize(directory: Path, value: dict, runsc_binary: str) -> dict:
    """Stop the exact invocation if still alive, delete gVisor state, prove emptiness, then drop inputs."""
    unit = policy.unit_name(value['taskId'])
    native = unit_properties(unit)
    if value.get('invocationId') and native.get('InvocationID') == value['invocationId'] and native.get('ActiveState') not in ('inactive', 'failed'):
        systemctl('stop', unit)
    for _ in range(100):
        if stopped(value):
            break
        time.sleep(0.1)
    value['stopped'] = stopped(value)
    if value['stopped']:
        delete_container(directory, runsc_binary, policy.container_id(value['taskId']))
        release_sandbox_files(directory)
    value['grantsRevoked'] = True
    value['workspace'] = 'retained' if value['stopped'] else 'quarantined'
    if not value['stopped']:
        value['state'] = 'unknown'
    elif value['state'] == 'unknown':
        value['state'] = 'failed'
    return value


def deadline_for(request: dict, document: dict) -> float:
    base = time.time() + (document.get('labDeadlineSeconds') or policy.LIMITS['runtimeSeconds'] - 5)
    requested = datetime.fromisoformat(request['deadline'].replace('Z', '+00:00')).timestamp()
    return min(base, requested)
