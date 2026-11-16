"""SSH forced-command gate for the work-VM coding bridge.

Installed as `command="..."` on the control API's key in the service user's authorized_keys, so that key
can do exactly one thing: start the fixed control bridge with one of the fixed production actions. The
laboratory action, a shell, port forwarding and every other command are refused. The caller's requested
command line (SSH_ORIGINAL_COMMAND) must equal the one argv the control API's transport sends.
"""
import os
import shlex
import sys

WORKSPACE = '/opt/godseye'
ACTIONS = ('readiness', 'source', 'preflight', 'run', 'inspect', 'stop')
ENVIRONMENT = ('PATH=/usr/bin:/bin', 'LC_ALL=C', 'GODSEYE_CODING_PROFILE=work-vm')


def expected(action: str, workspace: str = WORKSPACE) -> list[str]:
    return ['/usr/bin/env', '-i', *ENVIRONMENT, '/usr/bin/python3', '-I',
            f'{workspace}/scripts/coding_work_vm_control.py', workspace, action]


def permitted(original: str | None, workspace: str = WORKSPACE) -> list[str]:
    """Return the exact argv to execute or raise ValueError; nothing is ever passed to a shell."""
    if not original or len(original) > 1024 or any(ord(char) < 32 or ord(char) > 126 for char in original):
        raise ValueError('Coding gate refused an empty, oversized or non-printable command')
    arguments = shlex.split(original)
    for action in ACTIONS:
        if arguments == expected(action, workspace):
            return arguments
    raise ValueError('Coding gate refused a command outside the fixed bridge actions')


def main() -> None:
    try:
        arguments = permitted(os.environ.get('SSH_ORIGINAL_COMMAND'))
    except ValueError as error:
        print(str(error), file=sys.stderr)
        sys.exit(126)
    os.execv(arguments[0], arguments)


if __name__ == '__main__':
    main()
