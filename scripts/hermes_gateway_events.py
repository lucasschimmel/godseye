"""Bounded native Runs text observer, with one acknowledged IPC event in flight."""

import json
import threading
import time
from urllib.request import Request, build_opener
from hermes_gateway_transport import NoRedirect


class RunEvents:
    def __init__(self, state: dict, send, stop, deadline: float) -> None:
        self.state, self.send, self.stop, self.deadline = state, send, stop, deadline
        self.ack = threading.Event()
        self.pending = None
        self.sequence = -1
        self.failed = False
        self.thread = threading.Thread(target=self.read, daemon=True)

    def receive(self, message: dict) -> None:
        if (set(message) != {"kind", "sequence", "allowed"}
                or message.get("sequence") != self.pending or message.get("allowed") is not True):
            self.stop.set()
        self.ack.set()

    def emit(self, sequence: int, text: str) -> None:
        # Refuse oversized upstream callbacks instead of inventing a second native sequence.
        if len(text.encode()) > 4096:
            raise ValueError("Native text delta exceeds its bound")
        self.pending = sequence
        self.ack.clear()
        self.send({"kind": "event", "event": {"type": "text.delta", "sequence": sequence,
                   "providerRunId": self.state["providerRunId"], "text": text}})
        while not self.stop.is_set() and time.time() < self.deadline:
            if self.ack.wait(0.1):
                self.pending = None
                return
        raise ValueError("Progress acknowledgement expired")

    def read(self) -> None:
        try:
            request = Request(f"http://127.0.0.1:{self.state['apiPort']}/v1/runs/{self.state['providerRunId']}/events",
                              headers={"Authorization": "Bearer " + self.state["apiKey"]})
            with build_opener(NoRedirect).open(request, timeout=max(1, self.deadline - time.time())) as response:
                lines, size, total = [], 0, 0
                while not self.stop.is_set() and time.time() < self.deadline:
                    raw = response.readline(65537)
                    if not raw:
                        if lines:
                            raise ValueError("Truncated native event")
                        return
                    size += len(raw)
                    total += len(raw)
                    if size > 65536 or total > 2 * 1024 * 1024:
                        raise ValueError("Native stream exceeds its bound")
                    line = raw.decode("utf-8", errors="strict").rstrip("\r\n")
                    if line:
                        lines.append(line)
                        continue
                    data = "\n".join(item[5:].lstrip() for item in lines if item.startswith("data:"))
                    ids = [item[3:].strip() for item in lines if item.startswith("id:")]
                    lines, size = [], 0
                    if not data:
                        continue
                    event = json.loads(data)
                    if not isinstance(event, dict) or event.get("run_id") != self.state["providerRunId"]:
                        raise ValueError("Foreign native event")
                    sequence = event.get("seq")
                    if (type(sequence) is not int or not 0 <= sequence <= 9007199254740991
                            or sequence <= self.sequence or ids != [str(sequence)]):
                        raise ValueError("Invalid native event sequence")
                    self.sequence = sequence
                    if event.get("event") == "message.delta":
                        text = event.get("delta")
                        if not isinstance(text, str):
                            raise ValueError("Invalid native delta")
                        if text:
                            self.emit(sequence, text)
        except Exception:
            self.failed = True
            self.stop.set()

    def start(self) -> None:
        self.thread.start()

    def join(self, timeout: float = 5) -> bool:
        self.thread.join(timeout)
        return not self.thread.is_alive()
