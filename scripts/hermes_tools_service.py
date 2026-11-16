"""Trusted pre-exec check inside an already hard-capped operator-owned user service."""
import os
from pathlib import Path
import sys


def main() -> None:
    group = Path('/sys/fs/cgroup') / Path('/proc/self/cgroup').read_text().strip().split('::', 1)[1].lstrip('/')
    actual = {name: (group / name).read_text().strip() for name in ('memory.max', 'memory.swap.max', 'cpu.max', 'pids.max')}
    if actual != {'memory.max': '536870912', 'memory.swap.max': '0', 'cpu.max': '50000 100000', 'pids.max': '128'}:
        raise RuntimeError('Effective tool service controls differ')
    executable, state, bundle, container = sys.argv[1:]
    os.environ.clear()
    os.environ.update({'PATH': '/usr/bin:/bin', 'LC_ALL': 'C'})
    arguments = ['/usr/bin/unshare', '--user', '--map-root-user', '--mount', '--net', '--fork',
                 executable, '--root', state, '--platform=systrap', '--network=none',
                 '--gvisor-marker-file=true', '--ignore-cgroups=true', 'run', '--bundle', bundle, container]
    # ignore-cgroups applies only to nested runsc: this exec and every descendant
    # already belongs to the exact verified outer CPU/memory/pids hard-capped group.
    os.execv(arguments[0], arguments)


if __name__ == '__main__':
    main()
