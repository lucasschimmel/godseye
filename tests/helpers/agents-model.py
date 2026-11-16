"""Disposable loopback OpenAI chat fixture; emits metadata only, never provider material."""

from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import hashlib
import sys
import threading
import time

requests: list[dict] = []
lock = threading.Lock()
tool_reply = "--tool-reply" in sys.argv
hold_reply = "--hold-reply" in sys.argv
incremental_reply = "--incremental-reply" in sys.argv
truncate_reply = "--truncate-reply" in sys.argv
release = threading.Event()
tools_script: list[dict] | None = None
if "--tools-script" in sys.argv:
    tools_script = json.loads(sys.argv[sys.argv.index("--tools-script") + 1])
    if not isinstance(tools_script, list) or len(tools_script) > 5:
        raise ValueError("Fixture tool script is not finite")


class Model(BaseHTTPRequestHandler):
    def log_message(self, _format: str, *args: object) -> None:
        pass

    def do_POST(self) -> None:
        if self.path != "/v1/chat/completions":
            self.send_error(404)
            return
        length = int(self.headers.get("Content-Length", "0"))
        if not 0 < length <= 131072:
            self.send_error(413)
            return
        value = json.loads(self.rfile.read(length))
        with lock:
            request_index = len(requests)
            requests.append({"model": value.get("model"), "tools": bool(value.get("tools")),
                             "maxOutputTokens": value.get("max_completion_tokens", value.get("max_tokens")),
                             "n": value.get("n", 1), "stream": bool(value.get("stream")),
                             "skillLoaded": "G.O.D.S.E.Y.E context" in json.dumps(value.get("messages", [])),
                             "messages": [{"role": message.get("role"),
                                           "sha256": hashlib.sha256(str(message.get("content", "")).encode()).hexdigest()}
                                          for message in value.get("messages", [])],
                             **({"offeredTools": [entry.get("function", {}).get("name")
                                                   for entry in value.get("tools", [])],
                                 "toolResponses": [{"callId": message.get("tool_call_id"),
                                                    "sha256": hashlib.sha256(str(message.get("content", "")).encode()).hexdigest()}
                                                   for message in value.get("messages", [])
                                                   if message.get("role") == "tool"]}
                                if tools_script is not None else {})})
        scripted_call = (tools_script[request_index]
                         if tools_script is not None and request_index < len(tools_script) else None)
        text = "Hermes native fixture finished safely."
        if hold_reply:
            release.wait(120)
        common = {"id": "chatcmpl-native-fixture", "object": "chat.completion.chunk",
                  "created": int(time.time()), "model": value.get("model")}
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream" if value.get("stream") else "application/json")
        self.send_header("Connection", "close")
        self.end_headers()
        if value.get("stream"):
            chunks = [
                {**common, "choices": [{"index": 0, "delta": {"role": "assistant", "content": text}, "finish_reason": None}]},
                {**common, "choices": [{"index": 0, "delta": {}, "finish_reason": "stop"}]},
                {**common, "choices": [], "usage": {"prompt_tokens": 32, "completion_tokens": 11, "total_tokens": 43}},
            ]
            if tool_reply or scripted_call is not None:
                chunks[0]["choices"][0]["delta"] = {"tool_calls": [{"index": 0, "id": "call_denied", "type": "function", "function": {"name": "unsafe_system_tool", "arguments": "{}"}}]}
                chunks[1]["choices"][0]["finish_reason"] = "tool_calls"
                if scripted_call is not None:
                    chunks[0]["choices"][0]["delta"]["tool_calls"][0] = {
                        "index": 0, "id": f"call_fixture_{request_index}", "type": "function",
                        "function": {"name": scripted_call["name"],
                                     "arguments": json.dumps(scripted_call["arguments"])}}
            for chunk in chunks:
                if incremental_reply and chunk is chunks[0] and not tool_reply:
                    first = {**common, "choices": [{"index": 0, "delta": {"role": "assistant", "content": "Hermes native "}, "finish_reason": None}]}
                    self.wfile.write(("data: " + json.dumps(first) + "\n\n").encode())
                    self.wfile.flush()
                    release.wait(120)
                    chunk["choices"][0]["delta"]["content"] = "fixture finished safely."
                self.wfile.write(("data: " + json.dumps(chunk) + "\n\n").encode())
            if not truncate_reply:
                self.wfile.write(b"data: [DONE]\n\n")
        else:
            message = {"role": "assistant", "content": text}
            if tool_reply or scripted_call is not None:
                message = {"role": "assistant", "content": None, "tool_calls": [{"id": "call_denied", "type": "function", "function": {"name": "unsafe_system_tool", "arguments": "{}"}}]}
                if scripted_call is not None:
                    message["tool_calls"][0] = {"id": f"call_fixture_{request_index}", "type": "function",
                                               "function": {"name": scripted_call["name"],
                                                            "arguments": json.dumps(scripted_call["arguments"])}}
            self.wfile.write(json.dumps({**common, "object": "chat.completion",
                "choices": [{"index": 0, "message": message, "finish_reason": "tool_calls" if tool_reply or scripted_call is not None else "stop"}],
                "usage": {"prompt_tokens": 32, "completion_tokens": 11, "total_tokens": 43}}).encode())
        self.wfile.flush()


def main() -> None:
    server = ThreadingHTTPServer(("127.0.0.1", 0), Model)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    print(json.dumps({"kind": "ready", "port": server.server_address[1]}), flush=True)
    try:
        for line in sys.stdin:
            message = json.loads(line)
            if message == {"kind": "stats"}:
                with lock:
                    print(json.dumps({"kind": "stats", "requests": requests}), flush=True)
            elif message == {"kind": "stop"}:
                release.set()
                return
            elif message == {"kind": "release"}:
                release.set()
                print(json.dumps({"kind": "released"}), flush=True)
            else:
                raise ValueError("Unknown fixture command")
    finally:
        release.set()
        server.shutdown()
        server.server_close()
        thread.join(timeout=2)


if __name__ == "__main__":
    main()
