"""Private bounded KVM lifecycle bridge. Repository code is never executed on the host."""
import base64
from datetime import datetime, timedelta, timezone
import hashlib
import grp
import importlib.util
import json
import os
from pathlib import Path
import re
import select
import socket
import stat
import subprocess
import sys
import threading
import time
import uuid

MAX_FRAME = 1048576
MAX_OUTPUT = 4 * MAX_FRAME
RESOURCES = {'memoryMiB': 4096, 'cpuMilliCores': 1000, 'maxProcesses': 64, 'diskMiB': 4096}
RUNTIME_SOURCES = ('coding_guest_worker.mjs', 'coding_guest_proxy.mjs', 'coding_guest_drop.mjs',
                   'coding_guest_task.py', 'coding_guest_lab.py', 'coding_guest_source.py',
                   'model_attempt_evidence.py', 'coding_guest_control.py', 'coding_guest_broker.py', 'coding_guest_install.py',
                   'coding_cli_install.py', 'coding_cli_fixture.py', 'coding_guest_qualify.py', 'coding_runner_config.mjs')
KVM_PROBE = ('import os,fcntl,json; '
             'assert os.getuid()==1000 and os.geteuid()==1000; '
             'fd=os.open("/dev/kvm",os.O_RDWR); api=fcntl.ioctl(fd,0xae00,0); '
             'assert api==12; vm=fcntl.ioctl(fd,0xae01,0); os.close(vm); os.close(fd); '
             'print(json.dumps({"uid":1000,"api":12,"created":True}))')


# Selected only by the SSH transport (work-VM Debian profile). The WSL2 KVM profile is the default.
WORK_VM = os.environ.get('GODSEYE_CODING_PROFILE') == 'work-vm'


def load(name: str, path: Path):
    specification = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(specification)
    specification.loader.exec_module(module)
    return module


def digest(content: bytes) -> str:
    return hashlib.sha256(content).hexdigest()


def source_hashes(workspace: Path) -> dict:
    return {name: digest((workspace / 'scripts' / name).read_bytes()) for name in RUNTIME_SOURCES}


def host_profile() -> dict:
    """Stable local software/hardware policy identity, deliberately excluding boot UUID."""
    device = os.stat('/dev/kvm')
    if not stat.S_ISCHR(device.st_mode) or device.st_gid == 0 or grp.getgrgid(device.st_gid).gr_name != 'kvm':
        raise ValueError('Local KVM device authority differs from the qualified policy')
    controllers = sorted(Path('/sys/fs/cgroup/cgroup.controllers').read_text().split())
    if not {'cpu', 'memory', 'pids'}.issubset(controllers):
        raise ValueError('Required unified cgroup controllers are unavailable')
    system = os.uname()
    if system.machine != 'x86_64' or 'microsoft-standard-WSL2' not in system.release:
        raise ValueError('This local qualification applies only to the observed x86_64 WSL2 host')
    return {'version': 'local-coding-host-v1', 'kernel': system.release, 'architecture': system.machine,
            'machineHash': digest(Path('/etc/machine-id').read_bytes()),
            'kvm': {'major': os.major(device.st_rdev), 'minor': os.minor(device.st_rdev), 'group': device.st_gid},
            'controllers': controllers, 'policy': {'guestMemoryMiB': 4096, 'vmmMemoryMiB': 5120,
                                                  'cpuMilliCores': 1000, 'outerPids': 64, 'guestPids': 64}}


def qualification_host_matches(proof: dict, current: dict) -> bool:
    return proof.get('hostProfile') == current


def probe_current_kvm() -> None:
    profile = host_profile()
    command = ['/mnt/c/Windows/System32/wsl.exe', '-d', 'Ubuntu', '-u', 'root', '--', '/usr/bin/setpriv',
               '--reuid=1000', '--regid=1000', '--groups=' + str(profile['kvm']['group']), '--no-new-privs', '--',
               '/usr/bin/env', '-i', 'PATH=/usr/bin:/bin', 'LC_ALL=C', '/usr/bin/python3', '-I', '-c', KVM_PROBE]
    result = subprocess.run(command, env={'PATH': '/usr/bin:/bin', 'LC_ALL': 'C', 'WSL_INTEROP': os.environ.get('WSL_INTEROP', '')},
                            capture_output=True, text=True, timeout=5)
    if result.returncode or json.loads(result.stdout) != {'uid': 1000, 'api': 12, 'created': True}:
        raise ValueError('Current local KVM access could not be qualified')


def atomic(path: Path, value: dict) -> None:
    temporary = path.with_name(path.name + '.pending-' + uuid.uuid4().hex)
    descriptor = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    with os.fdopen(descriptor, 'w') as stream:
        json.dump(value, stream, sort_keys=True)
        stream.flush()
        os.fsync(stream.fileno())
    os.replace(temporary, path)
    directory = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        os.fsync(directory)
    finally:
        os.close(directory)


def properties(unit: str) -> dict:
    result = subprocess.run(['/usr/bin/systemctl', 'show', unit, '--property=InvocationID', '--property=ActiveState',
                             '--property=LoadState', '--property=ControlGroup'], env={'PATH': '/usr/bin:/bin', 'LC_ALL': 'C'},
                            capture_output=True, text=True, timeout=5)
    if result.returncode:
        raise ValueError('System service inspection unavailable')
    return dict(line.split('=', 1) for line in result.stdout.splitlines() if '=' in line)


def identity(request: dict) -> str:
    task_id = request['taskId']
    if str(uuid.UUID(task_id)) != task_id or str(uuid.UUID(request['correlationId'])) != request['correlationId']:
        raise ValueError('Invalid exact native task identity')
    return task_id


def source(workspace: Path, document: dict) -> tuple[bytes, dict]:
    preparation = document['request']['preparation']
    binding = document['binding']
    if binding['repositoryHash'] != preparation['repositoryHash']:
        raise ValueError('Private repository binding differs')
    module = load('coding_guest_source', workspace / 'scripts/coding_guest_source.py')
    archive, evidence = module.snapshot(Path(binding['sourceDirectory']), preparation['commitSha'])
    return archive, {**evidence, 'repositoryHash': binding['repositoryHash']}


def receipt(workspace: Path, preparation: dict) -> dict:
    cache = workspace / 'artifacts/tools/coding-kvm/10.2.1'
    native = json.loads((cache / 'provenance.json').read_text())
    if not native.get('files'):
        raise ValueError('Native runtime is not recursively sealed')
    cli = json.loads((workspace / 'artifacts/tools/coding-cli/manifest.json').read_text())
    recipe = json.dumps(source_hashes(workspace), sort_keys=True).encode()
    now = datetime.now(timezone.utc)
    return {'runner': preparation['runner'], 'runnerVersion': cli['observedVersions']['codex' if preparation['runner'] == 'codex' else 'claude'],
            'pinnedRuntimeHash': digest(json.dumps(native['files'], sort_keys=True).encode()),
            'guestImageHash': digest(json.dumps(cli['entries'], sort_keys=True).encode() + recipe),
            'isolation': 'disposable-kvm', 'preparationHash': preparation['hash'], 'repositoryHash': preparation['repositoryHash'],
            'commitSha': preparation['commitSha'], 'policyHash': digest(json.dumps(preparation['limits'], sort_keys=True).encode()),
            'observedAt': now.isoformat().replace('+00:00', 'Z'), 'expiresAt': (now + timedelta(seconds=60)).isoformat().replace('+00:00', 'Z'),
            'resources': RESOURCES, 'network': 'broker-only', 'billing': 'bounded-api'}


def readiness(workspace: Path, document: dict, deep: bool = True) -> dict:
    """Availability requires current executable bytes and actual stopped CLI guest proof."""
    if WORK_VM:
        return load('coding_guest_profile', workspace / 'scripts/coding_guest_profile.py').work_vm_readiness(workspace, document)
    cli = json.loads((workspace / 'artifacts/tools/coding-cli/manifest.json').read_text())
    versions = {'codex': cli['observedVersions']['codex'], 'claude-code': cli['observedVersions']['claude']}
    result = {'available': False, 'reason': 'No qualified private coding binding', 'versions': versions}
    try:
        native_path = workspace / 'artifacts/tools/coding-kvm/10.2.1/provenance.json'
        native = json.loads(native_path.read_text())
        root = native_path.parent / 'root'
        for name, entry in native['files'].items() if deep else []:
            path = root / name
            if not path.resolve().is_relative_to(root):
                raise ValueError('Runtime filesystem changed')
            if 'sha256' in entry and digest(path.read_bytes()) != entry['sha256']:
                raise ValueError('Runtime executable bytes changed')
            if 'link' in entry and (not path.is_symlink() or os.readlink(path) != entry['link']):
                raise ValueError('Runtime link changed')
        for entry in cli['entries'] if deep else []:
            path = Path(entry['absoluteSourcePath'])
            if path.resolve() != path or digest(path.read_bytes()) != entry['sha256']:
                raise ValueError('Coding CLI bytes changed')
        available_memory = next(int(line.split()[1]) * 1024 for line in Path('/proc/meminfo').read_text().splitlines() if line.startswith('MemAvailable:'))
        if available_memory < 6 * 1024 * 1024 * 1024:
            raise ValueError('Insufficient observed local host memory headroom')
        bindings = document.get('bindings', [])
        if not bindings:
            return result
        broker = load('coding_guest_broker', workspace / 'scripts/coding_guest_broker.py')
        current_host = host_profile()
        probe_current_kvm()
        for binding in bindings:
            broker.validate(binding['broker'], {'maxCostMicros': 1000000, 'timeoutSeconds': 180, 'maxPatchBytes': 131072, 'maxOutputBytes': 32768})
            proof = json.loads((native_path.parent / (binding['runner'] + '-qualification.json')).read_text())
            current = receipt(workspace, {'runner': binding['runner'], 'hash': '1' * 64, 'repositoryHash': '2' * 64,
                                          'commitSha': '3' * 40, 'limits': {}})
            if not proof.get('stopped') or proof.get('state') != 'succeeded' or not proof.get('fixtureState', {}).get('completed'):
                raise ValueError('No successful stopped CLI guest qualification')
            if not qualification_host_matches(proof, current_host):
                raise ValueError('CLI guest qualification belongs to a different host kernel or policy profile')
            if proof['receipt']['pinnedRuntimeHash'] != current['pinnedRuntimeHash'] or proof['receipt']['guestImageHash'] != current['guestImageHash']:
                raise ValueError('CLI guest qualification source/runtime changed')
        result.update({'available': True, 'reason': 'Pinned CLI protocols qualified in disposable KVM; private bounded API broker configured'})
    except (OSError, ValueError, KeyError, TypeError) as error:
        result['reason'] = str(error)[:512]
    return result


def exact_allocation(value: dict, task_id: str) -> str:
    if str(uuid.UUID(task_id)) != task_id or value.get('taskId') != task_id:
        raise ValueError('Retained native task identity changed')
    unit = 'godseye-coding-' + task_id + '.service'
    if value.get('unit') != unit or value.get('cgroup') != '/system.slice/' + unit:
        raise ValueError('Retained native service scope changed')
    if value.get('invocationId') is not None and not re.fullmatch('[a-f0-9]{32}', value['invocationId']):
        raise ValueError('Retained native invocation identity changed')
    return unit


def stopped(value: dict) -> bool:
    exact_allocation(value, value['taskId'])
    if not value.get('invocationId'):
        return False
    if value['bootId'] != Path('/proc/sys/kernel/random/boot_id').read_text().strip():
        return False
    native = properties(value['unit'])
    if native.get('InvocationID') and native['InvocationID'] != value.get('invocationId'):
        return False
    group = Path('/sys/fs/cgroup') / value['cgroup'].lstrip('/')
    return native.get('ActiveState') in ('inactive', 'failed') and (not group.exists() or not (group / 'cgroup.procs').read_text().strip())


def run(workspace: Path, document: dict, lab: bool = False, authorize=None, attempts=None) -> dict:
    request = document['request']
    task_id = identity(request)
    preparation = request['preparation']
    directory = workspace / 'artifacts/tools/coding-kvm/10.2.1/root/run' / task_id
    if directory.exists():
        raise ValueError('Native allocation exists; inspect instead of replaying')
    module = load('coding_guest_task', workspace / 'scripts/coding_guest_task.py')
    broker = load('coding_cli_fixture' if lab else 'coding_guest_broker', workspace / 'scripts' / ('coding_cli_fixture.py' if lab else 'coding_guest_broker.py'))
    if lab:
        task_document = None
        source_archive = None
        if document.get('labCase'):
            case = document['labCase']
            if case not in ('index', 'test-mutation', 'background', 'pids-failure', 'attributes'):
                raise ValueError('Unknown fixed native regression case')
            task_document = {'runner': preparation['runner'], 'syntheticFixture': True, 'labCase': case,
                             'input': 'Change answer.cjs to export 42 and run its Node test. Report the result.',
                             'maxPatchBytes': 131072, 'testProfile': 'test'}
            if document.get('labSource'):
                registration = document['labSource']
                staging = load('coding_guest_source', workspace / 'scripts/coding_guest_source.py')
                source_archive, _ = staging.snapshot(Path(registration['sourceDirectory']), registration['commitSha'])
                task_document.update({'syntheticFixture': False, 'commitSha': registration['commitSha']})
    else:
        broker.validate(document['binding']['broker'], preparation['limits'])
        source_archive, _ = source(workspace, document)
        task_document = {'runner': preparation['runner'], 'syntheticFixture': False, 'input': preparation['input'],
                         'commitSha': preparation['commitSha'], 'maxPatchBytes': preparation['limits']['maxPatchBytes'],
                         'testProfile': preparation['testProfile'], 'model': document['binding']['broker']['model']}
    image = module.build(workspace, task_id, preparation['runner'], task_document, source_archive)
    if not lab:
        if not callable(authorize):
            raise ValueError('Trusted launch authorization callback unavailable')
        authorize()
    unit = 'godseye-coding-' + task_id + '.service'
    value = {'state': 'unknown', 'stopped': False, 'grantsRevoked': False, 'workspace': 'quarantined', 'taskId': task_id,
             'requestHash': digest(json.dumps(request, sort_keys=True).encode()), 'unit': unit, 'invocationId': None,
             'cgroup': '/system.slice/' + unit, 'bootId': Path('/proc/sys/kernel/random/boot_id').read_text().strip(),
             'imageHash': image['imageHash'], 'receipt': receipt(workspace, preparation), 'launchIntended': True}
    value['sourceHashes'] = source_hashes(workspace)
    value['hostProfile'] = host_profile()
    atomic(directory / 'state.json', value)
    endpoint = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    native_directory = Path('/tmp') / ('godseye-coding-broker-' + task_id)
    native_directory.mkdir(mode=0o700)
    endpoint.bind(str(native_directory / 'broker.sock'))
    endpoint.listen(1)
    endpoint.settimeout(1)
    gid = str(os.stat('/dev/kvm').st_gid)
    command = ['/mnt/c/Windows/System32/wsl.exe', '-d', 'Ubuntu', '-u', 'root', '--', '/usr/bin/systemd-run',
               '--unit=' + unit, '--property=Type=exec', '--property=CPUQuota=100%', '--property=MemoryMax=5G',
               '--property=TasksMax=64', '--property=RuntimeMaxSec=180', '--property=KillMode=control-group',
               '--pipe', '--wait', '--collect', '/usr/bin/setpriv', '--reuid=1000', '--regid=1000', '--groups=' + gid,
               '--no-new-privs', '--', '/usr/bin/env', '-i', 'PATH=/usr/bin:/bin', 'LC_ALL=C', '/usr/bin/unshare',
               '--user', '--map-root-user', '--mount', '--net', '--pid', '--fork', '--mount-proc', '/usr/bin/python3', '-I',
               str(workspace / 'scripts/coding_guest_task.py'), 'execute',
               str(workspace / 'artifacts/tools/coding-kvm/10.2.1'), task_id]
    environment = {'PATH': '/usr/bin:/bin', 'LC_ALL': 'C', 'WSL_INTEROP': os.environ.get('WSL_INTEROP', '')}
    process = subprocess.Popen(command, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, env=environment)
    chunks = []
    output_bytes = 0
    physical_ready = threading.Event()

    def collect() -> None:
        nonlocal output_bytes
        pending = b''
        with (directory / 'native-output.log').open('xb') as output:
            while chunk := process.stdout.read1(8192):
                output_bytes += len(chunk)
                if output_bytes <= MAX_OUTPUT:
                    chunks.append(chunk)
                    output.write(chunk)
                    output.flush()
                    pending += chunk
                    while b'\n' in pending:
                        line, pending = pending.split(b'\n', 1)
                        expected = 'GODSEYE_PHYSICAL_READY ' + task_id + ' ' + image['imageHash']
                        if line.decode(errors='replace').strip() == expected:
                            physical_ready.set()
                    if len(pending) > MAX_FRAME:
                        pending = b''

    collector = threading.Thread(target=collect, daemon=True)
    collector.start()
    state = {'journalPath': str(directory / 'broker-ledger.json'), 'deadline': request['deadline'],
             'correlationId': request['correlationId'], 'revoked': False}
    if not lab:
        state['authorize'] = authorize
        state['attempts'] = attempts
    connection = None
    buffer = b''
    last_id = 0
    physical_started = False
    deadline = min(time.time() + 175, datetime.fromisoformat(request['deadline'].replace('Z', '+00:00')).timestamp())
    try:
        for _ in range(200):
            native = properties(unit)
            if native.get('InvocationID'):
                value['invocationId'] = native['InvocationID']
                break
            if process.poll() is not None:
                raise ValueError('Native service failed before invocation receipt')
            time.sleep(0.05)
        if not value['invocationId']:
            raise ValueError('Native invocation receipt unavailable')
        atomic(directory / 'state.json', value)
        if not lab:
            authorize()
        atomic(directory / 'release', {'imageHash': image['imageHash'], 'invocationId': value['invocationId']})
        while process.poll() is None:
            if time.time() >= deadline or output_bytes > MAX_OUTPUT or (directory / 'revoked').exists():
                raise ValueError('Native task deadline or output bound exceeded')
            if physical_ready.is_set() and not physical_started:
                if not lab:
                    authorize()
                atomic(directory / 'start', {'taskId': task_id, 'imageHash': image['imageHash']})
                physical_started = True
            if connection is None:
                try:
                    connection, _ = endpoint.accept()
                    connection.setblocking(False)
                except socket.timeout:
                    continue
            readable, _, _ = select.select([connection], [], [], 0.1)
            if not readable:
                continue
            chunk = connection.recv(65536)
            if not chunk:
                connection.close()
                connection = None
                continue
            buffer += chunk
            if len(buffer) > MAX_FRAME:
                raise ValueError('Guest broker frame exceeds bound')
            while b'\n' in buffer:
                line, buffer = buffer.split(b'\n', 1)
                frame = json.loads(line)
                if set(frame) != {'id', 'method', 'path', 'headers', 'body'} or frame['id'] != last_id + 1 or frame['id'] > 16:
                    raise ValueError('Guest broker frame identity differs')
                last_id = frame['id']
                atomic(directory / 'broker-observation.json', {'requestCount': last_id, 'route': frame['path']})
                body = base64.b64decode(frame['body'], validate=True).decode()
                forwarded = {**frame, 'body': body}
                response = broker.handle(forwarded, state) if lab else broker.handle(forwarded, state, document['binding']['broker'], preparation['limits'])
                if not lab:
                    authorize()
                wire = json.dumps({**response, 'id': frame['id']}).encode() + b'\n'
                if len(wire) > MAX_FRAME:
                    raise ValueError('Broker response exceeds frame bound')
                connection.setblocking(True)
                connection.settimeout(5)
                connection.sendall(wire)
                connection.setblocking(False)
        process.wait(timeout=5)
        collector.join(timeout=5)
        output = b''.join(chunks).decode(errors='replace')
        matches = re.findall(r'^GODSEYE_RESULT ([A-Za-z0-9+/=]+)\r?$', output, re.M)
        if len(matches) != 1:
            raise ValueError('Guest produced no unique bounded result: ' + output[-2048:])
        guest = json.loads(base64.b64decode(matches[0], validate=True))
        if guest.get('runner') != preparation['runner'] or guest.get('kind') != 'coding.guest.result':
            raise ValueError('Guest result identity differs')
        value['guestResult'] = guest
        value['state'] = 'succeeded' if guest['cli']['code'] == 0 else 'failed'
        value['fixtureState'] = state if lab else None
    except Exception as error:
        value['reason'] = str(error)[:4096]
        state['revoked'] = True
        native = properties(unit)
        if native.get('InvocationID') == value.get('invocationId') and value.get('invocationId'):
            subprocess.run(['/mnt/c/Windows/System32/wsl.exe', '-d', 'Ubuntu', '-u', 'root', '--', '/usr/bin/systemctl', 'stop', unit],
                           env=environment, capture_output=True, timeout=10)
        try:
            process.wait(timeout=10)
        except subprocess.TimeoutExpired:
            pass
    finally:
        state['revoked'] = True
        if lab:
            value['fixtureState'] = state
        if connection:
            connection.close()
        endpoint.close()
        (native_directory / 'broker.sock').unlink()
        native_directory.rmdir()
        value['stopped'] = stopped(value)
        value['grantsRevoked'] = True
        value['workspace'] = 'retained' if value['stopped'] else 'quarantined'
        if not value['stopped']:
            value['state'] = 'unknown'
        elif value['state'] == 'unknown':
            value['state'] = 'failed'
        if value['sourceHashes'] != source_hashes(workspace):
            value['state'] = 'failed' if value['stopped'] else 'unknown'
            value['reason'] = 'Runtime sources changed during execution; qualification is invalid'
        if value['hostProfile'] != host_profile():
            value['state'] = 'failed' if value['stopped'] else 'unknown'
            value['reason'] = 'Host kernel or policy profile changed during execution'
        report_path = directory / 'attempts.json'
        if report_path.exists():
            value['attempts'] = json.loads(report_path.read_text())
        atomic(directory / 'state.json', value)
    return value


def main() -> None:
    workspace = Path(sys.argv[1])
    ordinary = os.getuid() != 0 if WORK_VM else os.getuid() == 1000
    if workspace.resolve() != workspace or not ordinary:
        raise ValueError('Private bridge requires an unlinked registered workspace and ordinary host user')
    if WORK_VM and sys.argv[2] in ('run', 'lab'):
        raise ValueError('Work-VM sandbox runner is not qualified; execution is unavailable')
    raw = sys.stdin.buffer.readline(262145)
    if len(raw) > 262144:
        raise ValueError('Native request exceeds bound')
    document = json.loads(raw)
    action = sys.argv[2]
    if action == 'readiness':
        result = readiness(workspace, document, deep=False)
    elif action == 'source':
        _, result = source(workspace, document)
    elif action in ('run', 'lab'):
        sequence = 0

        def authorize() -> None:
            nonlocal sequence
            native_directory = workspace / 'artifacts/tools/coding-kvm/10.2.1/root/run' / identity(document['request'])
            if (native_directory / 'revoked').exists():
                raise ValueError('Native task grant was revoked')
            sequence += 1
            if sequence > 128:
                raise ValueError('Trusted authorization callback bound exceeded')
            correlation = document['request']['correlationId']
            print(json.dumps({'kind': 'authorize', 'correlationId': correlation, 'sequence': sequence}), flush=True)
            ready, _, _ = select.select([sys.stdin], [], [], 5)
            if not ready:
                raise ValueError('Trusted authorization callback expired')
            line = sys.stdin.buffer.readline(1025)
            if len(line) > 1024 or json.loads(line) != {'kind': 'authorized', 'correlationId': correlation, 'sequence': sequence}:
                raise ValueError('Trusted authorization denied or changed')
            if (native_directory / 'revoked').exists():
                raise ValueError('Native task grant was revoked before dispatch')

        def attempts(kind, payload):
            nonlocal sequence
            sequence += 1
            if sequence > 128:
                raise ValueError('Attempt callback bound exceeded')
            correlation = document['request']['correlationId']
            print(json.dumps({'kind': kind, 'correlationId': correlation, 'sequence': sequence, 'payload': payload}), flush=True)
            ready, _, _ = select.select([sys.stdin], [], [], 5)
            if not ready:
                raise ValueError('Attempt callback expired')
            line = sys.stdin.buffer.readline(1025)
            if len(line)>1024 or json.loads(line) != {'kind':'authorized','correlationId':correlation,'sequence':sequence}:
                raise ValueError('Attempt callback denied')

        result = run(workspace, document, action == 'lab', authorize=authorize, attempts=attempts)
    elif action == 'preflight':
        available = readiness(workspace, {'bindings': [document['binding']]}, deep=False)
        if not available['available']:
            raise ValueError(available['reason'])
        broker = load('coding_guest_broker', workspace / 'scripts/coding_guest_broker.py')
        broker.validate(document['binding']['broker'], document['request']['preparation']['limits'])
        source(workspace, document)
        result = receipt(workspace, document['request']['preparation'])
    elif action in ('inspect', 'stop'):
        task_id = identity(document['request'])
        directory = workspace / 'artifacts/tools/coding-kvm/10.2.1/root/run' / task_id
        result = json.loads((directory / 'state.json').read_text())
        exact_allocation(result, task_id)
        report_path = directory / 'attempts.json'
        if report_path.exists():
            if report_path.is_symlink() or report_path.stat().st_size > 131072:
                raise ValueError('Retained broker evidence differs')
            result['attempts'] = json.loads(report_path.read_text())
        if result['requestHash'] != digest(json.dumps(document['request'], sort_keys=True).encode()):
            raise ValueError('Retained task differs')
        if action == 'stop':
            atomic(directory / 'revoked', {'taskId': task_id})
        if action == 'stop' and not stopped(result):
            native = properties(result['unit'])
            if native.get('InvocationID') != result['invocationId'] or result['bootId'] != Path('/proc/sys/kernel/random/boot_id').read_text().strip():
                raise ValueError('Native stop identity changed')
            subprocess.run(['/mnt/c/Windows/System32/wsl.exe', '-d', 'Ubuntu', '-u', 'root', '--', '/usr/bin/systemctl', 'stop', result['unit']], check=True, timeout=10)
        result['stopped'] = stopped(result)
        if action == 'stop':
            result.update({'grantsRevoked': True, 'state': 'cancelled' if result['stopped'] else 'unknown'})
        if not result['stopped'] or not result['grantsRevoked']:
            result['workspace'] = 'quarantined'
        elif (result['workspace'] == 'quarantined' and not result.get('reason')
              and result.get('launchIntended') is True
              and isinstance(result.get('imageHash'), str)
              and re.fullmatch('[a-f0-9]{64}', result.get('imageHash', ''))):
            # Initial launch quarantine is not an integrity incident. Other
            # quarantine reasons/dispositions remain untouched by inspection.
            result['workspace'] = 'retained'
        if action == 'stop':
            atomic(directory / 'state.json', result)
    else:
        raise ValueError('Unknown fixed native action')
    print(json.dumps(result), flush=True)


if __name__ == '__main__':
    main()
