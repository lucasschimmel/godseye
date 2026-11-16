"""One-attempt OpenAI egress broker. The Hermes child never receives provider material."""

import json
import hashlib
from model_attempt_evidence import outcome as attempt_outcome
import math
import threading
import time
from datetime import datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlsplit
from urllib.request import Request
from hermes_gateway_state import INPUT_OVERHEAD_TOKENS, write_state
from hermes_files import replace_json
from hermes_gateway_reply import read_text_reply, validated_frames
from hermes_gateway_tools_reply import frames as validated_tool_frames
from hermes_tools_policy import schemas as tool_schemas, exact_call
from hermes_files import digest, document

MAX_RESPONSE_BYTES = 262144
MAX_MESSAGES = 8


class Authority:
    """Bounded parent-owned IPC authorizations, separate from model/API credentials."""

    def __init__(self, task_id: str, send, stop: threading.Event) -> None:
        self.task_id, self.send, self.stop = task_id, send, stop
        self.lock = threading.Lock()
        self.pending: dict[int, tuple[threading.Event, list[bool]]] = {}
        self.sequence = 0

    def authorize(self, attempt=None, outcome=None) -> bool:
        if self.stop.is_set() and outcome is None:
            return False
        with self.lock:
            if len(self.pending) >= 2:
                return False
            self.sequence += 1
            sequence = self.sequence
            done, allowed = threading.Event(), [False]
            self.pending[sequence] = done, allowed
        self.send({"kind": "attempt-intent" if attempt is not None else "attempt-outcome" if outcome is not None else "authorize", "taskId": self.task_id, "sequence": sequence, **({"attempt": attempt} if attempt is not None else {"outcome": outcome} if outcome is not None else {})})
        done.wait(5)
        with self.lock:
            self.pending.pop(sequence, None)
        return allowed[0] and (outcome is not None or not self.stop.is_set())

    def receive(self, message: dict) -> None:
        if set(message) != {"kind", "sequence", "allowed"} or message["kind"] != "authorization":
            self.stop.set()
            return
        with self.lock:
            item = self.pending.get(message["sequence"])
            if item is not None:
                item[1][0] = message["allowed"] is True
                item[0].set()


def outgoing_body(raw: bytes, request: dict, state: dict | None = None) -> bytes:
    """Use a conservative UTF-8 byte/token bound, including fixed protocol overhead."""
    profile, limits = request["profile"], request["profile"]["limits"]
    output_cost = math.ceil(limits["maxOutputTokens"] * 0.5)
    input_allowance = (limits["maxCostMicros"] - output_cost) * 10 - INPUT_OVERHEAD_TOKENS
    if not 0 < len(raw) <= min(input_allowance, 262144):
        raise ValueError("Provider input exceeds its conservative reservation")
    value = json.loads(raw)
    grant = request.get('toolGrant')
    if not isinstance(value, dict) or value.get("model") != profile["model"] or (value.get('tools') or []) != tool_schemas(grant):
        raise ValueError("Unqualified model or tool request")
    messages = value.get("messages")
    if not isinstance(messages, list) or not 1 <= len(messages) <= (16 if grant else MAX_MESSAGES):
        raise ValueError("Unqualified model transcript")
    known = (state or {}).get('toolCalls', {})
    pending, resolved, emitted = set(), set(), set()
    for message in messages:
        if not isinstance(message, dict) or message.get("role") not in (("system", "developer", "user", "assistant", "tool") if grant else ("system", "developer", "user", "assistant")):
            raise ValueError("Unqualified model message")
        content = message.get("content")
        if grant and message.get('role') == 'assistant' and message.get('tool_calls'):
            for call in message['tool_calls']:
                if not isinstance(call, dict) or call.get('type') != 'function' or not isinstance(call.get('function'), dict):
                    raise ValueError('Unqualified assistant tool transcript')
                selected = exact_call({'id': call.get('id'), 'name': call['function'].get('name'), 'arguments': call['function'].get('arguments')}, grant)
                if known.get(selected['id']) != digest(document(selected)) or selected['id'] in emitted:
                    raise ValueError('Changed assistant tool transcript')
                pending.add(selected['id'])
                emitted.add(selected['id'])
            if content is None:
                content = ''
        elif message.get('tool_calls'):
            raise ValueError('Unqualified tool transcript')
        if message.get('role') == 'tool':
            identifier = message.get('tool_call_id')
            if not grant or identifier not in pending or identifier in resolved:
                raise ValueError('Unpaired tool result')
            resolved.add(identifier)
        if not isinstance(content, str):
            if not isinstance(content, list) or any(not isinstance(part, dict) or set(part) != {"type", "text"}
                                                   or part["type"] != "text" or not isinstance(part["text"], str)
                                                   for part in content):
                raise ValueError("Only bounded text model content is qualified")
    if grant and (emitted != set(known) or resolved != pending):
        raise ValueError('Incomplete tool transcript')
    if value.get("n", 1) != 1:
        raise ValueError("Multiple completions exceed the admitted attempt")
    caps = [value[key] for key in ("max_tokens", "max_completion_tokens", "max_output_tokens") if key in value]
    if not caps or any(type(cap) is not int or not 1 <= cap <= limits["maxOutputTokens"] for cap in caps):
        raise ValueError("Missing or widened output limit")
    for key in ("max_tokens", "max_output_tokens", "store", "web_search_options", "functions", "function_call"):
        value.pop(key, None)
    value["max_completion_tokens"] = limits["maxOutputTokens"]
    value["n"], value["service_tier"], value["reasoning_effort"] = 1, "default", "none"
    value["store"] = False
    return json.dumps(value, separators=(",", ":")).encode()


class Broker:
    def __init__(self, directory, state: dict, request: dict, provider_key: str,
                 authority: Authority, stop: threading.Event, fixture_base: str | None = None) -> None:
        self.directory, self.state, self.request = directory, state, request
        self.provider_key, self.authority, self.stop = provider_key, authority, stop
        self.lock = threading.RLock()
        self.reply_validated = False
        self.inflight = 0
        self.settled = threading.Event()
        self.settled.set()
        self.cancel_requested = False
        self.deadline = min(datetime.fromisoformat(request["deadline"].replace("Z", "+00:00")).timestamp(),
                            time.time() + request["profile"]["limits"]["timeoutSeconds"])
        self.target = "https://api.openai.com/v1/chat/completions"
        if fixture_base is not None:
            value = urlsplit(fixture_base)
            if (value.scheme != "http" or value.hostname != "127.0.0.1" or not value.port
                    or value.path.rstrip("/") != "/v1" or value.username or value.password
                    or value.query or value.fragment):
                raise ValueError("Invalid explicit local model fixture")
            self.target = fixture_base.rstrip("/") + "/chat/completions"
        owner = self

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *_args) -> None:
                return

            def do_POST(self) -> None:
                owner.handle(self)

        self.server = ThreadingHTTPServer(("127.0.0.1", state["brokerPort"]), Handler)
        self.server.daemon_threads = True

    def refuse(self, handler, status: int = 403) -> None:
        body = b'{"error":{"message":"Bounded provider request refused","type":"provider_refused"}}'
        handler.send_response(status)
        handler.send_header("Content-Type", "application/json")
        handler.send_header("Content-Length", str(len(body)))
        handler.end_headers()
        handler.wfile.write(body)

    def handle(self, handler) -> None:
        """One lexical physical-attempt fence, with a single retained in-flight finally boundary."""
        stage = "route"
        published = False
        try:
            if handler.path == '/control/tool':
                if (not self.request.get('toolGrant') or self.stop.is_set()
                        or handler.headers.get('Authorization') != 'Bearer ' + self.state['brokerKey']):
                    return self.refuse(handler)
                size = int(handler.headers.get('Content-Length', '-1'))
                if not 0 < size <= 65536:
                    return self.refuse(handler)
                selected = exact_call(json.loads(handler.rfile.read(size)), self.request['toolGrant'])
                if self.state.get('toolCalls', {}).get(selected['id']) != digest(document(selected)):
                    return self.refuse(handler)
                result = self.tools_bridge.invoke('tool-call', selected)
                body = json.dumps({'result': result}).encode()
                handler.send_response(200)
                handler.send_header('Content-Type', 'application/json')
                handler.send_header('Content-Length', str(len(body)))
                handler.end_headers()
                handler.wfile.write(body)
                return
            if handler.path == "/control/stop":
                if handler.headers.get("Authorization") != "Bearer " + self.state["apiKey"]:
                    return self.refuse(handler)
                self.cancel_requested = True
                self.stop.set()
                return self.refuse(handler, 202)
            if (handler.path != "/v1/chat/completions" or self.stop.is_set()
                    or handler.headers.get("Authorization") != "Bearer " + self.state["brokerKey"]):
                replace_json(self.directory / "broker-status.json", {
                    "stage": "route", "pathKind": "responses" if handler.path == "/v1/responses" else "other",
                    "reason": "stopped" if self.stop.is_set() else "path" if handler.path != "/v1/chat/completions" else "authorization",
                    "requests": self.state["requests"],
                })
                return self.refuse(handler)
            size = int(handler.headers.get("Content-Length", "-1"))
            if not 0 < size <= 262144:
                return self.refuse(handler, 413)
            handler.connection.settimeout(5)
            raw = handler.rfile.read(size)
            if len(raw) != size:
                return self.refuse(handler, 400)
            body = outgoing_body(raw, self.request, self.state)
            if self.request.get('toolGrant') and not self.tools_bridge.prepared:
                self.tools_bridge.invoke('prepare-tools')
            stage = "authorization"
            if not self.authority.authorize():
                return self.refuse(handler)
            with self.lock:
                if (self.stop.is_set() or time.time() >= self.deadline
                        or self.state["requests"] >= self.request["profile"]["limits"]["maxRequests"]):
                    return self.refuse(handler)
                self.state["requests"] += 1
                if self.request.get('toolGrant'):
                    cost = math.ceil((len(body) + INPUT_OVERHEAD_TOKENS) * .1 + self.request['profile']['limits']['maxOutputTokens'] * .5)
                    spent = self.state.get('reservedCostMicros', 0) + cost
                    if spent > self.request['profile']['limits']['maxCostMicros']:
                        self.state['requests'] -= 1
                        return self.refuse(handler)
                    self.state['reservedCostMicros'] = spent
                self.reply_validated = False
                write_state(self.directory, self.state)  # Durable attempt fence precedes network I/O.
                self.inflight += 1
                self.settled.clear()
            attempt_sequence = self.state["requests"]
            request_hash = hashlib.sha256(body).hexdigest()
            attempt = {'sequence': attempt_sequence, 'requestHash': request_hash, 'provider': 'openai',
                       'model': self.request['profile']['model'], 'parentSequence': attempt_sequence-1 if attempt_sequence>1 else None,
                       'relation': 'continuation' if attempt_sequence>1 else 'initial'}
            content_parts = []
            complete = False
            streamed = False
            provider_request_id = None
            try:
                if not self.authority.authorize(attempt=attempt):
                    return self.refuse(handler)
                stage = "dispatch-authorization"
                if not self.authority.authorize() or self.stop.is_set() or time.time() >= self.deadline:
                    return self.refuse(handler)
                upstream = Request(self.target, body, {
                    "Content-Type": "application/json", "Authorization": "Bearer " + self.provider_key,
                }, method="POST")
                stage = "provider-http"
                # No caller URLs, redirects or HTTP retries may escape the physical attempt fence.
                from urllib.request import HTTPRedirectHandler, build_opener

                class NoRedirect(HTTPRedirectHandler):
                    def redirect_request(self, *_args, **_kwargs):
                        return None

                with build_opener(NoRedirect).open(upstream, timeout=max(1, self.deadline - time.time())) as response:
                    provider_request_id = response.headers.get("x-request-id")
                    if "text/event-stream" in response.headers.get("Content-Type", ""):
                        streamed = True
                        handler.send_response(response.status)
                        handler.send_header("Content-Type", "text/event-stream")
                        handler.send_header("Connection", "close")
                        handler.end_headers()
                        handler.close_connection = True
                        published = True
                        reply_bytes = 0
                        def accept_calls(calls):
                            with self.lock:
                                known = self.state.setdefault('toolCalls', {})
                                if len(known) + len(calls) > self.request['toolGrant']['policy']['maxCalls']:
                                    raise ValueError('Aggregate tool call count exceeded')
                                for selected in calls:
                                    if selected['id'] in known:
                                        raise ValueError('Repeated model tool call ID')
                                    known[selected['id']] = digest(document(selected))
                                write_state(self.directory, self.state)
                        iterator = validated_tool_frames(response, self.stop, self.deadline, self.request['profile']['model'], self.request['toolGrant'], accept_calls) if self.request.get('toolGrant') else validated_frames(response, self.stop, self.deadline, self.request['profile']['model'])
                        for frame in iterator:
                            content_parts.append(frame)
                            if self.stop.is_set():
                                raise ValueError("Model response was stopped before publication")
                            if frame == b"data: [DONE]\n\n":
                                self.reply_validated = True
                                complete = True
                            handler.wfile.write(frame)
                            handler.wfile.flush()
                            reply_bytes += len(frame)
                        replace_json(self.directory / "broker-status.json", {
                            "stage": "reply-published", "requests": self.state["requests"], "replyBytes": reply_bytes,
                        })
                        return
                    reply = read_text_reply(response, self.stop, self.deadline)
                    self.reply_validated = True
                    complete = True
                    content_parts.append(reply)
                    replace_json(self.directory / "broker-status.json", {
                        "stage": "reply-validated", "requests": self.state["requests"], "replyBytes": len(reply),
                    })
                    handler.send_response(response.status)
                    handler.send_header("Content-Type", response.headers.get("Content-Type", "application/json"))
                    handler.send_header("Content-Length", str(len(reply)))
                    handler.send_header("Connection", "close")
                    handler.end_headers()
                    handler.wfile.write(reply)
                    handler.wfile.flush()
                    replace_json(self.directory / "broker-status.json", {
                        "stage": "reply-published", "requests": self.state["requests"], "replyBytes": len(reply),
                    })
            finally:
                report = attempt_outcome(attempt_sequence, request_hash, b''.join(content_parts), 'openai', streamed, complete, request_id=provider_request_id)
                with self.lock:
                    self.state.setdefault('attempts', []).append(report)
                    write_state(self.directory, self.state)
                self.authority.authorize(outcome=report)
                with self.lock:
                    self.inflight -= 1
                    if self.inflight == 0:
                        self.settled.set()
        except (BrokenPipeError, ConnectionResetError):
            return
        except Exception as error:
            reasons = {
                "Provider input exceeds its conservative reservation": "input-bound",
                "Unqualified model or tool request": "model-or-tools",
                "Unqualified model transcript": "transcript-count",
                "Unqualified model message": "message-role",
                "Only bounded text model content is qualified": "nontext-content",
                "Multiple completions exceed the admitted attempt": "multiple-completions",
                "Missing or widened output limit": "output-limit",
                "Model attempted an unauthorized tool call": "unauthorized-tool-reply",
            }
            replace_json(self.directory / "broker-status.json", {
                "stage": stage, "errorType": type(error).__name__,
                "requests": self.state["requests"], "http": getattr(error, "code", None),
                "reason": reasons.get(str(error), "provider-or-transport"),
            })
            if published:
                handler.close_connection = True
                return
            try:
                self.refuse(handler, 502)
            except (BrokenPipeError, ConnectionResetError):
                return

    def start(self) -> None:
        threading.Thread(target=self.server.serve_forever, daemon=True).start()

    def close(self) -> None:
        self.stop.set()
        self.server.shutdown()
        self.server.server_close()
        # A cancellation acknowledgement is not a join. Retain this owner until its
        # actual paid-request handler settles under the original network deadline.
        # If even that cannot be proved, the caller must retain unknown/stopped=false.
        self.settled.wait(max(0, self.deadline + 5 - time.time()))
