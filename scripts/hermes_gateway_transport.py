"""Bounded exact-run HTTP observations without mutation or model replay."""

import json
from urllib.request import HTTPRedirectHandler, Request, build_opener
from hermes_gateway_state import MAX_OUTPUT_BYTES, public_observation


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, *_args, **_kwargs):
        return None


def api(state: dict, method: str, path: str, body: dict | None = None, timeout: float = 5) -> dict:
    """Only this exact retained loopback listener and private API identity are usable."""
    headers = {"Authorization": "Bearer " + state["apiKey"], "Content-Type": "application/json"}
    if method == "POST" and path == "/v1/runs":
        headers["Idempotency-Key"] = state["identity"]["correlationId"]
    request = Request(f"http://127.0.0.1:{state['apiPort']}{path}",
                      json.dumps(body).encode() if body is not None else None,
                      headers,
                      method=method)
    with build_opener(NoRedirect).open(request, timeout=timeout) as response:
        raw = response.read(131073)
        if len(raw) > 131072:
            raise RuntimeError("Hermes provider response exceeded its bound")
        value = json.loads(raw)
        if not isinstance(value, dict):
            raise RuntimeError("Invalid Hermes provider observation")
        return value


def observed(state: dict, value: dict) -> dict:
    """Provider success requires exact identity, actual terminal status and bounded result."""
    if value.get("run_id") != state["providerRunId"] or value.get("object") != "hermes.run":
        raise RuntimeError("Hermes returned a foreign run")
    mapping = {"queued": "running", "running": "running", "waiting_for_approval": "running",
               "stopping": "running", "completed": "succeeded", "failed": "failed",
               "cancelled": "cancelled", "interrupted": "unknown", "unknown": "unknown"}
    if value.get("status") not in mapping:
        raise RuntimeError("Unsupported Hermes run state")
    # Polling may race the broker's durable attempt fence. Never copy journal authority
    # (especially the monotone request counter) into a later state.update operation.
    result = {"state": mapping[value["status"]], "providerRunId": state["providerRunId"], "stopped": False}
    output = value.get("output")
    if output is not None:
        if not isinstance(output, str) or len(output.encode()) > MAX_OUTPUT_BYTES:
            raise RuntimeError("Hermes output exceeded its bound")
        result["output"] = output
    usage = value.get("usage")
    if isinstance(usage, dict):
        for source, target in (("input_tokens", "inputTokens"), ("output_tokens", "outputTokens")):
            count = usage.get(source)
            if type(count) is int and 0 <= count <= 1000000:
                result[target] = count
    runtime = value.get("runtime")
    # "custom" is the pinned resolver's direct-OpenAI alias, bound here to the exact private proxy.
    if isinstance(runtime, dict) and (runtime.get("provider") not in ("custom", "openai") or runtime.get("model") != "gpt-6-luna"):
        raise RuntimeError("Hermes runtime changed provider or model")
    return result


def readonly_observation(state: dict) -> dict:
    if state.get("stopped") is True:
        return public_observation(state)
    if state.get("providerRunId") is None:
        return {"state": "unknown", "providerRunId": None, "stopped": False}
    try:
        current = observed(state, api(state, "GET", "/v1/runs/" + state["providerRunId"]))
        current["attempts"] = state.get("attempts", [])
        # The owning helper, not a status response, proves its child has actually exited.
        return public_observation(current)
    except Exception:
        return {"state": "unknown", "providerRunId": state.get("providerRunId"), "stopped": False}
