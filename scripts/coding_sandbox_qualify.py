"""Qualification harness for the work-VM gVisor sandbox runner (laboratory use on godseye-work).

Every case drives the real control bridge (`coding_work_vm_control.py lab`) exactly as the SSH transport
would, with the real pinned vendor CLI and the scripted fixture model (no network, no key, no paid call).
Evidence is recorded gate by gate; a gate that cannot be proven here (for example the Proxmox egress
allowlist or the owner's recorded acceptance) is recorded as NOT passed, which keeps the runner unavailable.
"""
from datetime import datetime, timedelta, timezone
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import socket
import subprocess
import sys
import threading
import time
import uuid

SCRIPTS = Path(__file__).resolve().parent


def load(name: str):
    specification = importlib.util.spec_from_file_location(name, SCRIPTS / (name + '.py'))
    module = importlib.util.module_from_spec(specification)
    specification.loader.exec_module(module)
    return module


profile = load('coding_guest_profile')
policy = load('coding_sandbox_policy')
EVIDENCE = 'artifacts/work-vm/evidence'
EXPECTED_COMMANDS = ["printf 'module.exports = 42;\\n' > answer.cjs", '/usr/bin/node --test answer.test.cjs']
OUTBOUND_PROBES = (('1.1.1.1', 443), ('8.8.8.8', 53), ('10.20.1.10', 22))


def preparation(runner: str) -> dict:
    return {'runner': runner, 'hash': '1' * 64, 'repositoryHash': '2' * 64, 'commitSha': '3' * 40,
            'limits': {'maxCostMicros': 100000, 'timeoutSeconds': 180, 'maxPatchBytes': 131072, 'maxOutputBytes': 32768}}


def lab_document(runner: str, case: str | None = None, seconds: int = 120, source: dict | None = None) -> dict:
    deadline = (datetime.now(timezone.utc) + timedelta(seconds=seconds + 30)).isoformat().replace('+00:00', 'Z')
    document = {'request': {'taskId': str(uuid.uuid4()), 'correlationId': str(uuid.uuid4()),
                            'worktreeId': str(uuid.uuid4()), 'preparation': preparation(runner), 'deadline': deadline},
                'labDeadlineSeconds': seconds}
    if case:
        document['labCase'] = case
    if source:
        document['labSource'] = source
    return document


def control(workspace: Path, action: str, document: dict, timeout: int = 200) -> subprocess.Popen:
    environment = {'PATH': '/usr/bin:/bin', 'LC_ALL': 'C', 'GODSEYE_CODING_PROFILE': 'work-vm'}
    command = ['/usr/bin/python3', '-I', str(workspace / 'scripts/coding_work_vm_control.py'), str(workspace), action]
    process = subprocess.Popen(command, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                               text=True, env=environment)
    process.stdin.write(json.dumps(document) + '\n')
    process.stdin.flush()
    return process


def finish(process: subprocess.Popen, timeout: int = 200) -> dict:
    out, err = process.communicate(timeout=timeout)
    if process.returncode != 0 or not out.strip():
        return {'harnessError': (err or out)[-1500:], 'returncode': process.returncode}
    return json.loads(out.strip().splitlines()[-1])


def invoke(workspace: Path, action: str, document: dict, timeout: int = 200) -> dict:
    return finish(control(workspace, action, document, timeout), timeout)


def merged_markers(state: dict) -> dict:
    """Combine structured guest markers with host-observed facts for the policy verdict."""
    merged: dict = {}
    for marker in state.get('adversary', []):
        if isinstance(marker, dict):
            merged.update(marker)
    if state.get('unitResult') == 'oom-kill':
        merged['reachedLimit'] = True
    peak = state.get('peak', {})
    merged.update({'peakPids': peak.get('pids', 1 << 30), 'peakMemoryBytes': peak.get('memoryBytes', 1 << 62),
                   'sandboxEnded': state.get('stopped') is True and state.get('state') != 'succeeded'})
    return merged


def leftovers(state: dict, workspace: Path) -> list[str]:
    """Anything the task left behind after its final physical stop proof."""
    found = []
    directory = workspace / 'artifacts/work-vm/run' / state['taskId']
    for name in ('rootfs', 'coding', 'source.git', 'bundle', 'oci'):
        if (directory / name).exists():
            found.append('directory:' + name)
    group = Path('/sys/fs/cgroup') / state['cgroup'].lstrip('/')
    if group.exists() and (group / 'cgroup.procs').read_text().strip():
        found.append('cgroup-processes')
    listing = subprocess.run(['/usr/bin/ps', '-eo', 'args'], capture_output=True, text=True).stdout
    if any(policy.container_id(state['taskId']) in line for line in listing.splitlines()):
        found.append('runsc-process')
    return found


def chain_passed(state: dict, runner: str) -> tuple[bool, str]:
    guest = state.get('guestResult') or {}
    commands = (state.get('fixtureState') or {}).get('commands')
    checks = {'succeeded': state.get('state') == 'succeeded', 'stopped': state.get('stopped') is True,
              'testPassed': (guest.get('test') or {}).get('code') == 0,
              'patchEdits': 'module.exports = 42' in guest.get('patch', ''),
              'commands': commands == EXPECTED_COMMANDS, 'completed': (state.get('fixtureState') or {}).get('completed') is True,
              'runner': guest.get('runner') == runner}
    failed = [name for name, ok in checks.items() if not ok]
    return not failed, ('ok' if not failed else 'failed: ' + ','.join(failed) + ' ' + str(state.get('reason', ''))[:300])


def egress_from_vm() -> dict:
    """Does the work VM itself (outside any sandbox) reach arbitrary destinations? Required: it must not."""
    reachable = []
    for host, port in OUTBOUND_PROBES:
        try:
            with socket.create_connection((host, port), timeout=3):
                reachable.append(f'{host}:{port}')
        except OSError:
            pass
    return {'passed': not reachable, 'reachable': reachable,
            'note': 'enforced by the Proxmox host firewall, outside this VM' if reachable else 'no outbound path observed'}


def owner_acceptance(workspace: Path) -> dict:
    path = workspace / 'artifacts/work-vm/owner-acceptance.json'
    if not path.is_file():
        return {'passed': False, 'note': 'no owner-signed acceptance artifact is recorded'}
    value = json.loads(path.read_text())
    return {'passed': value.get('accepted') is True and value.get('boundary') == profile.ISOLATION, 'note': 'recorded'}


def gate(passed: bool, detail: str, **extra) -> dict:
    return {'passed': bool(passed), 'detail': detail[:600], 'observedAt': datetime.now(timezone.utc).isoformat(), **extra}


def judge_containment(case: str, state: dict, workspace: Path) -> dict:
    markers = merged_markers(state)
    verdict = policy.verdict_for_case(case, markers)
    clean = leftovers(state, workspace) if state.get('taskId') else ['no-state']
    stopped = state.get('stopped') is True
    return gate(verdict['passed'] and stopped and not clean, f'markers={json.dumps(markers)[:400]} leftovers={clean}',
                taskId=state.get('taskId'), unitResult=state.get('unitResult'))


def stop_and_cleanup(workspace: Path, runner: str) -> dict:
    """Physical revocation: stop a hung sandbox from a second process, then prove nothing is left."""
    document = lab_document(runner, 'hang', seconds=90)
    running = control(workspace, 'lab', document)
    unit = policy.unit_name(document['request']['taskId'])
    environment = policy.user_environment(os.getuid())
    for _ in range(300):
        shown = subprocess.run(['/usr/bin/systemctl', '--user', 'is-active', unit], env=environment, capture_output=True, text=True)
        if shown.stdout.strip() == 'active':
            break
        time.sleep(0.1)
    time.sleep(8)
    stopper = invoke(workspace, 'stop', document)
    state = finish(running)
    clean = leftovers(state, workspace) if state.get('taskId') else ['no-state']
    passed = stopper.get('stopped') is True and stopper.get('state') == 'cancelled' and state.get('stopped') is True and not clean
    return gate(passed, f'stop={stopper.get("state")} run={state.get("state")} reason={str(state.get("reason"))[:160]} leftovers={clean}',
                taskId=state.get('taskId'))


def ci_busy() -> bool:
    """godseye-work doubles as the Jenkins agent: never contend with a running build."""
    listing = subprocess.run(['/usr/bin/ps', '-eo', 'args'], capture_output=True, text=True).stdout
    return any(marker in line for line in listing.splitlines() for marker in ('vitest', 'chrome-headless', 'playwright', 'gradle'))


def wait_for_idle(limit_seconds: int = 900) -> None:
    waited = 0
    while ci_busy():
        if waited >= limit_seconds:
            raise RuntimeError('Jenkins stayed busy; qualification not attempted')
        time.sleep(15)
        waited += 15


def run_case(workspace: Path, runner: str, case: str | None, source: dict | None = None, seconds: int = 120) -> dict:
    wait_for_idle()
    return invoke(workspace, 'lab', lab_document(runner, case, seconds, source), seconds + 90)


def write_proof(workspace: Path, runners: dict, shared: dict) -> Path:
    proof = {'version': profile.QUALIFICATION_VERSION, 'runscSha256': profile.runsc_sha256(),
             'sourceHashes': profile.source_hashes(workspace), 'cliFiles': profile.cli_manifest(workspace)['files'],
             'shared': shared, 'runners': runners, 'recordedAt': datetime.now(timezone.utc).isoformat()}
    target = workspace / profile.QUALIFICATION
    target.write_text(json.dumps(proof, indent=2, sort_keys=True) + '\n')
    return target


def fixture_source(workspace: Path) -> dict:
    """A registered local Git source with hostile attributes, created with host Git inside the laboratory."""
    root = workspace / 'artifacts/work-vm/lab-source'
    if not root.exists():
        files = {'.gitattributes': 'hidden.test.cjs export-ignore\nsubstitution.txt export-subst\nencoded.txt working-tree-encoding=UTF-16LE\n',
                 '.gitignore': 'hidden.test.cjs\n', 'answer.cjs': 'module.exports = 1;\n',
                 'answer.test.cjs': 'const test=require("node:test");const assert=require("node:assert/strict");test("answer is corrected",()=>assert.equal(require("./answer.cjs"),42));\n',
                 'hidden.test.cjs': 'require("node:test")("hidden exact source is present", () => {});\n',
                 'encoded.txt': 'Exact committed UTF-8 bytes must remain unchanged\n', 'substitution.txt': '$Format:%H$\n',
                 'package.json': '{"private":true,"scripts":{"test":"node --test answer.test.cjs hidden.test.cjs"}}\n',
                 'nested/payload.txt': 'Original nested source bytes\n'}
        root.mkdir(parents=True)
        for name, content in files.items():
            (root / name).parent.mkdir(parents=True, exist_ok=True)
            (root / name).write_text(content)
        environment = {'PATH': '/usr/bin:/bin', 'LC_ALL': 'C', 'HOME': str(root), 'GIT_CONFIG_NOSYSTEM': '1', 'GIT_CONFIG_GLOBAL': '/dev/null'}
        git_base = ['/usr/bin/git', '-C', str(root), '-c', 'core.hooksPath=/dev/null']
        subprocess.run([*git_base, 'init', '-q'], check=True, env=environment)
        # The hostile attributes must be committed as raw bytes, never converted by this fixture's own add.
        (root / '.git/info').mkdir(exist_ok=True)
        (root / '.git/info/attributes').write_text('* -text -filter -working-tree-encoding -ident -export-ignore -export-subst\n')
        for command in (['config', 'gc.auto', '0'], ['config', 'user.name', 'Lab'], ['config', 'user.email', 'lab@invalid.local'],
                        ['add', '--force', '--', '.'], ['commit', '-q', '-m', 'laboratory fixture']):
            subprocess.run(['/usr/bin/git', '-C', str(root), '-c', 'core.hooksPath=/dev/null', *command], check=True, env=environment)
    sha = subprocess.run(['/usr/bin/git', '-C', str(root), 'rev-parse', 'HEAD'], check=True, capture_output=True, text=True).stdout.strip()
    return {'sourceDirectory': str(root), 'commitSha': sha}


def qualify_runner(workspace: Path, runner: str) -> dict:
    gates = {}
    chain = run_case(workspace, runner, None)
    ok, detail = chain_passed(chain, runner)
    gates['cli-chain'] = gate(ok, detail, taskId=chain.get('taskId'))
    for case in ('index', 'background'):
        state = run_case(workspace, runner, case)
        ok, detail = chain_passed(state, runner)
        needed = {'index': 'mutable-index-hides-edit', 'background': 'background-tree-stable-after-check'}[case]
        gates['adversarial-' + case] = gate(ok and needed in state.get('adversary', []), detail + f' marker={needed}', taskId=state.get('taskId'))
    mutation = run_case(workspace, runner, 'test-mutation')
    gates['adversarial-test-mutation'] = gate(mutation.get('state') != 'succeeded' and mutation.get('stopped') is True
                                              and 'Repository changed during verification' in json.dumps(mutation.get('diagnostic', '')),
                                              'mutating test is refused: ' + json.dumps(mutation.get('diagnostic', ''))[:300],
                                              taskId=mutation.get('taskId'))
    attributes = run_case(workspace, runner, 'attributes', fixture_source(workspace))
    ok, _ = chain_passed({**attributes, 'fixtureState': attributes.get('fixtureState')}, runner)
    gates['adversarial-attributes'] = gate(attributes.get('state') == 'succeeded' and 'exact-attribute-tree-preserved' in attributes.get('adversary', [])
                                           and 'nested/payload.txt' in (attributes.get('guestResult') or {}).get('patch', ''),
                                           'exact attributes preserved; nested path patched', taskId=attributes.get('taskId'))
    gates['adversarial-escape'] = judge_containment('escape', run_case(workspace, runner, 'escape'), workspace)
    gates['adversarial-egress'] = judge_containment('egress', run_case(workspace, runner, 'egress'), workspace)
    parts = {case: judge_containment(case, run_case(workspace, runner, case, seconds=60), workspace)
             for case in ('exhaust-memory', 'exhaust-pids', 'exhaust-disk')}
    hang = judge_containment('hang', run_case(workspace, runner, 'hang', seconds=15), workspace)
    gates['adversarial-exhaustion'] = gate(all(item['passed'] for item in (*parts.values(), hang)),
                                           json.dumps({k: v['passed'] for k, v in {**parts, 'hang-deadline': hang}.items()}))
    gates['stop-revocation-cleanup'] = stop_and_cleanup(workspace, runner)
    return gates


def main() -> None:
    workspace = Path(sys.argv[1]).resolve(strict=True)
    mode = sys.argv[2]
    if os.getuid() == 0:
        raise ValueError('Qualification must run as the unprivileged service user')
    if mode == 'case':
        print(json.dumps(run_case(workspace, sys.argv[3], None if sys.argv[4] == '-' else sys.argv[4],
                                  fixture_source(workspace) if sys.argv[4] == 'attributes' else None, 60), indent=1))
    elif mode == 'qualify':
        runners = {runner: qualify_runner(workspace, runner) for runner in sys.argv[3:]}
        shared = {'vm-egress-allowlist': {**egress_from_vm(), 'observedAt': datetime.now(timezone.utc).isoformat()},
                  'owner-acceptance': {**owner_acceptance(workspace), 'observedAt': datetime.now(timezone.utc).isoformat()}}
        shared = {name: {**value, 'detail': value.get('note', '')} for name, value in shared.items()}
        print(write_proof(workspace, runners, shared))
    else:
        raise ValueError('Unknown qualification mode')


if __name__ == '__main__':
    main()
