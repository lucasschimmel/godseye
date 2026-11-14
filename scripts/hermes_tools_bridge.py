"""Bounded private controller callbacks; transport identity is not tool authority."""
import json
import threading
import time


class ToolBridge:
    def __init__(self, send, stop, deadline: float) -> None:
        self.send, self.stop, self.deadline = send, stop, deadline
        self.lock = threading.Lock()
        self.pending = None
        self.sequence = 0
        self.prepared = False

    def invoke(self, kind: str, call: dict | None = None) -> str:
        with self.lock:
            if self.stop.is_set() or self.pending is not None or (kind == 'prepare-tools' and self.prepared):
                raise ValueError('Tool callback refused')
            self.sequence += 1
            sequence = self.sequence
            done, result = threading.Event(), []
            self.pending = (sequence, done, result)
        self.send({'kind': kind, 'sequence': sequence, **({'call': call} if call is not None else {})})
        done.wait(max(0, min(35, self.deadline - time.time())))
        with self.lock:
            self.pending = None
        if self.stop.is_set() or not result or result[0].get('allowed') is not True:
            raise ValueError('Tool callback authority expired')
        if kind == 'prepare-tools':
            self.prepared = True
            return ''
        value = result[0].get('result')
        if not isinstance(value, str) or len(value.encode()) > 32768:
            raise ValueError('Tool result bound exceeded')
        return value

    def receive(self, message: dict) -> None:
        with self.lock:
            if (set(message) - {'kind', 'sequence', 'allowed', 'result'} or message.get('kind') != 'tool-ack'
                    or self.pending is None or message.get('sequence') != self.pending[0]):
                self.stop.set()
                return
            self.pending[2].append(message)
            self.pending[1].set()
