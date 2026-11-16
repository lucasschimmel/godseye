"""Bounded prerequisite check for the Hermes gateway / tools worker systemd readiness units.

It starts no model, container or network request. It only verifies that the native Linux prerequisites
the request-scoped helpers rely on are present, so a systemd restart/backoff loop can gate the control API.
"""
import os
from pathlib import Path
import stat
import sys

sys.path.insert(0, str(Path(__file__).resolve().parent))  # run with -I, which omits the script directory
from hermes_service_identity import runtime_directory, service_uid, user_manager_cgroup


def check(kind: str, workspace: Path) -> None:
    if sys.platform != 'linux':
        raise ValueError('Hermes readiness requires native Linux')
    uid = service_uid()
    if not workspace.is_absolute() or workspace.resolve(strict=True) != workspace:
        raise ValueError('Workspace must be an unlinked absolute directory')
    private = workspace / '.local'
    if private.exists() and (private.stat().st_uid != uid or stat.S_IMODE(private.stat().st_mode) & 0o077):
        raise ValueError('Private workspace state is not owner-only')
    if not (workspace / f'scripts/hermes_{"gateway" if kind == "gateway" else "tools_worker"}.py').is_file():
        raise ValueError('Hermes helper script is missing')
    if kind == 'tools':
        group = Path('/sys/fs/cgroup' + user_manager_cgroup(uid))
        controllers = set((group / 'cgroup.controllers').read_text().split()) if group.is_dir() else set()
        if not {'cpu', 'memory', 'pids'} <= controllers or not os.access(group, os.W_OK):
            raise ValueError('Delegated user cgroup controllers are unavailable')
        if not Path(runtime_directory(uid) + '/bus').is_socket():
            raise ValueError('User bus is unavailable')


def main() -> None:
    if len(sys.argv) != 3 or sys.argv[1] not in ('gateway', 'tools'):
        raise ValueError('Usage: hermes_ready_check.py gateway|tools WORKSPACE')
    check(sys.argv[1], Path(sys.argv[2]))
    print('ready')


if __name__ == '__main__':
    try:
        main()
    except (OSError, ValueError) as error:
        print(str(error)[:256], file=sys.stderr)
        sys.exit(1)
