"""Independent inert-source tests; no host Git or repository code is executed."""
import hashlib
import io
import os
from pathlib import Path
import sys
import tarfile
import tempfile
import unittest
import zlib

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'scripts'))
from coding_guest_source import snapshot


def loose(source: Path, kind: str, payload: bytes) -> str:
    """Build synthetic standard Git bytes directly, without Git side effects."""
    value = kind.encode() + b' ' + str(len(payload)).encode() + b'\0' + payload
    digest = hashlib.sha1(value).hexdigest()
    target = source / '.git/objects' / digest[:2] / digest[2:]
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(zlib.compress(value))
    return digest


def repository(root: Path, name: str, content: bytes = b'before\n') -> tuple[Path, str]:
    source = root / name
    source.mkdir()
    blob = loose(source, 'blob', content)
    tree = loose(source, 'tree', b'100644 message.txt\0' + bytes.fromhex(blob))
    commit = loose(source, 'commit', (
        f'tree {tree}\nauthor Synthetic Owner <fixture@example.invalid> 1 +0000\n'
        'committer Synthetic Owner <fixture@example.invalid> 1 +0000\n\nSynthetic fixture\n'
    ).encode())
    (source / 'message.txt').write_bytes(content)
    (source / '.git/hooks').mkdir()
    (source / '.git/hooks/post-checkout').write_text('inert synthetic bytes only\n')
    (source / '.git/config').write_text('[core]\nrepositoryformatversion = 0\n')
    return source, commit


def contents(root: Path) -> dict[str, bytes]:
    return {str(path.relative_to(root)): path.read_bytes() for path in root.rglob('*') if path.is_file()}


class SourceIsolation(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory(prefix='godseye-coding-source-')
        self.root = Path(self.temporary.name)
        self.source, self.commit = repository(self.root, 'A')
        self.other, self.other_commit = repository(self.root, 'B', b'other cell\n')
        (self.root / 'sibling-canary.txt').write_bytes(b'unchanged unrelated bytes\n')

    def tearDown(self) -> None:
        # TemporaryDirectory owns exactly this newly minted root, never a repository path.
        self.temporary.cleanup()

    def test_T_AC_784_snapshot_keeps_both_sources_and_sibling_bytes_unchanged(self) -> None:
        before = contents(self.root)
        archive, receipt = snapshot(self.source, self.commit)
        self.assertEqual(contents(self.root), before)
        self.assertEqual(receipt['commitSha'], self.commit)
        self.assertEqual(receipt['archiveHash'], hashlib.sha256(archive).hexdigest())
        self.assertEqual(receipt['interpretation'], 'guest-only')
        with tarfile.open(fileobj=io.BytesIO(archive)) as staged:
            names = staged.getnames()
            self.assertEqual(len(names), 6)
            self.assertTrue(all(name.startswith('source.git/objects/') or name in ('source.git/HEAD', 'source.git/config', 'source.git/refs/heads/assigned') for name in names))
            self.assertEqual(staged.extractfile('source.git/HEAD').read(), (self.commit + '\n').encode())
            self.assertEqual(staged.extractfile('source.git/refs/heads/assigned').read(), (self.commit + '\n').encode())
            self.assertNotIn('source.git/hooks/post-checkout', names)

    def test_T_AC_784_snapshot_copies_bytes_without_sharing_writable_metadata(self) -> None:
        archive, _ = snapshot(self.source, self.commit)
        original = bytes(archive)
        target = self.source / '.git/objects' / self.commit[:2] / self.commit[2:]
        target.write_bytes(b'changed after admitted copy')
        self.assertEqual(archive, original)
        self.assertEqual((self.other / 'message.txt').read_bytes(), b'other cell\n')

    def test_T_AC_784_unreachable_canary_objects_and_other_history_are_not_staged(self) -> None:
        unreachable = loose(self.source, 'blob', b'Unreachable synthetic history must not enter task\n')
        other_tree = loose(self.source, 'tree', b'100644 old.txt\0' + bytes.fromhex(unreachable))
        old_commit = loose(self.source, 'commit', f'tree {other_tree}\n\nUnassigned synthetic history\n'.encode())
        archive, receipt = snapshot(self.source, self.commit)
        with tarfile.open(fileobj=io.BytesIO(archive)) as staged:
            names = staged.getnames()
            for digest in (unreachable, other_tree, old_commit):
                self.assertNotIn('source.git/objects/' + digest[:2] + '/' + digest[2:], names)
            self.assertEqual(len(names), 6)
        self.assertEqual(receipt['files'], 6)

    def test_T_AC_782_missing_reachable_tree_object_cannot_be_replaced_by_unrelated_objects(self) -> None:
        missing = 'f' * 40
        invalid_commit = loose(self.source, 'commit', f'tree {missing}\n\nSynthetic missing tree\n'.encode())
        with self.assertRaises(ValueError):
            snapshot(self.source, invalid_commit)

    def test_T_AC_782_refuses_missing_or_corrupt_requested_commit(self) -> None:
        with self.assertRaises(ValueError):
            snapshot(self.source, 'f' * 40)
        target = self.source / '.git/objects' / self.commit[:2] / self.commit[2:]
        target.write_bytes(zlib.compress(b'commit 8\0tampered'))
        with self.assertRaises(ValueError):
            snapshot(self.source, self.commit)

    def test_T_AC_784_refuses_linked_source_registration(self) -> None:
        link = self.root / 'linked-A'
        link.symlink_to(self.source, target_is_directory=True)
        with self.assertRaises(ValueError):
            snapshot(link, self.commit)

    def test_T_AC_784_refuses_shared_alternate_objects(self) -> None:
        info = self.source / '.git/objects/info'
        info.mkdir()
        (info / 'alternates').write_text(str(self.other / '.git/objects'))
        with self.assertRaises(ValueError):
            snapshot(self.source, self.commit)

    def test_T_AC_784_refuses_object_symlinks_and_preserves_other_source(self) -> None:
        before = contents(self.other)
        object_path = self.source / '.git/objects' / self.commit[:2] / self.commit[2:]
        object_path.unlink()
        object_path.symlink_to(self.other / 'message.txt')
        with self.assertRaises(ValueError):
            snapshot(self.source, self.commit)
        self.assertEqual(contents(self.other), before)

    def test_T_AC_784_refuses_hardlinked_objects(self) -> None:
        object_path = self.source / '.git/objects' / self.commit[:2] / self.commit[2:]
        backup = self.root / 'shared-object-copy'
        os.link(object_path, backup)
        with self.assertRaises(ValueError):
            snapshot(self.source, self.commit)
        self.assertEqual(backup.read_bytes(), object_path.read_bytes())

    def test_T_AC_781_refuses_mutable_refs_and_relative_registration(self) -> None:
        for ref in ('main', '../A', 'a' * 39, 'A' * 40):
            with self.subTest(ref=ref), self.assertRaises(ValueError):
                snapshot(self.source, ref)
        with self.assertRaises(ValueError):
            snapshot(Path('relative-fixture'), self.commit)


if __name__ == '__main__':
    unittest.main(verbosity=2)
