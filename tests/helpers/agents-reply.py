"""Exercise the actual private reply gate with synthetic in-memory wire data."""
import io
import json
from pathlib import Path
import sys
import threading
import time

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "scripts"))
from hermes_gateway_reply import read_text_reply
from hermes_gateway_transport import observed


class Response:
    def __init__(self, data: bytes, stream: bool = False):
        self.data = io.BytesIO(data)
        self.headers = {"Content-Type": "text/event-stream" if stream else "application/json"}

    def read1(self, count: int) -> bytes:
        return self.data.read(count)


def wire(value: object, stream: bool) -> bytes:
    data = json.dumps(value).encode()
    return b"data: " + data + b"\n\ndata: [DONE]\n\n" if stream else data


text = {"choices": [{"message": {"role": "assistant", "content": "safe text"}, "finish_reason": "stop"}]}
accepted = 0
for stream in [False, True]:
    data = wire(text, stream)
    assert read_text_reply(Response(data, stream), threading.Event(), time.time() + 5) == data
    accepted += 1

refused = 0
for stream in [False, True]:
    for forbidden in ["tool_calls", "function_call"]:
        value = {"choices": [{"delta": {forbidden: {"name": "unauthorized", "arguments": "{}"}}}]}
        try:
            read_text_reply(Response(wire(value, stream), stream), threading.Event(), time.time() + 5)
        except ValueError:
            refused += 1
        else:
            raise AssertionError("Tool-shaped model payload crossed the actual reply boundary")

for response, stop, deadline in [
    (Response(b"x" * (2 * 1024 * 1024 + 1)), threading.Event(), time.time() + 5),
    (Response(wire(text, False)), threading.Event(), time.time() - 1),
]:
    try:
        read_text_reply(response, stop, deadline)
    except ValueError:
        refused += 1
    else:
        raise AssertionError("Unbounded or expired reply was published")

# A poll snapshot may precede the broker's monotone physical-attempt fence.
# Merging its result must never restore stale journal authority or a zero counter.
state = {"providerRunId": "run_" + "a" * 32, "requests": 0, "apiKey": "disposable-fixture-only"}
poll_snapshot = dict(state)
state["requests"] = 1
update = observed(poll_snapshot, {"run_id": state["providerRunId"], "object": "hermes.run", "status": "completed", "output": "safe text"})
assert not {"requests", "apiKey", "identity", "profile", "brokerPort"}.intersection(update)
state.update(update)
assert state["requests"] == 1

print(json.dumps({"acceptedText": accepted, "refused": refused, "attemptFencePreserved": True}))
