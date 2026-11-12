"""Owned persistent non-root local PostgreSQL/Redis services, never system daemons."""

import fcntl
import errno
import hashlib
import json
import os
from pathlib import Path
import re
import secrets
import socket
import stat
import subprocess
import sys
import tempfile
import time


def ensure_directory(path: Path) -> None:
    """Create private native directories and reject aliases or foreign ownership."""
    for parent in [path, *path.parents]:
        if parent.exists() and (parent.is_symlink() or parent.resolve() != parent):
            raise RuntimeError("Linked local services ancestor")
    path.mkdir(mode=0o700, parents=True, exist_ok=True)
    if path.resolve() != path or path.is_symlink() or path.stat().st_uid != os.getuid():
        raise RuntimeError("Unsafe owned local services directory")
    path.chmod(0o700)


def safe_tree(root: Path) -> None:
    """Refuse linked state before a native service can follow a path outside its cell."""
    for parent, directories, files in os.walk(root, followlinks=False):
        for name in directories + files:
            path = Path(parent) / name
            info = path.lstat()
            if path.is_symlink() or info.st_uid != os.getuid():
                raise RuntimeError("Linked or foreign local services state")
            if stat.S_ISREG(info.st_mode) and info.st_nlink != 1:
                raise RuntimeError("Multiply linked local services state")
            if not (stat.S_ISREG(info.st_mode) or stat.S_ISDIR(info.st_mode) or stat.S_ISSOCK(info.st_mode)):
                raise RuntimeError("Unexpected local services state entry")


def private_file(path: Path) -> os.stat_result | None:
    try:
        info = path.lstat()
    except FileNotFoundError:
        return None
    if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1 or info.st_uid != os.getuid():
        raise RuntimeError("Unsafe private local services file")
    return info


def sync_directory(path: Path) -> None:
    descriptor = os.open(path, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        os.fsync(descriptor)
    except OSError as error:
        if error.errno not in (errno.EINVAL, errno.ENOTSUP):
            raise
    finally:
        os.close(descriptor)


def staged_private(path: Path, content: bytes) -> Path:
    descriptor, name = tempfile.mkstemp(prefix="." + path.name + ".write-", dir=path.parent)
    temporary = Path(name)
    try:
        with os.fdopen(descriptor, "wb") as output:
            descriptor = -1
            if output.write(content) != len(content):
                raise RuntimeError("Incomplete private local services write")
            output.flush()
            os.fsync(output.fileno())
        private_file(temporary)
        return temporary
    except Exception:
        if descriptor != -1:
            os.close(descriptor)
        private_file(temporary)
        temporary.unlink()
        raise


def write_private(path: Path, value: str) -> None:
    """Atomic ownership-state replacement; preserve the prior valid document on failed writes."""
    parent = path.parent
    if parent.resolve() != parent or parent.is_symlink() or parent.stat().st_uid != os.getuid():
        raise RuntimeError("Unsafe private local services parent")
    before = private_file(path)
    old = path.read_bytes() if before else None
    temporary = staged_private(path, value.encode())
    committed = False
    try:
        current = private_file(path)
        def identity(info: os.stat_result | None) -> tuple | None:
            return None if info is None else (info.st_dev, info.st_ino, info.st_mode, info.st_uid, info.st_nlink, info.st_size, info.st_mtime_ns, info.st_ctime_ns)
        if identity(current) != identity(before):
            raise RuntimeError("Private local services file changed during replacement")
        os.replace(temporary, path)
        committed = True
        sync_directory(parent)
    except Exception:
        if committed:
            # Directory-fsync failures occur after atomic commit. Restore the prior complete
            # document atomically as well; neither path ever exposes a truncated state file.
            if old is not None:
                rollback = staged_private(path, old)
                try:
                    private_file(path)
                    os.replace(rollback, path)
                    sync_directory(parent)
                finally:
                    if rollback.exists():
                        private_file(rollback)
                        rollback.unlink()
            else:
                private_file(path)
                path.unlink()
                sync_directory(parent)
        raise
    finally:
        if temporary.exists():
            private_file(temporary)
            temporary.unlink()


def port() -> int:
    with socket.socket() as listener:
        listener.bind(("127.0.0.1", 0))
        return listener.getsockname()[1]


def unbound(port_number: int) -> None:
    with socket.socket() as connection:
        connection.settimeout(0.2)
        if connection.connect_ex(("127.0.0.1", port_number)) == 0:
            raise RuntimeError("Listener exists without owned process identity")


def validate_state(state: dict, marker: str) -> None:
    if set(state) != {"marker", "scopes", "databases"} or state["marker"] != marker:
        raise RuntimeError("Invalid local services ownership state")
    if not 2 <= len(state["scopes"]) <= 21 or len(state["databases"]) != len(state["scopes"]) + 1:
        raise RuntimeError("Invalid local services topology")
    ports = set()
    for index, cell in enumerate(state["databases"]):
        expected = {"name", "role", "port", "admin", "auth"}
        if index:
            expected.update({"redisPort", "redisAuth"})
        if not expected.issubset(cell) or set(cell) - expected - {"initialized"}:
            raise RuntimeError("Unexpected local services authority fields")
        if cell["name"] != "d" + str(index) or cell["role"] != ("control" if index == 0 else "workflow"):
            raise RuntimeError("Invalid local services identity")
        for key in ("admin", "auth", "redisAuth"):
            if key in cell and not re.fullmatch(r"[a-f0-9]{64}", cell[key]):
                raise RuntimeError("Invalid local services material")
        for key in ("port", "redisPort"):
            if key in cell:
                value = cell[key]
                if type(value) is not int or not 1024 <= value <= 65535 or value in ports:
                    raise RuntimeError("Invalid local services listeners")
                ports.add(value)


def run(args: list[str], env: dict[str, str], input_text: str | None = None) -> str:
    result = subprocess.run(args, env=env, input=input_text, capture_output=True, text=True, timeout=45)
    if result.returncode:
        raise RuntimeError("Owned local services command failed")
    return result.stdout.strip()


class Services:
    def __init__(self, payload: dict):
        self.payload = payload
        self.pg = Path(payload["postgresTool"])
        self.redis = Path(payload["redisTool"])
        self.pg_bin = self.pg / "usr/lib/postgresql/18/bin"
        self.pg_env = {**os.environ, "LD_LIBRARY_PATH": str(self.pg / "usr/lib/x86_64-linux-gnu")}
        self.redis_env = {**os.environ, "LD_LIBRARY_PATH": str(self.redis / "usr/lib/x86_64-linux-gnu")}
        if "18.6" not in run([str(self.pg_bin / "postgres"), "--version"], self.pg_env):
            raise RuntimeError("Pinned PostgreSQL tool missing")
        if "v=8.0.5 " not in run([str(self.redis / "usr/bin/redis-server"), "--version"], self.redis_env):
            raise RuntimeError("Pinned Redis tool missing")
        self.root = Path.home() / ".local/share/godseye-jobs" / payload["marker"][:24]
        ensure_directory(self.root)
        safe_tree(self.root)
        self.state_path = self.root / "state.json"

    def sql(self, cell: dict, query: str, bootstrap: bool = True) -> str:
        directory = self.root / cell["name"]
        role = "bootstrap" if bootstrap else cell["role"]
        material = cell["admin"] if bootstrap else cell["auth"]
        database = "postgres" if bootstrap else cell["role"]
        return run([str(self.pg_bin / "psql"), "-XAt", "-v", "ON_ERROR_STOP=1", "-h", str(directory), "-p", str(cell["port"]), "-U", role, "-d", database], {**self.pg_env, "PGPASSWORD": material}, query)

    def pg_live(self, cell: dict) -> bool:
        directory = self.root / cell["name"]
        pidfile = directory / "data/postmaster.pid"
        if not pidfile.exists():
            unbound(cell["port"])
            return False
        pid = int(pidfile.read_text().splitlines()[0])
        process = Path("/proc") / str(pid)
        if not process.exists():
            raise RuntimeError("Stale PostgreSQL identity requires operator inspection")
        arguments = (process / "cmdline").read_bytes().split(b"\0")
        if (process / "exe").resolve() != (self.pg_bin / "postgres").resolve() or str(directory / "data").encode() not in arguments:
            raise RuntimeError("PostgreSQL process identity mismatch")
        observed = self.sql(cell, "SELECT current_setting('data_directory');")
        if observed != str(directory / "data"):
            raise RuntimeError("PostgreSQL data identity mismatch")
        return True

    def start_pg(self, cell: dict) -> None:
        directory = self.root / cell["name"]
        ensure_directory(directory)
        data = directory / "data"
        fresh = not data.exists()
        if fresh:
            password = directory / "bootstrap.pass"
            write_private(password, cell["admin"])
            try:
                run([str(self.pg_bin / "initdb"), "-D", str(data), "-L", str(self.pg / "usr/share/postgresql/18"), "--no-locale", "--encoding=UTF8", "--username=bootstrap", "--auth-local=scram-sha-256", "--auth-host=reject", "--pwfile=" + str(password)], self.pg_env)
            finally:
                password.unlink()
            config = {"listen_addresses": "127.0.0.1", "port": str(cell["port"]), "unix_socket_directories": str(directory), "unix_socket_permissions": "0700", "max_connections": "30", "shared_buffers": "16MB", "fsync": "on", "synchronous_commit": "on", "password_encryption": "scram-sha-256", "logging_collector": "off"}
            write_private(data / "postgresql.conf", "\n".join(key + " = '" + value.replace("'", "''") + "'" for key, value in config.items()) + "\n")
            write_private(data / "pg_hba.conf", "local all all scram-sha-256\nhost all " + cell["role"] + " 127.0.0.1/32 scram-sha-256\nhost all all 127.0.0.1/32 reject\n")
        if not self.pg_live(cell):
            run([str(self.pg_bin / "pg_ctl"), "-D", str(data), "-l", str(directory / "postgres.log"), "-w", "start"], self.pg_env)
        if not self.pg_live(cell):
            raise RuntimeError("Owned PostgreSQL readiness failed")
        if not cell.get("initialized"):
            existing = self.sql(cell, "SELECT rolname FROM pg_roles WHERE rolname='" + cell["role"] + "';")
            if not existing:
                self.sql(cell, "CREATE ROLE " + cell["role"] + " LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD '" + cell["auth"] + "';")
            database = self.sql(cell, "SELECT datname FROM pg_database WHERE datname='" + cell["role"] + "';")
            if not database:
                self.sql(cell, "CREATE DATABASE " + cell["role"] + " OWNER " + cell["role"] + ";")
            self.sql(cell, "REVOKE CONNECT ON DATABASE postgres FROM PUBLIC;")
            cell["initialized"] = True
        self.sql(cell, "SELECT 1;", bootstrap=False)

    def redis_cli(self, cell: dict, *args: str) -> str:
        return run([str(self.redis / "usr/bin/redis-cli"), "--raw", "-h", "127.0.0.1", "-p", str(cell["redisPort"]), *args], {**self.redis_env, "REDISCLI_AUTH": cell["redisAuth"]})

    def redis_live(self, cell: dict) -> bool:
        directory = self.root / cell["name"] / "redis"
        pidfile = directory / "redis.pid"
        if not pidfile.exists():
            unbound(cell["redisPort"])
            return False
        pid = int(pidfile.read_text().strip())
        process = Path("/proc") / str(pid)
        if not process.exists() or (process / "exe").resolve() != (self.redis / "usr/bin/redis-server").resolve():
            raise RuntimeError("Redis process identity mismatch")
        info = self.redis_cli(cell, "INFO", "server")
        if f"process_id:{pid}" not in info.splitlines():
            raise RuntimeError("Redis authenticated process identity mismatch")
        if self.redis_cli(cell, "CONFIG", "GET", "dir").splitlines() != ["dir", str(directory)]:
            raise RuntimeError("Redis data directory identity mismatch")
        return True

    def start_redis(self, cell: dict) -> None:
        directory = self.root / cell["name"] / "redis"
        ensure_directory(directory)
        if self.redis_live(cell):
            return
        config = "\n".join(["bind 127.0.0.1", "protected-mode yes", "port " + str(cell["redisPort"]), "daemonize yes", "pidfile " + str(directory / "redis.pid"), "logfile " + str(directory / "redis.log"), "dir " + str(directory), "requirepass " + cell["redisAuth"], "appendonly yes", "appendfsync always", "maxmemory 134217728", "maxmemory-policy noeviction", 'save ""']) + "\n"
        write_private(directory / "redis.conf", config)
        run([str(self.redis / "usr/bin/redis-server"), str(directory / "redis.conf")], self.redis_env)
        for _ in range(100):
            try:
                if self.redis_live(cell):
                    return
            except RuntimeError:
                pass  # Daemonization returns before the authenticated listener is ready.
            time.sleep(0.05)
        raise RuntimeError("Redis readiness failed")

    def stop(self, state: dict) -> None:
        errors = []
        for cell in state["databases"]:
            try:
                if "redisPort" in cell and self.redis_live(cell):
                    self.redis_cli(cell, "SHUTDOWN", "SAVE")
                    for _ in range(100):
                        if not (self.root / cell["name"] / "redis/redis.pid").exists():
                            break
                        time.sleep(0.05)
                    else:
                        raise RuntimeError("Redis shutdown deadline exceeded")
            except Exception:
                errors.append("redis:" + cell["name"])
            try:
                if self.pg_live(cell):
                    run([str(self.pg_bin / "pg_ctl"), "-D", str(self.root / cell["name"] / "data"), "-m", "fast", "-w", "stop"], self.pg_env)
            except Exception:
                errors.append("postgres:" + cell["name"])
        if errors:
            raise RuntimeError("Owned service cleanup incomplete: " + ",".join(errors))

    def execute(self) -> dict:
        marker = self.payload["marker"]
        if self.state_path.exists():
            state = json.loads(self.state_path.read_text())
            if state.get("marker") != marker:
                raise RuntimeError("Local services ownership marker mismatch")
        elif self.payload["action"] == "stop":
            raise RuntimeError("No owned local services state exists")
        else:
            if any(path.name != ".operation.lock" for path in self.root.iterdir()):
                raise RuntimeError("Refusing nonempty unowned local services root")
            scopes = self.payload["cells"]
            state = {"marker": marker, "scopes": scopes, "databases": []}
            reserved = set()
            def unique_port() -> int:
                candidate = port()
                while candidate in reserved:
                    candidate = port()
                reserved.add(candidate)
                return candidate
            for index in range(len(scopes) + 1):
                cell = {"name": "d" + str(index), "role": "control" if index == 0 else "workflow", "port": unique_port(), "admin": secrets.token_hex(32), "auth": secrets.token_hex(32)}
                if index:
                    cell.update({"redisPort": unique_port(), "redisAuth": secrets.token_hex(32)})
                state["databases"].append(cell)
            write_private(self.state_path, json.dumps(state))
        validate_state(state, marker)
        if self.payload["action"] == "stop":
            self.stop(state)
            return {}
        if state["scopes"] != self.payload["cells"]:
            raise RuntimeError("Existing services scopes cannot be rebound; use a new private directory")
        try:
            for cell in state["databases"]:
                self.start_pg(cell)
                write_private(self.state_path, json.dumps(state))
                if "redisPort" in cell:
                    self.start_redis(cell)
        except Exception:
            self.stop(state)
            raise
        def uri(cell: dict) -> str:
            return "postgresql://" + cell["role"] + ":" + cell["auth"] + "@127.0.0.1:" + str(cell["port"]) + "/" + cell["role"] + "?sslmode=disable"
        return {"control": {"databaseUrl": uri(state["databases"][0])}, "storage": [{**scope, "postgresUri": uri(cell), "redisUri": "redis://:" + cell["redisAuth"] + "@127.0.0.1:" + str(cell["redisPort"]) + "/0"} for scope, cell in zip(state["scopes"], state["databases"][1:], strict=True)]}


def main() -> None:
    os.umask(0o077)
    if os.getuid() == 0:
        raise RuntimeError("Persistent services require a non-root user")
    payload = json.load(sys.stdin)
    if payload.get("action") not in ("start", "stop") or not re.fullmatch(r"[a-f0-9]{64}", payload.get("marker", "")):
        raise RuntimeError("Invalid persistent services request")
    services = Services(payload)
    lock = services.root / ".operation.lock"
    descriptor = os.open(lock, os.O_WRONLY | os.O_CREAT | os.O_NOFOLLOW, 0o600)
    with os.fdopen(descriptor, "w") as stream:
        fcntl.flock(stream, fcntl.LOCK_EX | fcntl.LOCK_NB)
        print(json.dumps(services.execute()))


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print("Owned local services command failed (" + type(error).__name__ + "); no private details emitted", file=sys.stderr)
        sys.exit(1)
