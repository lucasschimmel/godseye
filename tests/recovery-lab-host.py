"""Disposable native recovery laboratory. Private generated material enters only via stdin."""

import json
import hashlib
import os
import re
from pathlib import Path
import shutil
import socket
import subprocess
import sys
import tempfile
import time

REQUEST = json.load(sys.stdin)
PG = Path(REQUEST["pgTool"])
BACKREST = Path(REQUEST["backrestTool"])
BIN = PG / "usr/lib/postgresql/18/bin"
ENV = {**os.environ, "LD_LIBRARY_PATH": str(BACKREST / "usr/lib/x86_64-linux-gnu") + ":" + str(PG / "usr/lib/x86_64-linux-gnu")}
ENV.update({"PGBACKREST_REPO1_CIPHER_PASS": REQUEST.get("cipher", ""), "PGPASSWORD": REQUEST.get("admin", "")})


def run(args: list[str | Path], *, required: bool = True, timeout: int = 120) -> subprocess.CompletedProcess:
    """Execute fixed tools without a shell; diagnostics never expose input material."""
    result = subprocess.run([str(arg) for arg in args], env=ENV, capture_output=True, text=True, errors="replace", timeout=timeout)
    if required and result.returncode:
        # Only fixed diagnostic categories cross the process boundary.
        categories = ("non-empty", "not empty", "checksum", "unable to find", "archive", "password authentication failed", "permission denied", "invalid option", "does not exist", "recovery ended before", "must be empty")
        combined = result.stdout + result.stderr
        hints = [word for word in categories if word in combined.lower()]
        options = re.findall(r"option '([a-z0-9-]+)'", combined)
        raise RuntimeError("Native recovery lab command failed: " + Path(str(args[0])).name + " operation=" + str(args[-1]) + " code=" + str(result.returncode) + " categories=" + ",".join(hints) + " options=" + ",".join(options))
    return result


def owned(value: str) -> Path:
    """Only this user's marked, direct temporary children may be inspected or removed."""
    root = Path(value)
    if root.parent != Path(tempfile.gettempdir()) or not root.name.startswith("godseye-recovery-lab-") or root.resolve() != root or root.stat().st_uid != os.getuid() or not (root / ".godseye-owned").is_file():
        raise RuntimeError("Refusing a non-owned recovery laboratory path")
    return root


def port() -> int:
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


def settings(directory: Path, number: int, archive: str = "") -> str:
    """Keep all server authority on a private Unix socket; TCP has no admitted role."""
    values = {"listen_addresses": "", "port": str(number), "unix_socket_directories": str(directory), "unix_socket_permissions": "0700", "shared_buffers": "16MB", "max_connections": "16", "wal_level": "replica", "archive_mode": "on" if archive else "off", "archive_command": archive, "max_wal_size": "128MB", "checkpoint_timeout": "30s", "checkpoint_completion_target": "0.1", "logging_collector": "off", "log_statement": "none", "hot_standby": "on"}
    return "\n".join(key + " = '" + str(value).replace("'", "''") + "'" for key, value in values.items()) + "\n"


def start(cell: Path) -> bool:
    result = run([BIN / "pg_ctl", "-D", cell / "data", "-l", cell / "postgres.log", "-w", "-t", "15", "start"], required=False, timeout=25)
    return result.returncode == 0


def stop(cell: Path) -> None:
    if (cell / "data/postmaster.pid").exists():
        run([BIN / "pg_ctl", "-D", cell / "data", "-m", "immediate", "-w", "stop"], required=False)


def configure_destination(cell: Path) -> int:
    number = port()
    (cell / ".target-port").write_text(str(number))
    (cell / "data/postgresql.conf").write_text(settings(cell, number))
    (cell / "data/pg_hba.conf").write_text("local all lab_admin scram-sha-256\nlocal all all reject\nhost all all 0.0.0.0/0 reject\nhost all all ::/0 reject\n")
    return number


def cell_name(name: str) -> str:
    if name not in ("source", "target", "missing-wal", "unreachable", "wrong-repo", "wrong-stanza", "source-identity", "corrupt", "nonempty"):
        raise RuntimeError("Unsupported fixed laboratory cell")
    return name


def main() -> dict:
    """Bounded fixed operation dispatcher; lab code never uses a production data directory."""
    action = REQUEST["action"]
    if action == "allocate":
        root = Path(tempfile.mkdtemp(prefix="godseye-recovery-lab-"))
        (root / ".godseye-owned").write_text("disposable native PostgreSQL recovery laboratory")
        for name in ("source", "config", "include", "repository", "lock", "log"):
            (root / name).mkdir(mode=0o700)
        return {"root": str(root), "port": port()}
    root = owned(REQUEST["root"])
    if action == "source":
        source = root / "source"
        temporary = source / "bootstrap.pass"
        temporary.write_text(REQUEST["admin"])
        temporary.chmod(0o600)
        try:
            run([BIN / "initdb", "-D", source / "data", "-X", source / "wal", "-L", PG / "usr/share/postgresql/18", "--no-locale", "--encoding=UTF8", "--username=lab_admin", "--auth-local=scram-sha-256", "--auth-host=reject", "--pwfile=" + str(temporary)])
        finally:
            temporary.unlink()
        (root / "config/pgbackrest.conf").write_text(REQUEST["config"])
        (root / "config/pgbackrest.conf").chmod(0o600)
        (source / "data/postgresql.conf").write_text(settings(source, REQUEST["port"], REQUEST["archiveCommand"]))
        (source / "data/pg_hba.conf").write_text("local all all scram-sha-256\nhost all all 0.0.0.0/0 reject\nhost all all ::/0 reject\n")
        if not start(source):
            raise RuntimeError("Disposable source PostgreSQL did not start")
        return {"started": True}
    if action == "command":
        args = REQUEST["args"]
        if len(args) > 32 or args[-1] not in ("stanza-create", "check", "backup", "info", "restore"):
            raise RuntimeError("Unsupported fixed pgBackRest laboratory command")
        if REQUEST.get("wrongCipher"):
            ENV["PGBACKREST_REPO1_CIPHER_PASS"] = os.urandom(48).hex()
        result = run([BACKREST / "usr/bin/pgbackrest", *args], required=REQUEST.get("required", True))
        info = None
        if args[-1] == "info" and result.returncode == 0:
            try:
                info = json.loads(result.stdout)
            except json.JSONDecodeError:
                if REQUEST.get("wrongCipher"):
                    return {"code": 0, "info": None, "infoMalformed": True}
                raise
        return {"code": result.returncode, "info": info, "infoMalformed": False}
    if action == "variant-config":
        name = cell_name(REQUEST["name"])
        target = root / ("config/" + name + ".conf")
        target.write_text(REQUEST["config"])
        target.chmod(0o600)
        return {"written": True}
    if action == "install-config":
        (root / "config/pgbackrest.conf").write_text(REQUEST["config"])
        return {"written": True}
    if action == "manifest-proof":
        label, stanza = REQUEST["label"], REQUEST["stanza"]
        if not re.fullmatch(r"\d{8}-\d{6}F(?:_\d{8}-\d{6}[DI])?", label) or not re.fullmatch(r"g_[a-f0-9]{32}", stanza):
            raise RuntimeError("Unexpected fixed backup identity")
        manifest = root / "repository/backup" / stanza / label / "backup.manifest"
        used = sum(item.stat().st_size for item in (root / "repository").rglob("*") if item.is_file())
        return {"manifestHash": hashlib.sha256(manifest.read_bytes()).hexdigest(), "usedGiB": used / 1024**3, "freeGiB": shutil.disk_usage(root).free / 1024**3}
    if action == "foreign-source":
        foreign = root / "foreign-source"
        foreign.mkdir(mode=0o700)
        # This unrelated, never-started cluster is only an identity-mismatch negative fixture.
        run([BIN / "initdb", "-D", foreign / "data", "-L", PG / "usr/share/postgresql/18", "--no-locale", "--encoding=UTF8", "--auth-local=reject", "--auth-host=reject"])
        return {"data": str(foreign / "data")}
    if action == "restore-config":
        configure_destination(root / cell_name(REQUEST["cell"]))
        return {"replaced": True}
    if action == "restore-start":
        cell = root / cell_name(REQUEST["cell"])
        number = int((cell / ".target-port").read_text()) if (cell / ".target-port").exists() else configure_destination(cell)
        # Replace source config and HBA before first startup. The generated restore_command stays in auto.conf.
        started = start(cell)
        text = (cell / "postgres.log").read_text(errors="replace")
        categories = ("invalid permissions", "could not open configuration file", "archive_command", "pg_wal", "restore_command", "could not restore file", "invalid checkpoint", "recovery ended", "recovery target", "must be owned", "unrecognized configuration", "could not load library", "could not open file", "recovery.conf", "recovery.signal", "required WAL", "requested timeline", "not permitted", "configuration file contains errors", "invalid value for parameter")
        parameters = re.findall(r'parameter "([a-z_]+)"', text)
        return {"started": started, "categories": [word for word in categories if word in text] + parameters, "port": number, "socket": str(cell / (".s.PGSQL." + str(number))), "data": str((cell / "data").resolve()), "wal": str((cell / "data/pg_wal").resolve())}
    if action == "prepare-target":
        cell = root / cell_name(REQUEST["cell"])
        cell.mkdir(mode=0o700)
        if REQUEST.get("nonempty"):
            (cell / "data").mkdir(mode=0o700)
            (cell / "data/do-not-overwrite").write_text("guarded unrelated destination content")
        return {"data": str(cell / "data"), "wal": str(cell / "wal")}
    if action == "mutate-repository":
        # Mutate only a disposable, owned copy. The valid source repository remains byte-identical.
        kind = REQUEST["kind"]
        if kind not in ("missing-wal", "corrupt", "wrong-repo", "wrong-stanza"):
            raise RuntimeError("Unsupported fixed repository negative case")
        copied = root / (kind + "-repository")
        if kind == "wrong-repo":
            copied.mkdir(mode=0o700)
        else:
            shutil.copytree(root / "repository", copied)
            if kind == "missing-wal":
                for child in (copied / "archive").iterdir():
                    if child.is_dir():
                        shutil.rmtree(child)
            if kind == "corrupt":
                # Encrypted manifest authentication/checksum must reject these altered bytes.
                for manifest in copied.glob("backup/*/*/backup.manifest*"):
                    with manifest.open("r+b") as stream:
                        first = stream.read(1)
                        stream.seek(0)
                        stream.write(bytes([first[0] ^ 255]))
        return {"path": str(copied)}
    if action == "postcondition":
        cell = root / cell_name(REQUEST["cell"])
        text = (cell / "postgres.log").read_text() if (cell / "postgres.log").exists() else ""
        target_reached = "recovery stopping before commit of transaction" in text and ("pausing at the end of recovery" in text or "recovery has paused" in text)
        return {"unreachable": "recovery ended before configured recovery target was reached" in text, "guardPreserved": (cell / "data/do-not-overwrite").is_file(), "sourceRunning": (root / "source/data/postmaster.pid").is_file(), "targetReached": target_reached}
    if action == "wait-failure":
        cell = root / cell_name(REQUEST["cell"])
        until = time.monotonic() + 15
        while (cell / "data/postmaster.pid").exists() and time.monotonic() < until:
            time.sleep(0.1)
        text = (cell / "postgres.log").read_text(errors="replace")
        return {"stopped": not (cell / "data/postmaster.pid").exists(), "unreachable": "recovery ended before configured recovery target was reached" in text}
    if action == "cleanup":
        for cell in root.iterdir():
            if cell.is_dir():
                stop(cell)
        shutil.rmtree(root)
        return {"cleaned": True}
    raise RuntimeError("Unsupported recovery laboratory operation")


try:
    print(json.dumps(main()))
except Exception as error:
    # Exceptions generated by run contain fixed categories only; never print request/env or command arguments.
    if isinstance(error, RuntimeError):
        print(str(error), file=sys.stderr)
    else:
        print("Native recovery laboratory failed: " + type(error).__name__, file=sys.stderr)
    sys.exit(1)
