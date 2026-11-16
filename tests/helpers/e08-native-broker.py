"""Production Hermes Broker/Authority with ephemeral synthetic HTTP only; no Hermes home or API keys."""
import json
from pathlib import Path
import sys
import tempfile
import threading
import time
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.request import Request, urlopen
from urllib.error import HTTPError

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'scripts'))
from hermes_gateway_broker import Authority, Broker


def emit(value: dict) -> None:
    print(json.dumps(value), flush=True)


def main() -> None:
    config = json.loads(sys.stdin.readline())
    mode = config['mode']
    post_count = 0

    class Model(BaseHTTPRequestHandler):
        def log_message(self, *_args: object) -> None:
            pass

        def do_POST(self) -> None:
            nonlocal post_count
            self.rfile.read(int(self.headers['Content-Length']))
            post_count += 1
            emit({'kind': 'model-post'})
            common = {'id': 'synthetic-e08', 'object': 'chat.completion.chunk', 'model': 'gpt-6-luna'}
            frames = [{**common, 'choices': [{'index': 0, 'delta': {'content': 'synthetic'}, 'finish_reason': None}]},
                      {**common, 'choices': [{'index': 0, 'delta': {}, 'finish_reason': 'stop'}]},
                      {**common, 'choices': [], 'usage': {'prompt_tokens': 30, 'completion_tokens': 20,
                       'prompt_tokens_details': {'cached_tokens': 7}, 'completion_tokens_details': {'reasoning_tokens': 5}}}]
            body = ''.join('data: ' + json.dumps(row) + '\n\n' for row in frames).encode()
            if mode != 'truncated':
                body += b'data: [DONE]\n\n'
            self.send_response(200)
            self.send_header('Content-Type', 'text/event-stream')
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            self.wfile.flush()

    with tempfile.TemporaryDirectory(prefix='godseye-e08-native-') as temporary:
        directory = Path(temporary)
        model = ThreadingHTTPServer(('127.0.0.1', 0), Model)
        threading.Thread(target=model.serve_forever, daemon=True).start()
        stop = threading.Event()
        authority = Authority(config['taskId'], emit, stop)
        request = {'taskId': config['taskId'], 'deadline': datetime.fromtimestamp(time.time()+20, timezone.utc).isoformat(),
                   'profile': {'model': 'gpt-6-luna', 'limits': {'maxOutputTokens': 64,
                               'maxCostMicros': 10000, 'maxRequests': 1, 'timeoutSeconds': 20}}}
        state = {'brokerPort': 0, 'brokerKey': 'synthetic-task-broker-only', 'apiKey': 'synthetic-stop-only', 'requests': 0}
        broker = Broker(directory, state, request, 'synthetic-no-upstream-authority', authority, stop,
                        f'http://127.0.0.1:{model.server_address[1]}/v1')
        broker.start()

        def receive() -> None:
            for line in sys.stdin:
                authority.receive(json.loads(line))
        threading.Thread(target=receive, daemon=True).start()
        body = json.dumps({'model': 'gpt-6-luna', 'messages': [{'role': 'user', 'content': 'Synthetic only'}],
                           'max_completion_tokens': 64, 'stream': True}).encode()
        status = None
        try:
            outgoing = Request(f'http://127.0.0.1:{broker.server.server_address[1]}/v1/chat/completions', body,
                               {'Authorization': 'Bearer synthetic-task-broker-only', 'Content-Type': 'application/json'})
            with urlopen(outgoing, timeout=15) as response:
                status = response.status
                response.read()
        except HTTPError as error:
            status = error.code
        finally:
            broker.settled.wait(10)
            persisted = json.loads((directory/'runtime.json').read_text())
            emit({'kind': 'complete', 'status': status, 'posts': post_count, 'attempts': persisted.get('attempts', [])})
            broker.close()
            model.shutdown()
            model.server_close()


if __name__ == '__main__':
    main()
