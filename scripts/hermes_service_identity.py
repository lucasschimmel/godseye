"""Service-user identity for the Hermes tools runtime, derived from the running user (never hardcoded)."""
import os

# Identity inside the gVisor sandbox is fixed and independent of the host service uid.
SANDBOX_UID = 1000


def service_uid(actual: int | None = None, declared: str | None = None) -> int:
    """Return the unprivileged running uid. GODSEYE_SERVICE_UID, when set, must equal it."""
    uid = os.getuid() if actual is None else actual
    wanted = os.environ.get('GODSEYE_SERVICE_UID') if declared is None else declared
    if uid <= 0:
        raise ValueError('Hermes tools require an unprivileged service user')
    if wanted not in (None, '') and (not str(wanted).isdigit() or int(wanted) != uid):
        raise ValueError('Declared service uid differs from the running user')
    return uid


def runtime_directory(uid: int) -> str:
    return f'/run/user/{uid}'


def user_manager_cgroup(uid: int) -> str:
    return f'/user.slice/user-{uid}.slice/user@{uid}.service'


def environment(uid: int) -> dict:
    return {'PATH': '/usr/bin:/bin', 'LC_ALL': 'C', 'XDG_RUNTIME_DIR': runtime_directory(uid),
            'DBUS_SESSION_BUS_ADDRESS': f'unix:path={runtime_directory(uid)}/bus'}
