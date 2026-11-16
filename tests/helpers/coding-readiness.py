"""Independent pure readiness/allocation policy tests; all host facts and VM probes are synthetic."""
import copy
from contextlib import redirect_stdout
import hashlib
import importlib.util
import io
import json
from pathlib import Path
from types import SimpleNamespace
import unittest
import tempfile
from unittest.mock import patch
import uuid

workspace = Path(__file__).resolve().parents[2]
specification = importlib.util.spec_from_file_location('coding_guest_control', workspace / 'scripts/coding_guest_control.py')
control = importlib.util.module_from_spec(specification)
specification.loader.exec_module(control)


def profile():
    return {'version': 'local-coding-host-v1', 'kernel': 'synthetic-microsoft-standard-WSL2', 'architecture': 'x86_64',
            'machineHash': 'a' * 64, 'kvm': {'major': 10, 'minor': 232, 'group': 101},
            'controllers': ['cpu', 'memory', 'pids'],
            'policy': {'guestMemoryMiB': 4096, 'vmmMemoryMiB': 5120, 'cpuMilliCores': 1000, 'outerPids': 64, 'guestPids': 64}}


class ReadinessPolicy(unittest.TestCase):
    def test_T_AC_787_same_qualified_host_profile_survives_a_host_boot_change(self):
        current = profile()
        proof = {'hostProfile': copy.deepcopy(current), 'bootId': 'earlier-synthetic-boot'}
        self.assertTrue(control.qualification_host_matches(proof, current))

    def test_T_AC_787_changed_host_kernel_refuses_old_software_qualification(self):
        current = profile()
        proof = {'hostProfile': copy.deepcopy(current)}
        current['kernel'] = 'different-unqualified-kernel'
        self.assertFalse(control.qualification_host_matches(proof, current))

    def test_T_AC_787_changed_machine_refuses_old_software_qualification(self):
        current = profile()
        proof = {'hostProfile': copy.deepcopy(current)}
        current['machineHash'] = 'b' * 64
        self.assertFalse(control.qualification_host_matches(proof, current))

    def test_T_AC_787_changed_resource_policy_refuses_old_qualification(self):
        current = profile()
        proof = {'hostProfile': copy.deepcopy(current)}
        current['policy']['guestPids'] = 128
        self.assertFalse(control.qualification_host_matches(proof, current))

    def test_T_AC_787_changed_KVM_device_or_controllers_refuses_old_qualification(self):
        for change in ({'kvm': {'major': 10, 'minor': 233, 'group': 101}}, {'controllers': ['cpu', 'memory']}):
            current = profile()
            proof = {'hostProfile': copy.deepcopy(current)}
            current.update(change)
            self.assertFalse(control.qualification_host_matches(proof, current))

    def test_T_AC_787_current_KVM_probe_failure_blocks_readiness_without_creating_a_VM(self):
        for response in (SimpleNamespace(returncode=1, stdout=''),
                         SimpleNamespace(returncode=0, stdout=json.dumps({'uid': 1000, 'api': 12, 'created': False}))):
            with patch.object(control, 'host_profile', return_value=profile()), patch.object(control.subprocess, 'run', return_value=response):
                with self.assertRaises(ValueError):
                    control.probe_current_kvm()

    def test_T_AC_787_current_probe_requires_the_exact_nonroot_KVM_observation(self):
        response = SimpleNamespace(returncode=0, stdout=json.dumps({'uid': 1000, 'api': 12, 'created': True}))
        with patch.object(control, 'host_profile', return_value=profile()), patch.object(control.subprocess, 'run', return_value=response) as probe:
            control.probe_current_kvm()
            self.assertEqual(probe.call_count, 1)
        response.stdout = json.dumps({'uid': 0, 'api': 12, 'created': True})
        with patch.object(control, 'host_profile', return_value=profile()), patch.object(control.subprocess, 'run', return_value=response):
            with self.assertRaises(ValueError):
                control.probe_current_kvm()

    def test_T_AC_789_allocation_stop_still_refuses_a_different_boot_before_inspecting_services(self):
        task_id = str(uuid.uuid4())
        unit = 'godseye-coding-' + task_id + '.service'
        allocation = {'taskId': task_id, 'unit': unit, 'cgroup': '/system.slice/' + unit,
                      'invocationId': 'a' * 32, 'bootId': 'earlier-synthetic-boot'}
        with patch.object(Path, 'read_text', return_value='new-synthetic-boot'), patch.object(control, 'properties') as inspection:
            self.assertFalse(control.stopped(allocation))
            inspection.assert_not_called()


class AvailabilityAndDispatchBoundary(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix='godseye-coding-readiness-')
        self.workspace = Path(self.temporary.name)
        self.cache = self.workspace / 'artifacts/tools/coding-kvm/10.2.1'
        self.native_asset = self.cache / 'root/usr/bin/qemu'
        self.native_asset.parent.mkdir(parents=True)
        self.native_asset.write_bytes(b'changed synthetic native asset')
        expected = hashlib.sha256(b'expected pinned bytes').hexdigest()
        (self.cache / 'provenance.json').write_text(json.dumps({'files': {'usr/bin/qemu': {'sha256': expected}}}))
        self.cli_asset = self.workspace / 'synthetic-cli'
        self.cli_asset.write_bytes(b'changed synthetic CLI asset')
        directory = self.workspace / 'artifacts/tools/coding-cli'
        directory.mkdir(parents=True)
        (directory / 'manifest.json').write_text(json.dumps({'observedVersions': {'codex': 'synthetic', 'claude': 'synthetic'},
            'entries': [{'absoluteGuestPath': '/usr/bin/claude', 'absoluteSourcePath': str(self.cli_asset), 'sha256': expected}]}))
        (self.cache / 'claude-code-qualification.json').write_text(json.dumps({'stopped': True, 'state': 'succeeded',
            'fixtureState': {'completed': True}, 'hostProfile': profile(),
            'receipt': {'pinnedRuntimeHash': 'a' * 64, 'guestImageHash': 'b' * 64}}))
    def tearDown(self):
        self.temporary.cleanup()
    def module(self, name):
        specification = importlib.util.spec_from_file_location(name, workspace / 'scripts' / (name + '.py'))
        module = importlib.util.module_from_spec(specification)
        specification.loader.exec_module(module)
        return module

    def test_T_AC_787_actual_server_readiness_does_not_bulk_read_assets_or_launch_guest(self):
        document = {'bindings': [{'runner': 'claude-code', 'broker': {}}]}
        output = io.StringIO()
        original_text = Path.read_text
        original_bytes = Path.read_bytes
        def read_text(path, *args, **kwargs):
            return 'MemAvailable: 8388608 kB\n' if path == Path('/proc/meminfo') else original_text(path, *args, **kwargs)
        def read_bytes(path):
            if path in (self.native_asset, self.cli_asset):
                raise AssertionError('Availability attempted a bulk executable asset read')
            return original_bytes(path)
        with patch.object(control.sys, 'argv', ['synthetic-controller', str(self.workspace), 'readiness']), \
             patch.object(control.sys, 'stdin', SimpleNamespace(buffer=io.BytesIO((json.dumps(document) + '\n').encode()))), \
             patch.object(control.os, 'getuid', return_value=1000), \
             patch.object(control, 'host_profile', return_value=profile()), \
             patch.object(control, 'probe_current_kvm') as probe, \
             patch.object(control, 'load', return_value=SimpleNamespace(validate=lambda *args: None)), \
             patch.object(control, 'receipt', return_value={'pinnedRuntimeHash': 'a' * 64, 'guestImageHash': 'b' * 64}), \
             patch.object(Path, 'read_text', read_text), patch.object(Path, 'read_bytes', read_bytes), redirect_stdout(output):
            control.main()
        self.assertTrue(json.loads(output.getvalue())['available'])
        self.assertEqual(probe.call_count, 1)

    def test_T_AC_787_actual_guest_builder_rejects_corrupt_CLI_before_any_dispatch(self):
        task = self.module('coding_guest_task')
        with patch.object(task.os, 'getuid', return_value=1000), patch.object(task, 'write_archive') as archive, \
             patch.object(task.subprocess, 'run') as dispatch:
            for runner in ('claude-code', 'codex'):
                with self.subTest(runner=runner), self.assertRaisesRegex(ValueError, 'Guest asset differs'):
                    task.build(self.workspace, str(uuid.uuid4()), runner)
            archive.assert_not_called()
            dispatch.assert_not_called()

    def test_T_AC_787_actual_native_jail_rejects_corrupt_VMM_before_any_mount_or_exec(self):
        lab = self.module('coding_guest_lab')
        with patch.object(lab.subprocess, 'run') as dispatch:
            with self.assertRaisesRegex(ValueError, 'Runtime bytes changed'):
                lab.jail(self.cache)
            dispatch.assert_not_called()

    def test_T_AC_789_privileged_launch_never_inherits_controller_authorization_stdin(self):
        class LaunchObserved(Exception):
            pass
        task_id = str(uuid.uuid4())
        native_directory = Path('/tmp') / ('godseye-coding-broker-' + task_id)
        request = {'taskId': task_id, 'correlationId': task_id, 'worktreeId': str(uuid.uuid4()),
                   'preparation': {'runner': 'claude-code'}, 'deadline': '2026-11-14T23:59:59Z'}
        def build(*args):
            directory = self.cache / 'root/run' / task_id
            directory.mkdir(parents=True)
            (directory / 'broker').mkdir()
            return {'imageHash': 'a' * 64}
        def launch(command, **options):
            self.assertIs(options.get('stdin'), control.subprocess.DEVNULL)
            raise LaunchObserved()
        original_stat = control.os.stat
        def metadata(path, *args, **kwargs):
            return SimpleNamespace(st_gid=101) if str(path) == '/dev/kvm' else original_stat(path, *args, **kwargs)
        endpoint = SimpleNamespace(bind=lambda *args: None, listen=lambda *args: None, settimeout=lambda *args: None)
        try:
            with patch.object(control, 'load', side_effect=lambda name, path: SimpleNamespace(build=build) if name == 'coding_guest_task' else SimpleNamespace()), \
                 patch.object(control, 'receipt', return_value={}), patch.object(control, 'host_profile', return_value=profile()), \
                 patch.object(control, 'source_hashes', return_value={'synthetic-source': 'a' * 64}), \
                 patch.object(control.os, 'stat', side_effect=metadata), patch.object(control.socket, 'socket', return_value=endpoint), \
                 patch.object(control.subprocess, 'Popen', side_effect=launch):
                with self.assertRaises(LaunchObserved):
                    control.run(self.workspace, {'request': request}, lab=True)
        finally:
            if native_directory.exists():
                native_directory.rmdir()

    def test_T_AC_789_confirmed_stop_retains_owned_workspace_and_inspection_remains_read_only(self):
        for physically_stopped, overrides, expected in (
            (True, {}, 'retained'), (False, {}, 'quarantined'),
            (True, {'reason': 'Integrity observation changed'}, 'quarantined'),
            (True, {'launchIntended': False}, 'quarantined'),
            (True, {'imageHash': None}, 'quarantined'),
            (True, {'imageHash': 'invalid'}, 'quarantined'),
            (True, {'workspace': 'released'}, 'released'),
            (True, {'workspace': 'retained'}, 'retained')):
            with self.subTest(stopped=physically_stopped, overrides=overrides):
                task_id = str(uuid.uuid4())
                request = {'taskId': task_id, 'correlationId': task_id}
                unit = 'godseye-coding-' + task_id + '.service'
                directory = self.cache / 'root/run' / task_id
                directory.mkdir(parents=True)
                path = directory / 'state.json'
                path.write_text(json.dumps({'taskId': task_id, 'unit': unit, 'cgroup': '/system.slice/' + unit,
                    'invocationId': 'a' * 32, 'bootId': 'synthetic-boot', 'state': 'unknown', 'stopped': False,
                    'workspace': 'quarantined', 'grantsRevoked': False,
                    'launchIntended': True, 'imageHash': 'b' * 64, **overrides,
                    'requestHash': control.digest(json.dumps(request, sort_keys=True).encode())}))
                actual_read = Path.read_text
                def read_text(selected, *args, **kwargs):
                    return 'synthetic-boot' if selected == Path('/proc/sys/kernel/random/boot_id') else actual_read(selected, *args, **kwargs)
                def invoke(action):
                    output = io.StringIO()
                    with patch.object(control.sys, 'argv', ['synthetic-controller', str(self.workspace), action]), \
                         patch.object(control.sys, 'stdin', SimpleNamespace(buffer=io.BytesIO(json.dumps({'request': request}).encode()))), \
                         patch.object(control.os, 'getuid', return_value=1000), \
                         patch.object(control, 'stopped', return_value=physically_stopped), \
                         patch.object(control, 'properties', return_value={'InvocationID': 'a' * 32}), \
                         patch.object(control.subprocess, 'run'), patch.object(Path, 'read_text', read_text), redirect_stdout(output):
                        control.main()
                    return json.loads(output.getvalue())
                stopped = invoke('stop')
                self.assertEqual(stopped['state'], 'cancelled' if physically_stopped else 'unknown')
                self.assertEqual(stopped['workspace'], expected)
                self.assertTrue(stopped['grantsRevoked'])
                before = path.read_bytes()
                inspected = invoke('inspect')
                self.assertEqual(inspected['stopped'], physically_stopped)
                self.assertEqual(path.read_bytes(), before)


if __name__ == '__main__':
    unittest.main(verbosity=2)
