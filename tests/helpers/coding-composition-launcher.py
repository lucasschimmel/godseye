"""Test-only native controller entry: replace upstream HTTPS, preserve actual production main/run."""
import atexit
import base64
import importlib.util
import json
from pathlib import Path
import sys
import tempfile

workspace = Path(sys.argv[1])
if workspace != Path(__file__).resolve().parents[2] or sys.argv[2] not in ('readiness', 'source', 'preflight', 'run', 'inspect', 'stop'):
    raise ValueError('Unregistered test controller invocation')


def load(name, path):
    specification = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(specification)
    specification.loader.exec_module(module)
    return module


control = load('coding_guest_control', workspace / 'scripts/coding_guest_control.py')
original_load = control.load
fixture = load('coding_cli_fixture', workspace / 'scripts/coding_cli_fixture.py')
fixture_state = {}
capture_root = None
capture_counter = 0


def deny_unexpected_network(event: str, arguments: tuple) -> None:
    # Local AF_UNIX serial/interop remains real. A transport regression cannot
    # accidentally reach a vendor or DNS during this explicitly unpaid test.
    if event == 'socket.getaddrinfo' or (event == 'socket.connect' and isinstance(arguments[1], tuple)):
        raise RuntimeError('External network is disabled in the composition test')


sys.addaudithook(deny_unexpected_network)


class FixtureResponse:
    def __init__(self, response):
        self.status = response['status']
        self.headers = response['headers']
        self.body = base64.b64decode(response['bodyBase64'])
    def getheader(self, name, default=''):
        return self.headers.get(name.lower(), default)
    def read1(self, maximum):
        chunk, self.body = self.body[:maximum], self.body[maximum:]
        return chunk


class FixtureHTTPS:
    """Only the network I/O boundary is synthetic; broker policy and journal are untouched."""
    sock = None
    def __init__(self, host, **kwargs):
        if host not in ('api.openai.com', 'api.anthropic.com'):
            raise ValueError('Synthetic upstream only permits fixed official host bindings')
        self.response = None
    def request(self, method, path, body, headers):
        response = fixture.handle({'method': method, 'path': path, 'body': body.decode()}, fixture_state)
        self.response = FixtureResponse(response)
        value = json.loads(body)
        observed_tool = any(part.get('type') == 'tool_result' and not part.get('is_error', False)
                            for message in value.get('messages', []) if isinstance(message.get('content'), list)
                            for part in message['content'])
        items = value.get('input')
        if isinstance(items, list):
            observed_tool = observed_tool or any(isinstance(item, dict) and item.get('type') == 'function_call_output' for item in items)
        print('GODSEYE_TEST_REQUEST ' + json.dumps({'requests': fixture_state.get('requests', 0),
            'observedToolResult': observed_tool, 'status': response['status'], 'paidCalls': 0}), file=sys.stderr, flush=True)
    def getresponse(self):
        if self.response is None:
            raise ValueError('No synthetic upstream request')
        return self.response
    def close(self):
        pass


def scoped_load(name, path):
    module = original_load(name, path)
    if name == 'coding_guest_broker':
        module.http.client.HTTPSConnection = FixtureHTTPS
        actual_payload = module._payload
        def observed_payload(request, config):
            global capture_root, capture_counter
            raw = request.get('body', '')
            if isinstance(raw, str) and len(raw.encode()) <= 262144:
                if capture_root is None:
                    artifacts = workspace / 'artifacts/coding-composition-fixtures'
                    artifacts.mkdir(parents=True, exist_ok=True)
                    capture_root = Path(tempfile.mkdtemp(prefix='synthetic-', dir=artifacts))
                capture_counter += 1
                captured = capture_root / ('request-' + str(capture_counter) + '.json')
                captured.write_text(json.dumps({'method': request.get('method'), 'path': request.get('path'), 'body': raw}))
                print('GODSEYE_TEST_CAPTURE ' + json.dumps({'path': str(captured), 'bytes': len(raw.encode())}), file=sys.stderr, flush=True)
            try:
                return actual_payload(request, config)
            except (ValueError, KeyError, TypeError) as error:
                body = json.loads(request.get('body', '{}'))
                fields = module.OPENAI_FIELDS if config['runner'] == 'codex' else module.CLAUDE_FIELDS
                print('GODSEYE_TEST_POLICY ' + json.dumps({
                    'reason': str(error), 'extraFields': sorted(set(body) - fields),
                    'requestBytes': len(request.get('body', '').encode()),
                    'modelMatches': body.get('model') == config['model'],
                    'toolTypes': sorted({tool.get('type', 'function') for tool in body.get('tools', [])}),
                    'contextManagement': body.get('context_management'),
                }), file=sys.stderr, flush=True)
                raise
        module._payload = observed_payload
    return module


def report():
    print('GODSEYE_TEST_UPSTREAM ' + json.dumps({
        'requests': fixture_state.get('requests', 0),
        'commands': fixture_state.get('commands', []),
        'completed': fixture_state.get('completed', False),
        'paidCalls': 0,
    }), file=sys.stderr, flush=True)


control.load = scoped_load
atexit.register(report)
control.main()
