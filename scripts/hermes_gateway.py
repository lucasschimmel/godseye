"""Owned per-task Hermes gateway and one-request broker, controlled by bounded private IPC."""

from datetime import datetime
import fcntl
import json
import os
from pathlib import Path
import re
import runpy
import socket
import subprocess
import sys
import threading
import time
from urllib.request import Request, build_opener
from hermes_files import private_directory, regular
from hermes_gateway_broker import Authority, Broker
from hermes_gateway_state import (
    MAX_REQUEST_BYTES, materialize, public_observation, read_state, task_root,
    validate_request, write_state,
)
from hermes_gateway_transport import NoRedirect, api, observed, readonly_observation
from hermes_runtime_install import execution_root, verify_execution, verify_controller
from hermes_gateway_events import RunEvents
from hermes_tools_bridge import ToolBridge


def free_port() -> int:
    with socket.socket() as reservation:
        reservation.bind(("127.0.0.1", 0))
        return reservation.getsockname()[1]


def child_environment(tool: Path, directory: Path, state: dict) -> dict[str, str]:
    host = directory / "os-home"
    for path in (host, host / "cache", host / "config", host / "data"):
        private_directory(path)
    return {"PATH": "/usr/bin:/bin", "HOME": str(host), "XDG_CACHE_HOME": str(host / "cache"),
            "XDG_CONFIG_HOME": str(host / "config"), "XDG_DATA_HOME": str(host / "data"),
            "HERMES_HOME": str(directory / "home"), "HERMES_RUNTIME_DIR": str(tool / "runtime"),
            "HERMES_INSTALL_ROOT": str(tool / "identity"), "HERMES_DISABLE_LAZY_INSTALLS": "1",
            "PYTHONDONTWRITEBYTECODE": "1", "PYTHONNOUSERSITE": "1", "LANG": "C.UTF-8",
            "LC_ALL": "C.UTF-8", "OPENAI_API_KEY": state["brokerKey"],
            "OPENAI_BASE_URL": f"http://127.0.0.1:{state['brokerPort']}/v1",
            "API_SERVER_ENABLED": "true", "API_SERVER_HOST": "127.0.0.1",
            "API_SERVER_PORT": str(state["apiPort"]), "API_SERVER_KEY": state["apiKey"],
            "GATEWAY_MULTIPLEX_PROFILES": "false", "HERMES_SKIP_UPDATE_CHECK": "1"}


def terminate(child: subprocess.Popen | None) -> bool:
    """Own the actual child handle; never kill a numeric PID from retained state."""
    if child is None:
        return True
    if child.poll() is None:
        child.terminate()
        try:
            child.wait(timeout=5)
        except subprocess.TimeoutExpired:
            child.kill()
            try:
                child.wait(timeout=5)
            except subprocess.TimeoutExpired:
                return False
    return child.poll() is not None


def run(workspace: Path, request: dict, provider_key: str, fixture_base: str | None) -> None:
    """Keep one lexical owner for the live child, IPC authority and broker through final cleanup.

    This orchestration intentionally exceeds the normal helper size limit: splitting the
    ownership try/finally across globals would weaken exact-task cleanup after interruption.
    """
    directory = task_root(workspace, request["taskId"])
    if directory.exists():
        print(json.dumps({"kind": "observation", "observation": readonly_observation(read_state(directory, request))}), flush=True)
        return
    installer = runpy.run_path(str(workspace / "scripts/install-hermes.py"))
    tool = installer["resolve_root"](str(workspace), False)
    installer["verify_install"](tool)
    execution = execution_root(tool)
    verify_execution(execution, tool)
    verify_controller(execution, workspace)
    stop = threading.Event()
    cancellation = threading.Event()
    send_lock = threading.Lock()

    def send(value: dict) -> None:
        with send_lock:
            try:
                print(json.dumps(value), flush=True)
            except BrokenPipeError:
                stop.set()

    authority = Authority(request["taskId"], send, stop)
    bridge = ToolBridge(send, stop, datetime.fromisoformat(request['deadline'].replace('Z', '+00:00')).timestamp())
    events = None

    def listen() -> None:
        try:
            while not stop.is_set():
                raw = sys.stdin.buffer.readline(16385)
                if not raw or len(raw) > 16384:
                    stop.set()
                    return
                message = json.loads(raw)
                if message == {"kind": "stop"}:
                    cancellation.set()
                    stop.set()
                    return
                if message.get("kind") == "event-ack" and events is not None:
                    events.receive(message)
                elif message.get('kind') == 'tool-ack':
                    bridge.receive(message)
                else:
                    authority.receive(message)
        except Exception:
            stop.set()

    threading.Thread(target=listen, daemon=True).start()
    if not authority.authorize():
        raise RuntimeError("Hermes preparation authority expired")
    state = materialize(workspace, directory, request, free_port(), free_port())
    descriptor = os.open(directory / ".runtime.lock", os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
    regular(directory / ".runtime.lock")
    fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
    broker, child = None, None
    final = "unknown"
    phase = "gateway-start"
    deadline = min(datetime.fromisoformat(request["deadline"].replace("Z", "+00:00")).timestamp(),
                   time.time() + request["profile"]["limits"]["timeoutSeconds"])
    try:
        broker = Broker(directory, state, request, provider_key, authority, stop, fixture_base)
        broker.tools_bridge = bridge
        broker.start()
        boot = workspace / "scripts/hermes_agent_boot.py"
        child = subprocess.Popen([str(execution / "venv/bin/python"), "-B", str(boot)],
                                 cwd=tool / "source", env=child_environment(tool, directory, state),
                                 stdin=subprocess.PIPE, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        child.stdin.write(json.dumps({"source": str(tool / "source"), "home": str(directory / "home"),
                         "brokerPort": state["brokerPort"], "apiPort": state["apiPort"],
                         "model": request["profile"]["model"], **request["profile"]["limits"],
                         **({'toolGrant': request['toolGrant']} if request.get('toolGrant') else {})}).encode() + b"\n")
        child.stdin.flush()  # Keep the pipe open: its EOF is the native child's owner-death guard.
        ready = False
        last_diagnostic = 0
        while time.time() < deadline and not stop.is_set() and child.poll() is None:
            try:
                capabilities = api(state, "GET", "/v1/capabilities", timeout=1)
                idempotency = capabilities.get("features", {}).get("runs_idempotency", {})
                ready = (capabilities.get("object") == "hermes.api_server.capabilities"
                         and idempotency.get("durable") is True)
                if ready:
                    break
                diagnostic = {"http": 200, "objectMatches": capabilities.get("object") == "hermes.api_server.capabilities",
                              "durable": idempotency.get("durable") is True}
            except Exception as error:
                diagnostic = {"errorType": type(error).__name__, "http": getattr(error, "code", None)}
                time.sleep(0.1)
            if time.time() - last_diagnostic >= 5:
                last_diagnostic = time.time()
                from hermes_files import replace_json
                replace_json(directory / "readiness-status.json", diagnostic)
        if not ready or not authority.authorize():
            raise RuntimeError("Hermes runtime did not become ready under its grant")
        with broker.lock:
            state["state"] = "submitting"
            write_state(directory, state)
        # This exact POST is the only admission. Existing state never enters this branch again.
        if not authority.authorize():
            raise RuntimeError("Hermes submission authority expired")
        phase = "run-admission"
        accepted = api(state, "POST", "/v1/runs", {
            "input": request["input"], "session_id": request["correlationId"],
            **({"conversation_history": request["conversation"]["history"]} if request.get("conversation") else {}),
            "model": request["profile"]["model"], "provider": "openai",
            "instructions": (f"Assigned project: {request['profile']['projectId']}. "
                             f"Assigned environment: {request['profile']['environmentId']}. "
                             f"Assigned role: {request['profile']['role']}. Task: {request['taskId']}. "
                             + ("Only exact offered first-party task scratch-file tools are authorized. No shell, project code or external actions are available. " if request.get('toolGrant') else
                                "This task permits a bounded text response only. No tools or external actions are authorized. ") +
                             "Optional inert structured outputs use fenced godseye-output-v1 JSON blocks. "
                             'An artifact is exactly {"type":"artifact","name":"safe display name",'
                             '"mediaType":"text/plain|text/markdown|application/json|text/x-patch","content":"UTF-8 text"}. '
                             'An approval proposal is exactly {"type":"approval","planId":"existing Foundation plan UUID",'
                             '"expectedHash":"exact existing plan SHA256","reason":"brief reason"}. '
                             "Use one actual mediaType value. Proposals only link existing plans; never invent plan IDs/hashes. "
                             "These blocks grant no execution, file or tool authority."),
        }, timeout=max(1, deadline - time.time()))
        run_id = accepted.get("run_id")
        if not isinstance(run_id, str) or not re.fullmatch(r"run_[a-f0-9]{32}", run_id):
            raise RuntimeError("Hermes did not retain an exact provider run identity")
        with broker.lock:
            state.update({"providerRunId": run_id, "state": "running"})
            write_state(directory, state)
        send({"kind": "observation", "observation": public_observation(state)})
        events = RunEvents(state, send, stop, deadline)
        events.start()
        phase = "run-observation"
        while time.time() < deadline and not stop.is_set() and child.poll() is None:
            current = observed(state, api(state, "GET", "/v1/runs/" + run_id))
            if current["state"] in ("succeeded", "failed", "cancelled"):
                if not events.join() or events.failed or stop.is_set():
                    break
                # SDKs may accept an EOF without [DONE]. A validated physical reply is
                # independent proof; provisional streamed text alone cannot succeed.
                if current["state"] == "succeeded" and not broker.reply_validated:
                    current = {"state": "failed", "providerRunId": run_id, "stopped": False}
                with broker.lock:
                    state.update(current)
                    write_state(directory, state)
                final = current["state"]
                break
            time.sleep(0.2)
        if final == "unknown" and run_id:
            try:
                api(state, "POST", "/v1/runs/" + run_id + "/stop", {})
            except Exception:
                pass  # Unacknowledged stop retains unknown; owned handle is still cleaned below.
    except Exception as error:
        # Preserve the already-retained run identity and one final observation. A second
        # top-level unknown frame must never overwrite that identity after cleanup.
        from hermes_files import replace_json
        replace_json(directory / "helper-status.json", {
            "phase": phase, "errorType": type(error).__name__,
        })
    finally:
        stop.set()
        exited = terminate(child)
        events_exited = events is None or events.join()
        if broker is not None:
            broker.close()
        with (broker.lock if broker is not None else threading.Lock()):
            state["stopped"] = exited and events_exited and (broker is None or broker.inflight == 0)
            if (final == "unknown" and state["stopped"]
                    and (cancellation.is_set() or (broker is not None and broker.cancel_requested))):
                final = "cancelled"
            state["state"] = final
            write_state(directory, state)
        send({"kind": "observation", "observation": public_observation(state)})
        os.close(descriptor)


def main() -> None:
    os.umask(0o077)
    if sys.platform != "linux" or os.getuid() == 0:
        raise RuntimeError("Hermes runtime requires non-root local Linux")
    raw = sys.stdin.buffer.readline(MAX_REQUEST_BYTES + 1)
    if len(raw) > MAX_REQUEST_BYTES:
        raise ValueError("Bounded Hermes runtime input exceeded")
    payload = json.loads(raw)
    workspace = Path(payload["workspace"])
    if not workspace.is_absolute() or workspace.resolve(strict=True) != workspace:
        raise ValueError("Invalid local workspace")
    request, action = payload["request"], payload["action"]
    validate_request(request)
    if action == "start":
        key = payload["providerKey"]
        if not isinstance(key, str) or not 16 <= len(key) <= 1024:
            raise ValueError("Private provider material is unavailable")
        run(workspace, request, key, payload.get("fixtureBaseUrl"))
    elif action in ("inspect", "stop"):
        directory = task_root(workspace, request["taskId"])
        state = read_state(directory, request)
        if action == "stop" and state.get("stopped") is True and state.get("state") == "unknown":
            state["state"] = "cancelled"
            write_state(directory, state)
        if action == "stop" and state.get("stopped") is not True:
            try:
                control = Request(f"http://127.0.0.1:{state['brokerPort']}/control/stop", b"{}",
                                  {"Authorization": "Bearer " + state["apiKey"]}, method="POST")
                with build_opener(NoRedirect).open(control, timeout=2) as _response:
                    pass
            except Exception:
                pass  # Protective request cannot turn unknown into false termination proof.
        print(json.dumps({"kind": "observation", "observation": readonly_observation(state)}), flush=True)
    else:
        raise ValueError("Unknown exact-task Hermes action")


if __name__ == "__main__":
    try:
        main()
    except Exception:
        print(json.dumps({"kind": "observation", "observation":
              {"state": "unknown", "providerRunId": None, "stopped": False}}), flush=True)
        sys.exit(1)
