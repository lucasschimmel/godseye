"""A text-only model response boundary; hallucinated tool calls never reach Hermes."""

import json
import time

MAX_REPLY_BYTES = 2 * 1024 * 1024
MAX_FRAME_BYTES = 65536


def validated_frames(response, stop, deadline: float, model: str):
    """Release only complete text-only SSE frames; unfinished transports never succeed."""
    pending, total, frames, finished, done, text_bytes = b"", 0, 0, False, False, 0
    while not stop.is_set() and time.time() < deadline:
        chunk = response.read1(4096)
        if not chunk:
            break
        total += len(chunk)
        if total > MAX_REPLY_BYTES:
            raise ValueError("Model response exceeds its transport bound")
        pending += chunk
        pending = pending.replace(b"\r\n", b"\n")
        while b"\n\n" in pending:
            frame, pending = pending.split(b"\n\n", 1)
            frames += 1
            if len(frame) > MAX_FRAME_BYTES or frames > 4096 or done:
                raise ValueError("Invalid model stream framing")
            lines = frame.decode("utf-8", errors="strict").splitlines()
            if any(line and not line.startswith(("data:", ":")) for line in lines):
                raise ValueError("Invalid model stream fields")
            data = "\n".join(line[5:].lstrip() for line in lines if line.startswith("data:"))
            if not data:
                continue
            if data == "[DONE]":
                if not finished:
                    raise ValueError("Model stream has no terminal completion")
                done = True
            else:
                value = json.loads(data)
                text_only(value)
                if not isinstance(value, dict) or value.get("object") != "chat.completion.chunk":
                    raise ValueError("Invalid model stream chunk")
                if value.get("model") != model:
                    raise ValueError("Unqualified response model")
                choices = value.get("choices")
                if not isinstance(choices, list) or len(choices) > 1:
                    raise ValueError("Invalid model stream choices")
                for choice in choices:
                    if (not isinstance(choice, dict) or choice.get("index") != 0
                            or not isinstance(choice.get("delta"), dict)):
                        raise ValueError("Invalid model stream choice")
                    delta = choice["delta"]
                    if any(key not in {"role", "content", "reasoning_content", "reasoning", "refusal"} for key in delta):
                        raise ValueError("Invalid model text delta")
                    if any(item is not None and not isinstance(item, str) for item in delta.values()):
                        raise ValueError("Invalid model text delta")
                    content = delta.get("content") or ""
                    text_bytes += len(content.encode())
                    if len(content.encode()) > 4096 or text_bytes > 32768:
                        raise ValueError("Model output text exceeds its bound")
                    reason = choice.get("finish_reason")
                    if reason is not None:
                        if reason not in ("stop", "length") or finished:
                            raise ValueError("Invalid model completion reason")
                        finished = True
                    elif finished:
                        raise ValueError("Model text followed terminal completion")
            if not done:
                yield ("data: " + data + "\n\n").encode()
        if len(pending) > MAX_FRAME_BYTES:
            raise ValueError("Model response frame exceeds its bound")
    if stop.is_set() or time.time() >= deadline or pending.strip() or not done:
        raise ValueError("Model response stopped or truncated before completion")
    yield b"data: [DONE]\n\n"


def text_only(value: object, depth: int = 0) -> None:
    if depth > 12:
        raise ValueError("Model response structure exceeds its bound")
    if isinstance(value, dict):
        for key, item in value.items():
            if (key in ("tool_calls", "function_call") and item) or (
                    key == "finish_reason" and item in ("tool_calls", "function_call")):
                raise ValueError("Model attempted an unauthorized tool call")
            text_only(item, depth + 1)
    elif isinstance(value, list):
        if len(value) > 4096:
            raise ValueError("Model response collection exceeds its bound")
        for item in value:
            text_only(item, depth + 1)


def read_text_reply(response, stop, deadline: float) -> bytes:
    """Buffer at most one capped completion and validate before releasing any tool-shaped payload."""
    chunks, size = [], 0
    while not stop.is_set() and time.time() < deadline:
        chunk = response.read1(4096)
        if not chunk:
            break
        size += len(chunk)
        if size > MAX_REPLY_BYTES:
            raise ValueError("Model response exceeds its transport bound")
        chunks.append(chunk)
    if stop.is_set() or time.time() >= deadline:
        raise ValueError("Model response was stopped before publication")
    content = b"".join(chunks)
    if "text/event-stream" in response.headers.get("Content-Type", ""):
        for event in content.decode("utf-8").replace("\r\n", "\n").split("\n\n"):
            data = "\n".join(line[5:].lstrip() for line in event.splitlines() if line.startswith("data:"))
            if data and data != "[DONE]":
                text_only(json.loads(data))
    else:
        text_only(json.loads(content))
    return content
