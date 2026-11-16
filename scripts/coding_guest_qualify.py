"""Explicit owner-run synthetic qualification, never a production runtime binding."""
from datetime import datetime, timedelta, timezone
import importlib.util
import json
from pathlib import Path
import sys
import uuid


def main() -> None:
    workspace = Path(sys.argv[1])
    runner = sys.argv[2]
    specification = importlib.util.spec_from_file_location('coding_guest_control', workspace / 'scripts/coding_guest_control.py')
    module = importlib.util.module_from_spec(specification)
    specification.loader.exec_module(module)
    task_id = str(uuid.uuid4())
    preparation = {'runner': runner, 'hash': '1' * 64, 'repositoryHash': '2' * 64, 'commitSha': '3' * 40,
                   'limits': {'timeoutSeconds': 180, 'maxCostMicros': 1000000, 'maxPatchBytes': 131072, 'maxOutputBytes': 32768}}
    request = {'taskId': task_id, 'correlationId': task_id, 'worktreeId': str(uuid.uuid4()), 'preparation': preparation,
               'deadline': (datetime.now(timezone.utc) + timedelta(minutes=15)).isoformat().replace('+00:00', 'Z')}
    print(json.dumps({'event': 'qualification.started', 'taskId': task_id, 'runner': runner}), flush=True)
    result = module.run(workspace, {'request': request}, lab=True)
    output = workspace / 'artifacts/tools/coding-kvm/10.2.1' / (runner + '-qualification.json')
    output.write_text(json.dumps(result, indent=2))
    guest = result.get('guestResult', {})
    passed = (result['stopped'] and result['grantsRevoked'] and result['state'] == 'succeeded'
              and guest.get('test', {}).get('code') == 0 and 'module.exports = 42' in guest.get('patch', '')
              and result.get('fixtureState', {}).get('completed') is True)
    print(json.dumps({'event': 'qualification.finished', 'taskId': task_id, 'runner': runner, 'passed': passed,
                      'state': result['state'], 'stopped': result['stopped'], 'reason': result.get('reason'),
                      'cli': guest.get('cli'), 'test': guest.get('test'), 'fixtureState': result.get('fixtureState')}), flush=True)
    if not passed:
        raise SystemExit(1)


if __name__ == '__main__':
    main()
