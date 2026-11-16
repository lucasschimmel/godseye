"""Private exact-task runtime owner; task/model inputs can never select host authority."""
from datetime import datetime
import hashlib
import json
import os
from pathlib import Path
import queue
import re
import select
import subprocess
import sys
import threading
import time
import uuid
from hermes_service_identity import SANDBOX_UID, environment, runtime_directory, service_uid, user_manager_cgroup
from hermes_files import document, private_directory, read_json, replace_json, runtime_root
from hermes_tools_install import verify, location
from hermes_tools_policy import validate

UID = service_uid()
ENVIRONMENT = environment(UID)


def send(value: dict) -> None:
    print(json.dumps(value), flush=True)


def systemctl(*arguments: str) -> subprocess.CompletedProcess:
    return subprocess.run(['systemctl', '--user', *arguments], env=ENVIRONMENT,
                          capture_output=True, text=True, timeout=5)


def target(workspace: Path, request: dict) -> tuple[Path, str]:
    for name in ('taskId', 'projectId', 'environmentId'):
        if str(uuid.UUID(request[name])) != request[name]:
            raise ValueError('Invalid task identity')
    if request['correlationId'] != request['taskId']:
        raise ValueError('Invalid task correlation')
    for name in ('profileHash', 'policyHash'):
        if not re.fullmatch('[a-f0-9]{64}', request[name]):
            raise ValueError('Invalid task digest')
    return runtime_root(workspace) / 'tool-runs' / request['taskId'], 'godseye-tools-' + request['taskId'] + '.service'


def retained(workspace: Path, request: dict) -> tuple[Path, dict]:
    directory, unit = target(workspace, request)
    value = read_json(directory / 'state.json')
    if value['requestHash'] != hashlib.sha256(document(request)).hexdigest() or value['unit'] != unit:
        raise ValueError('Retained allocation identity differs')
    installed, _ = location(workspace)
    container = 'gse-tools-' + request['taskId']
    if value.get('ociId') != container or value.get('runsc') != str(installed / 'payload/runsc'):
        raise ValueError('Retained native executable identity differs')
    if value.get('cgroup') and value['cgroup'] != user_manager_cgroup(UID) + '/app.slice/' + unit:
        raise ValueError('Retained cgroup identity differs')
    receipt = value.get('receipt')
    if receipt is not None and (receipt.get('ociId') != container or receipt.get('profileHash') != request['profileHash']
                               or not re.fullmatch('[a-f0-9]{32}', receipt.get('unitInvocationId', ''))):
        raise ValueError('Retained native receipt differs')
    return directory, value


def properties(unit: str) -> dict:
    result = systemctl('show', unit, '--property=InvocationID', '--property=ActiveState', '--property=ControlGroup')
    if result.returncode:
        raise ValueError('User manager unavailable')
    return dict(line.split('=', 1) for line in result.stdout.splitlines() if '=' in line)


def observation(value: dict) -> dict:
    return {'state': value['state'], 'receipt': value.get('receipt'), 'stopped': value['stopped']}


def stop_owned(workspace: Path, request: dict) -> dict:
    possible, unit = target(workspace, request)
    if not possible.exists():
        native = properties(unit)
        stopped = native.get('ActiveState') == 'inactive' and not native.get('InvocationID')
        return {'state': 'stopped' if stopped else 'unknown', 'receipt': None, 'stopped': stopped}
    directory, value = retained(workspace, request)
    if value['stopped']:
        return observation(value)
    if value.get('launchIntent') is False:
        value.update({'state': 'stopped', 'stopped': True})
        replace_json(directory / 'state.json', value)
        return observation(value)
    if value['bootId'] != Path('/proc/sys/kernel/random/boot_id').read_text().strip():
        return {'state': 'unknown', 'receipt': value.get('receipt'), 'stopped': False}
    native = properties(value['unit'])
    receipt = value.get('receipt')
    if native.get('InvocationID') and (receipt is None or native['InvocationID'] != receipt['unitInvocationId']):
        return {'state': 'unknown', 'receipt': receipt, 'stopped': False}
    if native.get('ActiveState') not in ('inactive', 'failed'):
        if not receipt or systemctl('stop', value['unit']).returncode:
            return {'state': 'unknown', 'receipt': receipt, 'stopped': False}
    native = properties(value['unit'])
    group = Path('/sys/fs/cgroup') / value.get('cgroup', '').lstrip('/')
    empty = bool(value.get('cgroup')) and (not group.exists() or not (group / 'cgroup.procs').read_text().strip())
    if native.get('ActiveState') not in ('inactive', 'failed') or not empty:
        return {'state': 'unknown', 'receipt': receipt, 'stopped': False}
    # Whole exact unit is empty before native OCI metadata deletion. No stale PID is
    # consulted and a changed invocation is never stopped or adopted.
    command = ['/usr/bin/unshare', '--user', '--map-root-user', '--mount', '--net', '--fork',
               value['runsc'], '--root', str(directory / 'oci'), 'delete', '--force', value['ociId']]
    result = subprocess.run(command, env=ENVIRONMENT, capture_output=True, timeout=5)
    if result.returncode and (directory / 'oci' / value['ociId']).exists():
        return {'state': 'unknown', 'receipt': receipt, 'stopped': False}
    value.update({'state': 'stopped', 'stopped': True})
    replace_json(directory / 'state.json', value)
    return observation(value)


def configuration(rootfs: Path) -> dict:
    return {'ociVersion': '1.2.0', 'root': {'path': str(rootfs), 'readonly': True},
            'hostname': 'godseye-task', 'process': {'terminal': False, 'user': {'uid': SANDBOX_UID, 'gid': SANDBOX_UID},
            'args': ['/python/bin/python3.14', '-I', '-S', '-B', '/worker.py'],
            'env': ['PATH=/python/bin', 'LC_ALL=C.UTF-8', 'PYTHONDONTWRITEBYTECODE=1'], 'cwd': '/',
            'noNewPrivileges': True, 'capabilities': {name: [] for name in ('bounding', 'effective', 'inheritable', 'permitted', 'ambient')},
            'rlimits': [{'type': 'RLIMIT_NOFILE', 'hard': 64, 'soft': 64}]},
            'mounts': [{'destination': '/proc', 'type': 'proc', 'source': 'proc'},
                       {'destination': '/dev', 'type': 'tmpfs', 'source': 'tmpfs', 'options': ['nosuid', 'noexec', 'size=1m', 'mode=755']},
                       {'destination': '/tmp', 'type': 'tmpfs', 'source': 'tmpfs', 'options': ['nosuid', 'nodev', 'noexec', 'size=1m', 'mode=1777']},
                       {'destination': '/workspace', 'type': 'tmpfs', 'source': 'tmpfs', 'options': ['nosuid', 'nodev', 'noexec', 'size=4m', 'mode=777']}],
            'linux': {'namespaces': [{'type': name} for name in ('pid', 'ipc', 'uts', 'mount', 'network')], 'resources': {}}}


def launch(workspace: Path, request: dict) -> None:
    """Keep unit creation, live stdin capability and final stop in one lexical owner.

    This orchestration exceeds the normal helper length to avoid dividing exact
    process ownership and cleanup across independent mutable controller objects.
    """
    directory, unit = target(workspace, request)
    if directory.exists():
        _, value = retained(workspace, request)
        send({'kind': 'allocation', 'observation': observation(value) if value['stopped'] else
              {'state': 'unknown', 'receipt': value.get('receipt'), 'stopped': False}})
        return
    try:
        installed = verify(workspace)
        if not Path(runtime_directory(UID) + '/bus').is_socket():
            raise ValueError('Explicit operator tools bootstrap is unavailable')
    except (OSError, ValueError, RuntimeError):
        # Exact new task directory does not yet exist, no unit/OCI start was
        # attempted and no positive authority was requested. This is known
        # never-started failure, rather than an uncertain post-intent effect.
        send({'kind': 'allocation', 'observation': {'state': 'stopped', 'receipt': None, 'stopped': True}})
        return
    deadline = min(datetime.fromisoformat(request['deadline'].replace('Z', '+00:00')).timestamp(),
                   time.time() + request['grant']['policy']['timeoutSeconds'])
    private_directory(directory)
    private_directory(directory / 'bundle')
    replace_json(directory / 'bundle/config.json', configuration(installed / 'payload/rootfs'))
    container = 'gse-tools-' + request['taskId']
    value = {'requestHash': hashlib.sha256(document(request)).hexdigest(), 'unit': unit, 'ociId': container,
             'runsc': str(installed / 'payload/runsc'), 'bootId': Path('/proc/sys/kernel/random/boot_id').read_text().strip(),
             'state': 'unknown', 'stopped': False, 'receipt': None, 'cgroup': '', 'calls': {}, 'launchIntent': False}
    replace_json(directory / 'state.json', value)
    send({'kind': 'authorize'})
    if json.loads(sys.stdin.buffer.readline(4097)) != {'kind': 'authorization', 'allowed': True} or time.time() >= deadline:
        value.update({'state': 'stopped', 'stopped': True})
        replace_json(directory / 'state.json', value)
        send({'kind': 'allocation', 'observation': observation(value)})
        return
    arguments = ['systemd-run', '--user', '--wait', '--pipe', '--unit=' + unit, '--property=MemoryMax=512M',
                 '--property=MemorySwapMax=0', '--property=CPUQuota=50%', '--property=TasksMax=128',
                 '--property=RuntimeMaxSec=' + str(max(1, int(deadline - time.time()))), '--property=KillMode=control-group',
                 '/usr/bin/python3', '-I', '-B', str(workspace / 'scripts/hermes_tools_service.py'),
                 value['runsc'], str(directory / 'oci'), str(directory / 'bundle'), container]
    value['launchIntent'] = True
    replace_json(directory / 'state.json', value)
    child = subprocess.Popen(arguments, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, env=ENVIRONMENT)
    guard_finished = threading.Event()

    def eof_guard() -> None:
        monitor = select.poll()
        monitor.register(sys.stdin.fileno(), select.POLLHUP | select.POLLERR)
        while not guard_finished.is_set():
            events = monitor.poll(100)
            if not events:
                continue
            while not guard_finished.is_set() and not value.get('receipt'):
                guard_finished.wait(.025)
            if not guard_finished.is_set():
                try:
                    native = properties(unit)
                    if native.get('InvocationID') == value['receipt']['unitInvocationId']:
                        systemctl('stop', unit)
                except (OSError, ValueError, subprocess.TimeoutExpired):
                    pass  # Main lexical owner still records unknown unless final physical stop proves.
            return

    threading.Thread(target=eof_guard, daemon=True).start()
    threading.Thread(target=lambda: child.stderr.read(65536), daemon=True).start()
    lines = queue.Queue(maxsize=2)

    def reader() -> None:
        try:
            while True:
                raw = child.stdout.readline(131073)
                if not raw or len(raw) > 131072:
                    break
                lines.put(json.loads(raw), timeout=1)
        finally:
            try:
                lines.put(None, timeout=1)
            except queue.Full:
                pass

    threading.Thread(target=reader, daemon=True).start()
    try:
        # Capture exact unit identity before any worker manifest/call is admitted.
        while time.time() < deadline:
            native = properties(unit)
            if native.get('InvocationID') and native.get('ControlGroup'):
                value['receipt'] = {'unitInvocationId': native['InvocationID'], 'ociId': container, 'profileHash': request['profileHash']}
                value['cgroup'] = native['ControlGroup']
                replace_json(directory / 'state.json', value)
                break
            time.sleep(.025)
        if not value['receipt']:
            raise ValueError('Missing native allocation identity')
        child.stdin.write(json.dumps({'policy': request['grant']['policy'], 'workspace': request['grant']['workspace']}).encode() + b'\n')
        child.stdin.flush()
        ready = lines.get(timeout=max(.1, deadline - time.time()))
        if ready != {'kind': 'ready', 'nonRoot': True, 'gvisor': True}:
            raise ValueError('Actual sandbox worker did not qualify')
        value['state'] = 'available'
        replace_json(directory / 'state.json', value)
        send({'kind': 'allocation', 'observation': observation(value)})
        while time.time() < deadline:
            if not select.select([sys.stdin.buffer], [], [], max(0, deadline - time.time()))[0]:
                break
            raw = sys.stdin.buffer.readline(131073)
            if not raw or len(raw) > 131072:
                break
            message = json.loads(raw)
            if message == {'kind': 'stop'}:
                break
            if message.get('kind') != 'execute':
                raise ValueError('Invalid runtime command')
            call = message['request']
            if call['allocation'] != request or call['callId'] in value['calls']:
                raise ValueError('Repeated or changed execution refused')
            value['calls'][call['callId']] = call['inputHash']
            replace_json(directory / 'state.json', value)
            child.stdin.write(json.dumps({'callId': call['callId'], 'name': call['name'], 'arguments': call['arguments']}).encode() + b'\n')
            child.stdin.flush()
            result = lines.get(timeout=max(.1, deadline - time.time()))
            if not result or result.pop('kind', None) != 'result' or result.pop('callId', None) != call['callId']:
                raise ValueError('Sandbox response correlation differs')
            send({'kind': 'result', 'callId': call['callId'], 'observation': {**result, 'receipt': value['receipt']}})
    finally:
        guard_finished.set()
        child.stdin.close()
        stopped = stop_owned(workspace, request)
        try:
            child.wait(timeout=5)
        except subprocess.TimeoutExpired:
            stopped = {'state': 'unknown', 'receipt': value.get('receipt'), 'stopped': False}
        send({'kind': 'allocation', 'observation': stopped})


def main() -> None:
    os.umask(0o077)
    payload = json.loads(sys.stdin.buffer.readline(262145))
    workspace = Path(payload['workspace'])
    if os.getuid() != UID or workspace.resolve(strict=True) != workspace:
        raise ValueError('Invalid native runtime owner')
    request = payload['request']
    validate(request['grant'])
    if payload['action'] == 'start':
        launch(workspace, request)
    elif payload['action'] == 'stop':
        send({'kind': 'allocation', 'observation': stop_owned(workspace, request)})
    elif payload['action'] == 'inspect':
        _, value = retained(workspace, request)
        # A retained available state is not a live admission; read-only inspection
        # reports uncertainty unless final cleanup is durably proved.
        send({'kind': 'allocation', 'observation': observation(value) if value['stopped'] else
              {'state': 'unknown', 'receipt': value.get('receipt'), 'stopped': False}})
    else:
        raise ValueError('Invalid native runtime action')


if __name__ == '__main__':
    try:
        main()
    except Exception:
        send({'kind': 'allocation', 'observation': {'state': 'unknown', 'receipt': None, 'stopped': False}})
        sys.exit(1)
