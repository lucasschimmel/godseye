"""Private, exact-task durable state and mutable homes for trusted Hermes execution."""

import os
from pathlib import Path
import re
import secrets
import uuid
from hermes_catalog import COMMIT, ROLES, VERSION, catalog, configuration
from hermes_tools_policy import validate as validate_tool_grant
from hermes_files import (
    digest, document, existing_directory, private_directory, read_json, replace_json,
    runtime_root, write_new,
)

MAX_INPUT_BYTES = 8192
MAX_OUTPUT_BYTES = 32768
MAX_REQUEST_BYTES = 65536
OUTPUT_PRICE_MICROS_PER_TOKEN = 0.5
INPUT_OVERHEAD_TOKENS = 8192


def validate_request(request: dict) -> None:
    """Refuse widened task identity and unbounded policy before touching native state."""
    for field in ("taskId", "correlationId"):
        if str(uuid.UUID(request[field])) != request[field]:
            raise ValueError("Invalid task identity")
    profile = request["profile"]
    for field in ("id", "projectId", "environmentId"):
        if str(uuid.UUID(profile[field])) != profile[field]:
            raise ValueError("Invalid profile identity")
    grant = request.get('toolGrant')
    if grant is not None:
        validate_tool_grant(grant)
        if not re.fullmatch('[a-f0-9]{64}', request.get('toolPolicyHash', '')):
            raise ValueError('Invalid task tool policy hash')
    expected_tools = grant['policy']['tools'] if grant is not None else []
    if profile["role"] not in ROLES or profile["model"] != "gpt-6-luna" or profile["tools"] != expected_tools:
        raise ValueError("Unqualified Hermes profile")
    if not re.fullmatch(r"[a-f0-9]{64}", profile["hash"]):
        raise ValueError("Invalid profile digest")
    limits = profile["limits"]
    if (any(type(limits.get(field)) is not int for field in
            ("maxTurns", "maxRequests", "maxOutputTokens", "timeoutSeconds", "maxCostMicros"))
            or limits["maxTurns"] != (grant['maxModelRequests'] if grant else 1)
            or limits["maxRequests"] != (grant['maxModelRequests'] if grant else 1)
            or not 32 <= limits["maxOutputTokens"] <= 2048
            or not 5 <= limits["timeoutSeconds"] <= 300
            or not 1000 <= limits["maxCostMicros"] <= 100000):
        raise ValueError("Invalid bounded Hermes limits")
    if not isinstance(request["input"], str) or not 1 <= len(request["input"].encode()) <= MAX_INPUT_BYTES:
        raise ValueError("Invalid Hermes input size")
    conversation = request.get("conversation")
    if conversation is not None:
        if (not isinstance(conversation, dict) or set(conversation) != {"id", "history"}
                or str(uuid.UUID(conversation["id"])) != conversation["id"]
                or not isinstance(conversation["history"], list) or len(conversation["history"]) > 4):
            raise ValueError("Invalid Hermes conversation")
        for message in conversation["history"]:
            if (not isinstance(message, dict) or set(message) != {"role", "content"}
                    or message["role"] not in ("user", "assistant") or not isinstance(message["content"], str)):
                raise ValueError("Invalid Hermes history")
        if sum(len(message["content"].encode()) for message in conversation["history"]) > 16384:
            raise ValueError("Hermes history exceeds its bound")


def task_root(workspace: Path, task_id: str) -> Path:
    return runtime_root(workspace) / "runs" / str(uuid.UUID(task_id))


def identity(request: dict) -> dict:
    """The immutable input identity includes the original absolute deadline."""
    value = {"taskId": request["taskId"], "profileId": request["profile"]["id"],
            "profileHash": request["profile"]["hash"], "projectId": request["profile"]["projectId"],
            "environmentId": request["profile"]["environmentId"], "correlationId": request["correlationId"],
            "inputHash": digest(request["input"].encode()), "deadline": request["deadline"]}
    if request.get("conversation") is not None:
        value["conversationHash"] = digest(document(request["conversation"]))
    if request.get('toolGrant') is not None:
        value['toolGrantHash'] = digest(document(request['toolGrant']))
        value['toolPolicyHash'] = request['toolPolicyHash']
    return value


def read_state(directory: Path, request: dict) -> dict:
    existing_directory(directory)
    state = read_json(directory / "runtime.json")
    if not isinstance(state, dict) or state.get("identity") != identity(request):
        raise RuntimeError("Retained Hermes task identity differs")
    required = {"schema", "identity", "hermesVersion", "hermesCommit", "apiKey", "brokerKey",
                "apiPort", "brokerPort", "providerRunId", "state", "stopped", "requests", "output"}
    if (not required <= set(state) or not set(state) <= required | {"inputTokens", "outputTokens", "reservedCostMicros", "toolCalls"}
            or state["schema"] != 1 or state["hermesVersion"] != VERSION or state["hermesCommit"] != COMMIT):
        raise RuntimeError("Retained Hermes runtime schema differs")
    for field in ("apiPort", "brokerPort"):
        if type(state[field]) is not int or not 1024 <= state[field] <= 65535:
            raise RuntimeError("Invalid retained Hermes loopback listener")
    for field in ("apiKey", "brokerKey"):
        if not isinstance(state[field], str) or not re.fullmatch(r"[A-Za-z0-9_-]{43}", state[field]):
            raise RuntimeError("Invalid retained private runtime identity")
    if (state["apiPort"] == state["brokerPort"] or type(state["stopped"]) is not bool
            or type(state["requests"]) is not int or not 0 <= state["requests"] <= 4
            or state["state"] not in ("prepared", "submitting", "running", "succeeded", "failed", "cancelled", "unknown")
            or (state["providerRunId"] is not None and not re.fullmatch(r"run_[a-f0-9]{32}", state["providerRunId"]))):
        raise RuntimeError("Invalid retained Hermes state")
    if state["output"] is not None and (not isinstance(state["output"], str) or len(state["output"].encode()) > MAX_OUTPUT_BYTES):
        raise RuntimeError("Invalid retained Hermes result")
    return state


def write_state(directory: Path, state: dict) -> None:
    encoded = document(state)
    if len(encoded) > 131072:
        raise RuntimeError("Bounded Hermes task state exceeded")
    replace_json(directory / "runtime.json", state)


def materialize(workspace: Path, directory: Path, request: dict, broker_port: int, api_port: int) -> dict:
    """Create one complete exact-scope policy and journal before any gateway is started.

    The policy assembly stays together to make all no-tools settings reviewable at
    the publication boundary; retained tasks are never rebound or resubmitted.
    """
    validate_request(request)
    if directory.exists() or directory.is_symlink():
        raise RuntimeError("A retained task may only be inspected, never relaunched")
    private_directory(directory.parent)
    private_directory(directory)
    home = directory / "home"
    private_directory(home)
    registry, files = catalog(workspace)
    skill = request["profile"]["skill"]
    if (len(registry["skills"]) != 1 or skill["id"] != "godseye-context" or skill["version"] != "1.0.0"
            or registry["skills"][0]["files"]["SKILL.md"] != skill["sha256"]):
        raise RuntimeError("The exact approved bootstrap skill differs")
    profile, limits = request["profile"], request["profile"]["limits"]
    cfg = configuration(profile["model"])
    cfg["model"].update({"base_url": f"http://127.0.0.1:{broker_port}/v1", "api_mode": "chat_completions"})
    cfg["skills"]["auto_load"] = [skill["id"]]
    cfg["fallback_providers"], cfg["fallback_model"] = [], None
    cfg["agent"].update({"run_budget_seconds": limits["timeoutSeconds"], "api_max_retries": 1,
                         "auto_recovery_cycles": 0, "environment_probe": False,
                         "intent_ack_continuation": False, "restart_drain_timeout": 0,
                         "cron_drain_timeout": 0, "gateway_startup_warmup_timeout": 1})
    cfg["gateway"] = {"multiplex_profiles": False, "api_server": {"max_concurrent_runs": 1}}
    cfg["platforms"] = {"api_server": {"enabled": True, "host": "127.0.0.1", "port": api_port}}
    files.update({"config.yaml": document(cfg), ".no-bundled-skills": b"",
                  "SOUL.md": ("# G.O.D.S.E.Y.E model-only task\n\n"
                              f"Project: {profile['projectId']}\nEnvironment: {profile['environmentId']}\n"
                              f"Role: {profile['role']}\nTask: {request['taskId']}\n\n"
                              "You may answer this bounded task using the supplied text. No tools, file access,\n"
                              "publication, subagents or external execution authority are available.\n").encode()})
    for name, content in files.items():
        target = home / name
        private_directory(target.parent)
        write_new(target, content)
    state = {"schema": 1, "identity": identity(request), "hermesVersion": VERSION,
             "hermesCommit": COMMIT, "apiKey": secrets.token_urlsafe(32),
             "brokerKey": secrets.token_urlsafe(32), "apiPort": api_port,
             "brokerPort": broker_port, "providerRunId": None, "state": "prepared",
             "stopped": False, "requests": 0, "output": None}
    write_state(directory, state)
    return state


def public_observation(state: dict) -> dict:
    """Expose only bounded task observations, never endpoints, private paths or material."""
    result = {"state": state["state"] if state["state"] in
              ("running", "succeeded", "failed", "cancelled", "unknown") else "unknown",
              "providerRunId": state.get("providerRunId"), "stopped": state.get("stopped") is True}
    if isinstance(state.get("output"), str):
        result["output"] = state["output"]
    for field in ("inputTokens", "outputTokens"):
        if isinstance(state.get(field), int) and state[field] >= 0:
            result[field] = state[field]
    if isinstance(state.get("attempts"), list):
        result["attempts"] = state["attempts"][:64]
    return result
