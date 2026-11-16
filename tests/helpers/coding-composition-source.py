"""Create/remove only synthetic temporary loose-object source used by actual native composition tests."""
import hashlib
import json
from pathlib import Path
import shutil
import sys
import tempfile
import uuid
import zlib


def loose(source, kind, payload):
    content = kind.encode() + b' ' + str(len(payload)).encode() + b'\0' + payload
    digest = hashlib.sha1(content).hexdigest()
    target = source / '.git/objects' / digest[:2] / digest[2:]
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(zlib.compress(content))
    return digest


def main():
    if sys.argv[1:] == ['create']:
        root = Path(tempfile.mkdtemp(prefix='godseye-coding-composition-'))
        (root / '.owner').write_text(str(uuid.uuid4()))
        source = root / 'source'
        source.mkdir()
        files = {
            'answer.cjs': b'module.exports = 1;\n',
            'answer.test.cjs': b'const test=require("node:test");const assert=require("node:assert/strict");test("answer is corrected",()=>assert.equal(require("./answer.cjs"),42));\n',
            'package.json': b'{"private":true,"scripts":{"test":"/usr/bin/node --test answer.test.cjs"}}\n',
        }
        entries = []
        for name, payload in sorted(files.items()):
            digest = loose(source, 'blob', payload)
            entries.append(b'100644 ' + name.encode() + b'\0' + bytes.fromhex(digest))
            (source / name).write_bytes(payload)
        tree = loose(source, 'tree', b''.join(entries))
        commit = loose(source, 'commit', (f'tree {tree}\nauthor Synthetic Owner <fixture@example.invalid> 1 +0000\n'
                       'committer Synthetic Owner <fixture@example.invalid> 1 +0000\n\nActual composition fixture\n').encode())
        print(json.dumps({'root': str(root), 'sourceDirectory': str(source), 'commitSha': commit}))
        return
    if len(sys.argv) == 3 and sys.argv[1] == 'remove':
        root = Path(sys.argv[2])
        if (root.parent != Path(tempfile.gettempdir()) or not root.name.startswith('godseye-coding-composition-')
                or root.resolve() != root or not (root / '.owner').is_file()):
            raise ValueError('Refused cleanup of unowned composition source')
        shutil.rmtree(root)
        print('{"removed":true}')
        return
    raise ValueError('Unknown fixed synthetic-source operation')


if __name__ == '__main__':
    main()
