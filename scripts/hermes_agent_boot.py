"""Trusted first-party boot seam around an unchanged pinned real Hermes gateway."""

import asyncio
import json
import os
from pathlib import Path
import re
import socket
import sys
import threading
import time
import traceback
from hermes_tools_policy import schemas as tool_schemas, exact_call

stage = "bootstrap"
network_refusal = None
running_loop = None


def progress_diagnostic() -> None:
    """Only code positions; never frame locals, request data, paths or credential values."""
    def snapshot() -> None:
        value = {"stage": stage, "networkRefusal": network_refusal, "tasks": []}
        for task in list(asyncio.all_tasks(running_loop))[:16]:
            value["tasks"].append([{"file": Path(frame.f_code.co_filename).name,
                                    "line": frame.f_lineno, "function": frame.f_code.co_name}
                                   for frame in task.get_stack(limit=8)])
        path = Path(os.environ["HERMES_HOME"]) / "boot-progress.json"
        descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC | os.O_NOFOLLOW, 0o600)
        with os.fdopen(descriptor, "w") as stream:
            json.dump(value, stream)
    while True:
        time.sleep(10)
        if running_loop is not None and not running_loop.is_closed():
            running_loop.call_soon_threadsafe(snapshot)


def main() -> None:
    global stage
    payload = json.loads(sys.stdin.buffer.readline(65537))
    def parent_guard() -> None:
        # The inherited pipe is the lifetime capability, including SIGKILL of the broker owner.
        if not sys.stdin.buffer.read(1):
            os._exit(1)
    threading.Thread(target=parent_guard, daemon=True).start()
    threading.Thread(target=progress_diagnostic, daemon=True).start()
    source, home = Path(payload["source"]), Path(payload["home"])
    if source.resolve(strict=True) != source or home.resolve(strict=True) != home:
        raise RuntimeError("Aliased Hermes boot path")
    permitted_port = payload["brokerPort"]
    original_connect, original_getaddrinfo = socket.socket.connect, socket.getaddrinfo
    original_connect_ex = socket.socket.connect_ex

    def connect(connection, address):
        global network_refusal
        if connection.family == socket.AF_UNIX and isinstance(address, str) and Path(address).is_relative_to(home):
            return original_connect(connection, address)
        if not isinstance(address, tuple) or address[0] != "127.0.0.1" or address[1] != permitted_port:
            network_refusal = "unqualified-connect"
            raise OSError("Only the scoped first-party egress broker is permitted")
        return original_connect(connection, address)

    def connect_ex(connection, address):
        global network_refusal
        if ((isinstance(address, tuple) and address[0] == "127.0.0.1" and address[1] == permitted_port)
                or (connection.family == socket.AF_UNIX and isinstance(address, str) and Path(address).is_relative_to(home))):
            return original_connect_ex(connection, address)
        network_refusal = "unqualified-connect-ex"
        return 13

    def getaddrinfo(host, port, *args, **kwargs):
        global network_refusal
        if isinstance(host, bytes):
            host = host.decode("ascii", errors="strict")
        if host not in ("127.0.0.1", None):
            network_refusal = "unqualified-dns"
            raise OSError("Unscoped DNS lookup refused")
        return original_getaddrinfo(host, port, *args, **kwargs)

    socket.socket.connect = connect
    socket.getaddrinfo = getaddrinfo
    socket.socket.connect_ex = connect_ex
    sys.path.insert(0, str(source))
    stage = "config-import"
    from hermes_cli.config import load_config
    from hermes_cli.tools_config import _get_platform_tools
    from agent.skill_commands import build_auto_load_prompt
    config = load_config()
    stage = "policy-preflight"
    if _get_platform_tools(config, "api_server") or _get_platform_tools(config, "cli"):
        raise RuntimeError("Hermes tools widened during boot")
    prompt, loaded, missing = build_auto_load_prompt(user_config=config, home_override=home)
    if missing or loaded != ["godseye-context"] or not prompt:
        raise RuntimeError("Exact trusted Hermes skill did not preload")
    import run_agent
    stage = "agent-imported"
    upstream_agent = run_agent.AIAgent

    class BoundedAgent(upstream_agent):
        def _execute_tool_calls(self, assistant_message, messages, effective_task_id, api_call_count=0) -> None:
            grant = payload.get('toolGrant')
            if grant is None:
                raise RuntimeError('All Hermes tool dispatch is disabled for this task')
            from urllib.request import Request, urlopen
            from agent.tool_dispatch_helpers import make_tool_result_message
            for call in assistant_message.tool_calls:
                value = exact_call({'id': call.id, 'name': call.function.name,
                                    'arguments': call.function.arguments}, grant)
                if self._godseye_calls >= grant['policy']['maxCalls']:
                    raise RuntimeError('Task tool call budget exhausted')
                self._godseye_calls += 1
                wire = Request(f'http://127.0.0.1:{permitted_port}/control/tool',
                               json.dumps(value).encode(), {'Content-Type': 'application/json',
                               'Authorization': 'Bearer ' + os.environ['OPENAI_API_KEY']}, method='POST')
                with urlopen(wire, timeout=35) as response:
                    raw = response.read(65537)
                    if len(raw) > 65536:
                        raise RuntimeError('Task tool callback response exceeded')
                    result = json.loads(raw)
                if set(result) != {'result'} or not isinstance(result['result'], str):
                    raise RuntimeError('Task tool callback refused')
                messages.append(make_tool_result_message(value['name'], result['result'], value['id']))

        def _execute_tool_calls_concurrent(self, *_args, **_kwargs) -> None:
            raise RuntimeError("All Hermes tool dispatch is disabled for this task")

        def _execute_tool_calls_sequential(self, *_args, **_kwargs) -> None:
            raise RuntimeError("All Hermes tool dispatch is disabled for this task")

        def __init__(self, *args, **kwargs):
            global stage
            stage = "agent-construction"
            status = {"modelMatches": kwargs.get("model") == payload["model"],
                      "providerMatches": kwargs.get("provider") == "custom",
                      "providerCategory": kwargs.get("provider") if kwargs.get("provider") in ("custom", "openai", "openai-codex") else "none" if kwargs.get("provider") is None else "other",
                      "toolsEmpty": kwargs.get("enabled_toolsets") == [],
                      "endpointMatches": kwargs.get("base_url", "").rstrip("/") == f"http://127.0.0.1:{permitted_port}/v1",
                      "apiMode": kwargs.get("api_mode") if kwargs.get("api_mode") in ("chat_completions", "codex_responses") else "other"}
            target = home / "agent-boot-status.json"
            descriptor = os.open(target, os.O_WRONLY | os.O_CREAT | os.O_TRUNC | os.O_NOFOLLOW, 0o600)
            with os.fdopen(descriptor, "w") as stream:
                json.dump(status, stream)
            # The pinned resolver expands the direct OpenAI alias to its "custom" transport.
            # Actual upstream authority remains the fixed OpenAI-only egress broker, not this label.
            if (args or kwargs.get("enabled_toolsets") != [] or kwargs.get("provider") != "custom"
                    or kwargs.get("model") != payload["model"]
                    or kwargs.get("base_url", "").rstrip("/") != f"http://127.0.0.1:{permitted_port}/v1"):
                raise RuntimeError("Unqualified Hermes agent construction")
            kwargs.update({"max_tokens": payload["maxOutputTokens"], "max_iterations": payload['maxRequests'] if payload.get('toolGrant') else 1,
                           "run_budget_seconds": payload["timeoutSeconds"], "fallback_model": None,
                           "skip_context_files": True, "skip_memory": True,
                           "skip_background_review": True, "checkpoints_enabled": False})
            # API Runs supplies its own ephemeral instructions; native autoload is a CLI seam.
            # Carry the exact reviewed skill body into the real agent's system context explicitly.
            kwargs["ephemeral_system_prompt"] = prompt + "\n\n" + (kwargs.get("ephemeral_system_prompt") or "")
            super().__init__(**kwargs)
            status.update({"nativeToolsCount": len(self.tools or []),
                           "nativeProviderMatches": self.provider == "custom",
                           "nativeEndpointMatches": self.base_url.rstrip("/") == f"http://127.0.0.1:{permitted_port}/v1",
                           "nativeOutputCapMatches": self.max_tokens == payload["maxOutputTokens"]})
            descriptor = os.open(target, os.O_WRONLY | os.O_TRUNC | os.O_NOFOLLOW, 0o600)
            with os.fdopen(descriptor, "w") as stream:
                json.dump(status, stream)
            if (self.tools or not status["nativeProviderMatches"] or not status["nativeEndpointMatches"]
                    or not status["nativeOutputCapMatches"]):
                raise RuntimeError("Hermes native execution policy widened during construction")
            if payload.get('toolGrant'):
                self.tools = tool_schemas(payload['toolGrant'])
                self.valid_tool_names = {item['function']['name'] for item in self.tools}
                self._context_engine_tool_names = set(self.valid_tool_names)
            self._godseye_calls = 0
            stage = "agent-ready"

    run_agent.AIAgent = BoundedAgent
    import model_tools
    def deny_registered_tool(*_args, **_kwargs) -> str:
        raise RuntimeError("Registered tool dispatch is disabled for this task")
    model_tools.handle_function_call = deny_registered_tool
    from gateway.config import PlatformConfig
    from gateway.platforms.api_server import APIServerAdapter
    original_adapter_connect = APIServerAdapter.connect

    async def checked_connect(adapter, *args, **kwargs):
        status = {"portMatches": adapter._port == payload["apiPort"],
                  "keyMatches": adapter._api_key == os.environ["API_SERVER_KEY"]}
        try:
            connected = await original_adapter_connect(adapter, *args, **kwargs)
            status["connected"] = connected is True
            code = adapter.fatal_error_code
            status["fatalCode"] = code if isinstance(code, str) and re.fullmatch(r"[a-z0-9_-]{1,80}", code) else None
            return connected
        except Exception as error:
            status["errorType"] = type(error).__name__
            status["frames"] = [{"file": Path(frame.filename).name, "line": frame.lineno,
                                 "function": frame.name} for frame in traceback.extract_tb(error.__traceback__)[-8:]]
            raise
        finally:
            target = home / "api-boot-status.json"
            descriptor = os.open(target, os.O_WRONLY | os.O_CREAT | os.O_TRUNC | os.O_NOFOLLOW, 0o600)
            with os.fdopen(descriptor, "w") as stream:
                json.dump(status, stream)

    APIServerAdapter.connect = checked_connect
    stage = "api-start"
    api_config = PlatformConfig(
        enabled=True, extra={"host": "127.0.0.1", "port": payload["apiPort"],
                             "key": os.environ["API_SERVER_KEY"]})
    async def serve() -> None:
        global running_loop
        running_loop = asyncio.get_running_loop()
        # Host the unchanged first-party Runs API without generic messaging gateway
        # session authority, platform reconnectors, or unrelated background turn runners.
        adapter = APIServerAdapter(api_config)
        if await adapter.connect() is not True:
            raise RuntimeError("Hermes API adapter did not bind its private listener")
        try:
            await asyncio.Event().wait()
        finally:
            await adapter.disconnect()
    asyncio.run(serve())


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        # Raw upstream diagnostics are never part of the private controller protocol.
        try:
            diagnostic = {"stage": stage, "errorType": type(error).__name__}
            diagnostic["networkRefusal"] = network_refusal
            diagnostic["frames"] = [{"file": Path(frame.filename).name, "line": frame.lineno,
                                      "function": frame.name} for frame in traceback.extract_tb(error.__traceback__)[-8:]]
            if isinstance(error, ModuleNotFoundError) and re.fullmatch(r"[A-Za-z0-9_.]{1,128}", error.name or ""):
                diagnostic["missingModule"] = error.name
            target = Path(os.environ["HERMES_HOME"]) / "boot-status.json"
            descriptor = os.open(target, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
            with os.fdopen(descriptor, "w") as stream:
                json.dump(diagnostic, stream)
        except Exception:
            pass  # Process failure remains authoritative even when diagnostic publication fails.
        sys.exit(1)
