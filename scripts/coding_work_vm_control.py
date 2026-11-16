"""Private bounded control bridge for the disposable work VM (profile 'work-vm', gVisor task sandboxes).

Invoked over SSH stdio by the control API's work-VM transport with the same JSON-line protocol and
authorization frames as the KVM bridge. Repository code is never executed on the host: it runs only inside
a per-task gVisor sandbox started by coding_sandbox_runner.py. Readiness stays false until complete
qualification evidence exists (see coding_guest_profile.py).
"""
from datetime import datetime, timedelta, timezone
import importlib.util
import json
import os
from pathlib import Path
import select
import sys
import threading
import time

REPLY_WAIT_SECONDS = 5
SCRIPTS = Path(__file__).resolve().parent


def load(name: str):
    specification = importlib.util.spec_from_file_location(name, SCRIPTS / (name + '.py'))
    module = importlib.util.module_from_spec(specification)
    specification.loader.exec_module(module)
    return module


base = load('coding_guest_control')
profile = load('coding_guest_profile')
runner = load('coding_sandbox_runner')
policy = runner.policy
LAB_CASES = policy.PERMITTED_CASES


def receipt(workspace: Path, preparation: dict) -> dict:
    identity = profile.runtime_identity(workspace)
    now = datetime.now(timezone.utc)
    stamp = lambda value: value.isoformat().replace('+00:00', 'Z')  # noqa: E731
    versions = identity['versions']
    return {'runner': preparation['runner'], 'runnerVersion': versions[preparation['runner']],
            'pinnedRuntimeHash': identity['pinnedRuntimeHash'], 'guestImageHash': identity['guestImageHash'],
            'isolation': profile.ISOLATION, 'preparationHash': preparation['hash'],
            'repositoryHash': preparation['repositoryHash'], 'commitSha': preparation['commitSha'],
            'policyHash': base.digest(json.dumps(preparation['limits'], sort_keys=True).encode()),
            'observedAt': stamp(now), 'expiresAt': stamp(now + timedelta(seconds=60)),
            'resources': {'memoryMiB': policy.LIMITS['memoryMiB'], 'cpuMilliCores': policy.LIMITS['cpuMilliCores'],
                          'maxProcesses': policy.LIMITS['maxProcesses'], 'diskMiB': policy.LIMITS['diskMiB']},
            'network': 'broker-only', 'billing': 'bounded-api'}


def make_callbacks(document: dict):
    """Authorization and attempt frames over this process's stdio, identical to the KVM bridge protocol."""
    state = {'sequence': 0}
    correlation = document['request']['correlationId']
    directory = runner.run_directory(Path(sys.argv[1]), base.identity(document['request']))

    def exchange(frame: dict) -> None:
        state['sequence'] += 1
        if state['sequence'] > 128:
            raise ValueError('Trusted authorization callback bound exceeded')
        print(json.dumps({**frame, 'correlationId': correlation, 'sequence': state['sequence']}), flush=True)
        ready, _, _ = select.select([sys.stdin], [], [], REPLY_WAIT_SECONDS)
        if not ready:
            raise ValueError('Trusted authorization callback expired')
        line = sys.stdin.buffer.readline(1025)
        if len(line) > 1024 or json.loads(line) != {'kind': 'authorized', 'correlationId': correlation,
                                                    'sequence': state['sequence']}:
            raise ValueError('Trusted authorization denied or changed')

    def authorize() -> None:
        if (directory / 'revoked').exists():
            raise ValueError('Native task grant was revoked')
        exchange({'kind': 'authorize'})
        if (directory / 'revoked').exists():
            raise ValueError('Native task grant was revoked before dispatch')

    def attempts(kind: str, payload: dict) -> None:
        exchange({'kind': kind, 'payload': payload})

    return authorize, attempts


def lab_task(preparation: dict, document: dict, workspace: Path) -> tuple[dict, bytes | None]:
    case = document.get('labCase')
    if case is not None and case not in LAB_CASES:
        raise ValueError('Unknown fixed sandbox regression case')
    task = {'runner': preparation['runner'], 'syntheticFixture': True, 'maxPatchBytes': 131072,
            'input': 'Change answer.cjs to export 42 and run its Node test. Report the result.', 'testProfile': 'test'}
    if case:
        task['labCase'] = case
    archive = None
    if document.get('labSource'):
        registration = document['labSource']
        archive, _ = load('coding_guest_source').snapshot(Path(registration['sourceDirectory']), registration['commitSha'])
        task.update({'syntheticFixture': False, 'commitSha': registration['commitSha']})
    return task, archive


def run(workspace: Path, document: dict, lab: bool = False, authorize=None, attempts=None) -> dict:
    request = document['request']
    preparation = request['preparation']
    task_id = base.identity(request)
    runsc_sha = profile.runsc_sha256()
    if runsc_sha != profile.PINNED_RUNSC_SHA256:
        raise ValueError('runsc is absent or differs from the pinned digest')
    if lab:
        broker, (task, archive) = load('coding_cli_fixture'), lab_task(preparation, document, workspace)
        authorize = authorize or (lambda: None)
    else:
        broker = load('coding_guest_broker')
        broker.validate(document['binding']['broker'], preparation['limits'])
        if not profile.work_vm_readiness(workspace, {'bindings': [document['binding']]})['available']:
            raise ValueError('Work-VM sandbox runner is not qualified; execution is unavailable')
        archive, _ = base.source(workspace, document)
        task = {'runner': preparation['runner'], 'syntheticFixture': False, 'input': preparation['input'],
                'commitSha': preparation['commitSha'], 'maxPatchBytes': preparation['limits']['maxPatchBytes'],
                'testProfile': preparation['testProfile'], 'model': document['binding']['broker']['model']}
    image = runner.prepare(workspace, task_id, task, archive, runsc_sha)
    directory = runner.run_directory(workspace, task_id)
    if not lab:
        authorize()
    unit = policy.unit_name(task_id)
    value = {'state': 'unknown', 'stopped': False, 'grantsRevoked': False, 'workspace': 'quarantined',
             'taskId': task_id, 'requestHash': base.digest(json.dumps(request, sort_keys=True).encode()), 'unit': unit,
             'invocationId': None, 'cgroup': policy.unit_cgroup(os.getuid(), unit),
             'bootId': Path('/proc/sys/kernel/random/boot_id').read_text().strip(), 'imageHash': image['imageHash'],
             'receipt': receipt(workspace, preparation), 'launchIntended': True,
             'sourceHashes': profile.source_hashes(workspace), 'hostProfile': profile.stable_host_profile()}
    runner.atomic(directory / 'state.json', value)
    ledger = {'journalPath': str(directory / 'broker-ledger.json'), 'deadline': request['deadline'],
              'correlationId': request['correlationId'], 'revoked': False}
    if not lab:
        ledger.update({'authorize': authorize, 'attempts': attempts})
    handle = (lambda frame: broker.handle(frame, ledger)) if lab else (
        lambda frame: broker.handle(frame, ledger, document['binding']['broker'], preparation['limits']))
    process = None
    lines: list[str] = []
    peaks: dict = {}
    sampling = threading.Event()
    threading.Thread(target=runner.sample_peaks, args=(value['cgroup'], peaks, sampling), daemon=True).start()
    try:
        process = runner._launch(workspace, directory, task_id, image['imageHash'], runsc_sha,
                                 document.get('labDeadlineSeconds') or policy.LIMITS['runtimeSeconds'])
        runner.unit_identity(directory, value, task_id, process, authorize or (lambda: None))
        runner.supervise(process, directory, handle, authorize or (lambda: None),
                         runner.deadline_for(request, document), lines)
        guest, _ = runner._collect_result(lines)
        if guest.get('runner') != preparation['runner'] or guest.get('kind') != 'coding.guest.result':
            raise ValueError('Sandbox result identity differs')
        value.update({'guestResult': guest, 'state': 'succeeded' if guest['cli']['code'] == 0 else 'failed'})
    except Exception as error:  # noqa: BLE001 - every failure is recorded, then the sandbox is stopped
        value['reason'] = str(error)[:4096]
        ledger['revoked'] = True
    finally:
        ledger['revoked'] = True
        sampling.set()
        value['peak'] = dict(peaks)
        value['adversary'] = runner.adversary_markers(lines)
        errors = [line for line in lines if line.startswith('STDERR ') and 'GODSEYE_CLI_OBSERVATION' not in line]
        value['diagnostic'] = errors[:12] + errors[12:][-6:]
        if process is not None:
            try:
                process.stdin.close()
            except OSError:
                pass
        if lab:
            value['fixtureState'] = ledger
        finalize_run(workspace, directory, value, process, lines)
    return value


def finalize_run(workspace: Path, directory: Path, value: dict, process, lines: list[str]) -> None:
    runner.finalize(directory, value, '/usr/bin/runsc')
    if process is not None:
        try:
            process.wait(timeout=10)
        except Exception:  # noqa: BLE001 - physical stop proof above is authoritative
            process.kill()
    time.sleep(0.3)  # let the stderr pump deliver systemd-run's final result line
    value['unitResult'] = runner.unit_result(lines)
    if value['sourceHashes'] != profile.source_hashes(workspace):
        value['state'] = 'failed' if value['stopped'] else 'unknown'
        value['reason'] = 'Runtime sources changed during execution; qualification is invalid'
    if value['hostProfile'] != profile.stable_host_profile():
        value['state'] = 'failed' if value['stopped'] else 'unknown'
        value['reason'] = 'Host kernel or policy profile changed during execution'
    report = directory / 'attempts.json'
    if report.exists():
        value['attempts'] = json.loads(report.read_text())
    runner.atomic(directory / 'state.json', value)


def inspect_or_stop(workspace: Path, document: dict, action: str) -> dict:
    task_id = base.identity(document['request'])
    directory = runner.run_directory(workspace, task_id)
    result = json.loads((directory / 'state.json').read_text())
    if result.get('unit') != policy.unit_name(task_id) or result['taskId'] != task_id:
        raise ValueError('Retained native task identity changed')
    if result['requestHash'] != base.digest(json.dumps(document['request'], sort_keys=True).encode()):
        raise ValueError('Retained task differs')
    report = directory / 'attempts.json'
    if report.exists():
        if report.is_symlink() or report.stat().st_size > 131072:
            raise ValueError('Retained broker evidence differs')
        result['attempts'] = json.loads(report.read_text())
    if action == 'stop':
        runner.atomic(directory / 'revoked', {'taskId': task_id})
        if not runner.stopped(result):
            native = runner.unit_properties(result['unit'])
            if native.get('InvocationID') != result['invocationId']:
                raise ValueError('Native stop identity changed')
            runner.systemctl('stop', result['unit'])
            for _ in range(100):
                if runner.stopped(result):
                    break
                time.sleep(0.1)
    result['stopped'] = runner.stopped(result)
    if action == 'stop':
        result.update({'grantsRevoked': True, 'state': 'cancelled' if result['stopped'] else 'unknown'})
        if result['stopped'] and directory.exists():
            runner.delete_container(directory, '/usr/bin/runsc', policy.container_id(task_id))
            runner.release_sandbox_files(directory)
    if not result['stopped'] or not result['grantsRevoked']:
        result['workspace'] = 'quarantined'
    elif result['workspace'] == 'quarantined' and not result.get('reason') and result.get('launchIntended') is True:
        result['workspace'] = 'retained'
    if action == 'stop':
        runner.atomic(directory / 'state.json', result)
    return result


def main() -> None:
    workspace = Path(sys.argv[1])
    if workspace.resolve() != workspace or os.getuid() == 0:
        raise ValueError('Private bridge requires an unlinked registered workspace and ordinary host user')
    raw = sys.stdin.buffer.readline(262145)
    if len(raw) > 262144:
        raise ValueError('Native request exceeds bound')
    document = json.loads(raw)
    action = sys.argv[2]
    if action == 'readiness':
        result = profile.work_vm_readiness(workspace, document)
    elif action == 'source':
        _, result = base.source(workspace, document)
    elif action == 'preflight':
        available = profile.work_vm_readiness(workspace, {'bindings': [document['binding']]})
        if not available['available']:
            raise ValueError(available['reason'])
        load('coding_guest_broker').validate(document['binding']['broker'], document['request']['preparation']['limits'])
        base.source(workspace, document)
        result = receipt(workspace, document['request']['preparation'])
    elif action in ('run', 'lab'):
        authorize, attempts = make_callbacks(document)
        result = run(workspace, document, action == 'lab', authorize if action == 'run' else None, attempts)
    elif action in ('inspect', 'stop'):
        result = inspect_or_stop(workspace, document, action)
    else:
        raise ValueError('Unknown fixed native action')
    print(json.dumps(result), flush=True)


if __name__ == '__main__':
    main()
