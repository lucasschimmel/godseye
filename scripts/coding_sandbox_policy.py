"""Pure policy for the work-VM per-task gVisor sandbox.

Nothing here touches the filesystem or starts a process, so every invariant is unit-testable. The
trusted host runner builds an OCI bundle with `oci_config` and refuses to launch anything that
`validate_oci` rejects. This is the weaker 'disposable-vm-container' boundary: tasks share the work VM's
kernel behind gVisor's user-space kernel, with no network at all and a read-only, allowlisted view of the
host (the broker is reached only over the control channel on stdio).
"""
import re
import uuid

SANDBOX_UID = 1000
SANDBOX_GID = 1000
# Host-enforced task envelope (systemd unit properties) and sandbox-internal ceilings. The memory figure
# includes gVisor's own overhead and every tmpfs byte, because the sentry backs tmpfs with host memory.
LIMITS = {'memoryMiB': 2048, 'cpuMilliCores': 1000, 'maxProcesses': 512, 'diskMiB': 1024,
          'hostTasksMax': 512, 'runtimeSeconds': 180, 'openFiles': 1024}
# Only these capabilities exist inside the sandbox, and only for the root-owned worker; every repository
# command is spawned as the unprivileged uid with an empty capability set.
WORKER_CAPABILITIES = ('CAP_CHOWN', 'CAP_DAC_OVERRIDE', 'CAP_FOWNER', 'CAP_KILL', 'CAP_SETGID', 'CAP_SETUID')
TMPFS = (('/tmp', 128, '1777'), ('/dev/shm', 64, '1777'), ('/home/runner', 128, '0755'),
         ('/seed', 128, '0755'), ('/workspace', 128, '0755'), ('/verification', 640, '0700'))
READ_ONLY_BINDS = ('/usr', '/opt/coding', '/coding', '/task.json', '/source.git')
ADVERSARIAL_CASES = ('index', 'test-mutation', 'background', 'attributes', 'escape', 'egress',
                     'exhaust-memory', 'exhaust-pids', 'exhaust-disk', 'hang')
PERMITTED_CASES = ('index', 'test-mutation', 'background', 'pids-failure', 'attributes') + ADVERSARIAL_CASES[4:]


def task_identity(task_id: str) -> str:
    if str(uuid.UUID(task_id)) != task_id:
        raise ValueError('Invalid exact task identity')
    return task_id


def unit_name(task_id: str) -> str:
    return 'godseye-coding-' + task_identity(task_id) + '.service'


def container_id(task_id: str) -> str:
    return 'gse-code-' + task_identity(task_id)


def unit_cgroup(uid: int, unit: str) -> str:
    """Exact cgroup of a transient unit started in the service user's systemd manager."""
    if uid <= 0 or not re.fullmatch(r'godseye-coding-[0-9a-f-]{36}\.service', unit):
        raise ValueError('Invalid unit identity')
    return f'/user.slice/user-{uid}.slice/user@{uid}.service/app.slice/{unit}'


def user_environment(uid: int) -> dict:
    """Fixed environment for talking to the service user's systemd manager (never ambient)."""
    if uid <= 0:
        raise ValueError('Sandbox control requires an unprivileged service user')
    return {'PATH': '/usr/bin:/bin', 'LC_ALL': 'C', 'XDG_RUNTIME_DIR': f'/run/user/{uid}',
            'DBUS_SESSION_BUS_ADDRESS': f'unix:path=/run/user/{uid}/bus'}


def memory_bytes(limits: dict = LIMITS) -> int:
    return limits['memoryMiB'] * 1024 * 1024


def unit_properties(unit: str, deadline_seconds: int, limits: dict = LIMITS) -> list[str]:
    """Hard host caps enforced by the user manager regardless of anything inside the sandbox."""
    seconds = max(1, min(int(deadline_seconds), limits['runtimeSeconds']))
    return ['--property=Type=exec', f'--property=MemoryMax={limits["memoryMiB"]}M', '--property=MemorySwapMax=0',
            f'--property=CPUQuota={limits["cpuMilliCores"] // 10}%', f'--property=TasksMax={limits["hostTasksMax"]}',
            f'--property=RuntimeMaxSec={seconds}', '--property=KillMode=control-group',
            '--property=OOMPolicy=kill', '--property=NoNewPrivileges=yes', '--unit=' + unit]


def expected_controls(limits: dict = LIMITS) -> dict:
    """What the in-unit pre-exec check must observe before the sandbox is started."""
    return {'memory.max': str(memory_bytes(limits)), 'memory.swap.max': '0',
            'cpu.max': f'{limits["cpuMilliCores"] * 100} 100000', 'pids.max': str(limits['hostTasksMax'])}


def runsc_arguments(executable: str, state: str, bundle: str, container: str) -> list[str]:
    """Rootless systrap sandbox with no network; cgroup limits belong to the outer verified unit."""
    return ['/usr/bin/unshare', '--user', '--map-root-user', '--mount', '--net', '--fork',
            executable, '--root', state, '--platform=systrap', '--network=none', '--gvisor-marker-file=true',
            '--ignore-cgroups=true', 'run', '--bundle', bundle, container]


def _tmpfs(destination: str, size_mib: int, mode: str) -> dict:
    return {'destination': destination, 'type': 'tmpfs', 'source': 'tmpfs',
            'options': ['nosuid', 'nodev', f'size={size_mib}m', f'mode={mode}']}


def oci_config(rootfs: str, binds: dict, task_id: str, limits: dict = LIMITS) -> dict:
    """OCI runtime configuration. `binds` maps each read-only destination to its absolute host source."""
    if set(binds) != set(READ_ONLY_BINDS):
        raise ValueError('Sandbox bind set differs from policy')
    caps = list(WORKER_CAPABILITIES)
    mounts = [{'destination': '/proc', 'type': 'proc', 'source': 'proc'},
              {'destination': '/dev', 'type': 'tmpfs', 'source': 'tmpfs', 'options': ['nosuid', 'size=1m', 'mode=755']}]
    mounts += [{'destination': destination, 'type': 'bind', 'source': binds[destination],
                'options': ['rbind', 'ro', 'nosuid', 'nodev']} for destination in READ_ONLY_BINDS]
    mounts += [_tmpfs(*entry) for entry in TMPFS]
    return {'ociVersion': '1.2.0', 'root': {'path': rootfs, 'readonly': True}, 'hostname': 'godseye-task',
            'process': {'terminal': False, 'user': {'uid': 0, 'gid': 0},
                        'args': ['/usr/bin/node', '/coding/worker.mjs'],
                        'env': ['PATH=/usr/bin:/bin:/opt/coding', 'LC_ALL=C.UTF-8', 'HOME=/home/runner'],
                        'cwd': '/', 'noNewPrivileges': True,
                        'capabilities': {'bounding': caps, 'effective': caps, 'permitted': caps,
                                         'inheritable': [], 'ambient': []},
                        'rlimits': [{'type': 'RLIMIT_NOFILE', 'hard': limits['openFiles'], 'soft': limits['openFiles']}]},
            'mounts': mounts,
            'linux': {'namespaces': [{'type': name} for name in ('pid', 'ipc', 'uts', 'mount', 'network')],
                      'resources': {'memory': {'limit': memory_bytes(limits)}}}}


def validate_oci(config: dict, binds: dict | None = None) -> None:
    """Reject any bundle that widens the sandbox beyond the reviewed allowlist."""
    process = config['process']
    if process['user'] != {'uid': 0, 'gid': 0} or process.get('noNewPrivileges') is not True or process.get('terminal'):
        raise ValueError('Sandbox process identity differs from policy')
    if not set(process['capabilities']['bounding']) <= set(WORKER_CAPABILITIES) or process['capabilities']['ambient']:
        raise ValueError('Sandbox capabilities exceed policy')
    namespaces = {entry['type']: entry.get('path') for entry in config['linux']['namespaces']}
    if set(namespaces) != {'pid', 'ipc', 'uts', 'mount', 'network'} or any(namespaces.values()):
        raise ValueError('Sandbox must create fresh namespaces, including an empty network namespace')
    if config['root'].get('readonly') is not True:
        raise ValueError('Sandbox root must be read-only')
    seen = set()
    for mount in config['mounts']:
        destination = mount['destination']
        if destination in seen:
            raise ValueError('Duplicate sandbox mount')
        seen.add(destination)
        if mount['type'] == 'bind':
            options = mount.get('options', [])
            if destination not in READ_ONLY_BINDS or 'ro' not in options or 'rw' in options:
                raise ValueError('Writable or unreviewed sandbox bind refused')
            if binds is not None and mount['source'] != binds[destination]:
                raise ValueError('Sandbox bind source differs')
            if destination == '/usr' and mount['source'] != '/usr':
                raise ValueError('Only the host system tree is shared at /usr')
        elif mount['type'] not in ('proc', 'tmpfs'):
            raise ValueError('Unreviewed sandbox mount type')
    limit = config['linux']['resources']
    if not limit.get('memory', {}).get('limit'):
        raise ValueError('Sandbox memory ceiling is absent')


def verdict_for_case(case: str, markers: dict) -> dict:
    """Judge one adversarial case from guest markers and host observations; missing evidence fails."""
    ceiling = LIMITS['hostTasksMax']
    checks = {
        'escape': lambda m: m.get('hostFilesVisible') == [] and m.get('writesSucceeded') == [] and m.get('privilegedOps') == [] and m.get('uid') == SANDBOX_UID,
        'egress': lambda m: m.get('connected') == [] and m.get('interfaces') == ['lo'] and m.get('routes') == 0,
        'exhaust-memory': lambda m: m.get('reachedLimit') is True and m.get('peakMemoryBytes', 1 << 62) <= memory_bytes() * 1.05,
        'exhaust-pids': lambda m: (m.get('peakPids', 1 << 30) <= ceiling and m.get('forked', 400) < 400
                                   and (m.get('refused') is True or m.get('sandboxEnded') is True)),
        'exhaust-disk': lambda m: m.get('refused') == 'ENOSPC' and m.get('written', 1 << 40) <= 640 * 1024 * 1024,
        'hang': lambda m: m.get('started') is True and m.get('sandboxEnded') is True,
    }
    check = checks.get(case)
    return {'case': case, 'passed': bool(check and check(markers)), 'markers': markers}
