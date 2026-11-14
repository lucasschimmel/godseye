"""Explicit one-case actual KVM regressions. Synthetic local model API only, no paid calls."""
from datetime import datetime, timedelta, timezone
import hashlib
import importlib.util
import json
from pathlib import Path
import re
import sys
import tempfile
import time
import uuid
import zlib

CASES = ('index', 'test-mutation', 'background', 'pids-failure', 'attributes')


def require(condition: bool, message: str) -> None:
    if not condition:
        raise AssertionError(message)


def loose(source: Path, kind: str, content: bytes) -> str:
    raw = kind.encode() + b' ' + str(len(content)).encode() + b'\0' + content
    sha = hashlib.sha1(raw).hexdigest()
    target = source / '.git/objects' / sha[:2] / sha[2:]
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(zlib.compress(raw))
    return sha


def attribute_source(root: Path) -> tuple[Path, str]:
    """Build exact synthetic committed bytes without invoking host Git."""
    source = root / 'assigned-source'
    source.mkdir()
    files = {
        '.gitattributes': b'hidden.test.cjs export-ignore\nsubstitution.txt export-subst\nencoded.txt working-tree-encoding=UTF-16LE\n',
        '.gitignore': b'hidden.test.cjs\n',
        'answer.cjs': b'module.exports = 1;\n',
        'answer.test.cjs': b'const test=require("node:test");const assert=require("node:assert/strict");test("answer is corrected",()=>assert.equal(require("./answer.cjs"),42));\n',
        'hidden.test.cjs': b'require("node:test")("hidden exact source is present", () => {});\n',
        'encoded.txt': b'Exact committed UTF-8 bytes must remain unchanged\n',
        'substitution.txt': b'$Format:%H$\n',
        'package.json': b'{"private":true,"scripts":{"test":"node --test answer.test.cjs hidden.test.cjs"}}\n',
        'nested/payload.txt': b'Original nested source bytes\n',
    }
    blobs = {name: loose(source, 'blob', content) for name, content in files.items()}
    for name, content in files.items():
        path = source / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(content)
    def tree_at(prefix: str = '') -> str:
        entries = []
        children = sorted({name[len(prefix):].split('/')[0] for name in files if name.startswith(prefix)})
        for child in children:
            path = prefix + child
            if path in blobs:
                mode, digest = b'100644', blobs[path]
            else:
                mode, digest = b'40000', tree_at(path + '/')
            entries.append(mode + b' ' + child.encode() + b'\0' + bytes.fromhex(digest))
        return loose(source, 'tree', b''.join(entries))
    tree = tree_at()
    commit = loose(source, 'commit', (
        f'tree {tree}\nauthor Synthetic Owner <fixture@example.invalid> 1 +0000\n'
        'committer Synthetic Owner <fixture@example.invalid> 1 +0000\n\nExact attributes regression\n'
    ).encode())
    return source, commit


def manifest(source: Path) -> dict[str, str]:
    return {str(path.relative_to(source)): hashlib.sha256(path.read_bytes()).hexdigest()
            for path in source.rglob('*') if path.is_file()}


def source_tree_hash(source: Path) -> str:
    entries = [[name, 'file', digest] for name, digest in sorted(manifest(source).items()) if not name.startswith('.git/')]
    return hashlib.sha256(json.dumps(entries, separators=(',', ':')).encode()).hexdigest()


def main() -> None:
    if len(sys.argv) not in (3, 4) or sys.argv[2] not in CASES:
        raise ValueError('Expected canonical workspace, one fixed regression case and optional codex|claude-code')
    workspace = Path(sys.argv[1])
    require(workspace == Path(__file__).resolve().parents[1], 'Unregistered regression workspace')
    case = sys.argv[2]
    runner = sys.argv[3] if len(sys.argv) == 4 else 'codex'
    require(runner in ('codex', 'claude-code'), 'Unsupported fixed native regression runner')
    specification = importlib.util.spec_from_file_location('coding_guest_control', workspace / 'scripts/coding_guest_control.py')
    control = importlib.util.module_from_spec(specification)
    specification.loader.exec_module(control)
    task_id = str(uuid.uuid4())
    preparation = {'runner': runner, 'hash': '1' * 64, 'repositoryHash': '2' * 64, 'commitSha': '3' * 40,
                   'limits': {'timeoutSeconds': 180, 'maxCostMicros': 1000000, 'maxPatchBytes': 131072, 'maxOutputBytes': 32768}}
    document = {'request': {'taskId': task_id, 'correlationId': task_id, 'worktreeId': str(uuid.uuid4()),
                           'preparation': preparation, 'deadline': (datetime.now(timezone.utc) + timedelta(minutes=5)).isoformat()},
                'labCase': case}
    report_directory = workspace / 'artifacts/coding-native-regressions'
    report_directory.mkdir(parents=True, exist_ok=True)
    started = time.monotonic()
    print(json.dumps({'event': 'native-regression.started', 'case': case, 'runner': runner, 'taskId': task_id}), flush=True)
    with tempfile.TemporaryDirectory(prefix='godseye-coding-adversarial-') as temporary:
        source = None
        source_before = None
        expected_source_tree = None
        if case == 'attributes':
            source, commit = attribute_source(Path(temporary))
            source_before = manifest(source)
            expected_source_tree = source_tree_hash(source)
            document['labSource'] = {'sourceDirectory': str(source), 'commitSha': commit}
            preparation['commitSha'] = commit
        result = control.run(workspace, document, lab=True)
        output = (workspace / 'artifacts/tools/coding-kvm/10.2.1/root/run' / task_id / 'native-output.log').read_text()
        report = {'case': case, 'runner': runner, 'taskId': task_id, 'seconds': round(time.monotonic() - started, 3),
                  'paidCalls': 0, 'assertionsPassed': False, 'result': result}
        try:
            require(result['stopped'] is True, 'Exact native allocation has no physical stopped proof')
            require(result['grantsRevoked'] is True, 'Synthetic task grants remain active')
            require(result['workspace'] == 'retained', 'Stopped native allocation was not retained')
            fixture = result.get('fixtureState', {})
            if case == 'pids-failure':
                require('GODSEYE_POLICY_REJECTED' in output, 'No explicit guest process-policy rejection observed')
                require('guestResult' not in result, 'Untrusted code returned a result after failed pids setup')
                require(not fixture.get('requests') and not fixture.get('commands'), 'Model or shell tools ran after failed process-policy setup')
            elif case == 'test-mutation':
                require('test-mutation-installed' in output, 'Mutating check was not actually installed')
                require(fixture.get('completed') is True, 'Actual vendor CLI fixture chain did not complete')
                require('Repository changed during verification' in output, 'Test-side mutation was not rejected by exact candidate-tree verification')
                require('guestResult' not in result, 'Mutated verification tree produced accepted patch/test evidence')
            else:
                guest = result.get('guestResult', {})
                require(result['state'] == 'succeeded', 'Actual guest CLI task did not succeed')
                require(fixture.get('completed') is True, 'Actual vendor CLI fixture chain did not complete')
                require(guest.get('cli', {}).get('code') == 0 and guest.get('test', {}).get('code') == 0, 'Actual guest CLI/check exit evidence is not successful')
                require(re.fullmatch('[a-f0-9]{64}', guest.get('treeHash', '')) is not None, 'Missing exact final candidate-tree digest')
                require('+module.exports = 42;' in guest.get('patch', ''), 'Immutable-baseline patch omitted the actual answer edit')
                require(hashlib.sha256(guest['patch'].encode()).hexdigest() == guest['patchSha256'], 'Exported patch bytes differ from digest')
                if case == 'index':
                    require('mutable-index-hides-edit' in output, 'Mutable Git index did not actually conceal the edit from Git diff')
                if case == 'background':
                    for marker in ('background-writer-entered', 'background-cgroup-empty-before-check', 'background-tree-stable-after-check'):
                        require(marker in output, 'Background writer lifecycle marker missing: ' + marker)
                if case == 'attributes':
                    require('exact-attribute-tree-preserved' in output, 'Archive-attribute source equality was not checked in the actual guest')
                    require('source-tree-hash=' + expected_source_tree in output, 'Entire materialized source tree differs from the exact requested commit files')
                    require('+a/baseline/keep b/final/keep' in guest.get('patch', ''), 'Nested patch data was rewritten as if it were a patch header')
                    require(guest['commitSha'] == preparation['commitSha'], 'Guest used a different selected source commit')
                    require(manifest(source) == source_before, 'Assigned source repository bytes changed on the host')
            report['assertionsPassed'] = True
        finally:
            (report_directory / f'{runner}-{case}.json').write_text(json.dumps(report, indent=2))
        print(json.dumps({'event': 'native-regression.finished', 'case': case, 'runner': runner, 'taskId': task_id,
                          'passed': report['assertionsPassed'], 'seconds': report['seconds'], 'stopped': result['stopped']}), flush=True)


if __name__ == '__main__':
    main()
