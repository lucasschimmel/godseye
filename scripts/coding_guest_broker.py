"""Task-private bounded vendor broker; never imports CLI auth or accepts guest URLs.

No request retries, redirect following, usage refunds or inferred zero-cost outcomes.
The durable conservative debit precedes every possible HTTP effect. These prices
are reviewed public list prices, not an assertion of a user's vendor entitlement.
"""
import importlib.util
_evidence_spec = importlib.util.spec_from_file_location("model_attempt_evidence", __import__("pathlib").Path(__file__).with_name("model_attempt_evidence.py"))
_evidence_module = importlib.util.module_from_spec(_evidence_spec)
_evidence_spec.loader.exec_module(_evidence_module)
attempt_outcome = _evidence_module.outcome
from datetime import datetime, timezone
import base64
import fcntl
import hashlib
import http.client
import json
import math
import os
from pathlib import Path
import re
import ssl
import time

PRICE_EXPIRY = '2026-11-21T00:00:00+00:00'
PRICE_REVIEW = '2026-11-14T00:00:00+00:00'
CATALOG = {
    # Mini list $0.75/$4.50; conservatively include 2x/1.5x family multipliers.
    'codex': {'model': 'gpt-5.4-mini', 'host': 'api.openai.com', 'path': '/v1/responses',
              'inputMicrosPerToken': 1.5, 'outputMicrosPerToken': 6.75,
              'source': 'https://developers.openai.com/api/docs/models/gpt-5.4-mini'},
    # Haiku list $0.10/$0.50 <=100K and $0.50/$2.50 above; reserve worst
    # context plus 2x one-hour cache-write input. Cache hints are also stripped.
    'claude-code': {'model': 'claude-haiku-5-5', 'host': 'api.anthropic.com', 'path': '/v1/messages',
                    'inputMicrosPerToken': 1, 'outputMicrosPerToken': 2.5,
                    'source': 'https://platform.claude.com/docs/en/about-claude/pricing'},
}
BOUNDS = {'maxRequests': 16, 'maxRequestBytes': 262144, 'maxResponseBytes': 786432,
          'maxOutputTokens': 4096, 'requestTimeoutSeconds': 60}
OPENAI_FIELDS = {'model', 'input', 'instructions', 'tools', 'tool_choice', 'parallel_tool_calls',
                 'reasoning', 'text', 'stream', 'store', 'max_output_tokens', 'include',
                 'service_tier', 'prompt_cache_key', 'prompt_cache_retention', 'metadata',
                 'temperature', 'top_p', 'truncation'}
CLAUDE_FIELDS = {'model', 'messages', 'system', 'tools', 'tool_choice', 'max_tokens', 'stream',
                 'thinking', 'temperature', 'top_p', 'top_k', 'stop_sequences', 'metadata',
                 'service_tier', 'output_config'}
DENIED_TYPES = {'web_search', 'web_search_preview', 'computer', 'computer_20250124',
                'computer_20251124', 'code_interpreter', 'file_search', 'mcp', 'mcp_toolset',
                'input_image', 'image', 'input_file', 'document', 'container_upload',
                'server_tool_use', 'web_fetch_20250910', 'web_search_20250305'}


def _instant(value: str) -> float:
    moment = datetime.fromisoformat(value.replace('Z', '+00:00'))
    if moment.tzinfo is None:
        raise ValueError('Timezone required')
    return moment.timestamp()


def validate(config: dict, limits: dict) -> None:
    """Validate trusted private configuration without reading credentials or networking."""
    if not isinstance(config, dict) or set(config) != {'runner', 'model', 'apiKey', *BOUNDS}:
        raise ValueError('Invalid broker binding fields')
    price = CATALOG.get(config['runner'])
    if not price or config['model'] != price['model']:
        raise ValueError('Model has no reviewed bounded price')
    now = time.time()
    if not _instant(PRICE_REVIEW) <= now < _instant(PRICE_EXPIRY):
        raise ValueError('Broker price review is stale or from the future')
    key = config['apiKey']
    if not isinstance(key, str) or not 16 <= len(key) <= 1024 or any(not 33 <= ord(c) <= 126 for c in key):
        raise ValueError('Invalid private broker authentication')
    for field, maximum in BOUNDS.items():
        if type(config[field]) is not int or not 1 <= config[field] <= maximum:
            raise ValueError('Invalid broker resource bound')
    if type(limits.get('maxCostMicros')) is not int or not 1000 <= limits['maxCostMicros'] <= 1000000:
        raise ValueError('Invalid task billing ceiling')


def _scrub(value: object, depth: int = 0, schema: bool = False) -> object:
    if depth > 40:
        raise ValueError('Model input nesting exceeds bound')
    if isinstance(value, list):
        if len(value) > 512:
            raise ValueError('Model input item count exceeds bound')
        return [_scrub(item, depth + 1, schema) for item in value]
    if isinstance(value, dict):
        kind = value.get('type')
        if len(value) > 512 or (not schema and isinstance(kind, str) and kind in DENIED_TYPES):
            raise ValueError('Remote model tool or content is forbidden')
        if '$ref' in value and (not isinstance(value['$ref'], str) or not value['$ref'].startswith('#/')):
            raise ValueError('External tool schema references are forbidden')
        if not schema and any(key in value for key in ('encrypted_content', 'file_id', 'image_url', 'mcp_servers')):
            raise ValueError('Opaque or remotely fetched model content is forbidden')
        return {key: _scrub(item, depth + 1, schema) for key, item in value.items() if key != 'cache_control'}
    if isinstance(value, (str, int, float, bool)) or value is None:
        return value
    raise ValueError('Unsupported model input value')


def _codex_metadata(value: object) -> None:
    """Validate bounded pinned-CLI diagnostics only; they never carry authority upstream."""
    fields = {'thread_id', 'session_id', 'turn_id', 'root_turn_id', 'x-codex-installation-id',
              'x-codex-window-id', 'x-codex-turn-metadata'}
    if not isinstance(value, dict) or not set(value).issubset(fields) or len(json.dumps(value).encode()) > 8192:
        raise ValueError('Unreviewed Codex client metadata')
    for key, item in value.items():
        if not isinstance(item, str) or not 1 <= len(item.encode()) <= 4096:
            raise ValueError('Invalid Codex client metadata value')
        if key == 'x-codex-turn-metadata':
            turn = json.loads(item)
            known = {'installation_id', 'session_id', 'thread_id', 'agent_name', 'turn_id', 'window_id',
                     'window_number', 'context_window_id', 'request_kind', 'history_initialization',
                     'root_turn_id', 'thread_source', 'turn_trigger', 'sandbox', 'sandbox_mode',
                     'auto_review_enabled', 'node_repl_auto_review_required', 'node_repl_disabled',
                     'workspaces', 'turn_started_at_unix_ms', 'analytics_enabled', 'model', 'reasoning_effort'}
            if not isinstance(turn, dict) or not set(turn).issubset(known):
                raise ValueError('Unreviewed Codex turn metadata fields')
            if 'reasoning_effort' in turn and turn['reasoning_effort'] != 'none':
                raise ValueError('Unreviewed Codex diagnostic reasoning effort')
            workspaces = turn.pop('workspaces', {})
            if not isinstance(workspaces, dict) or not set(workspaces).issubset({'/workspace'}):
                raise ValueError('Invalid Codex metadata workspace')
            for info in workspaces.values():
                if (not isinstance(info, dict) or set(info) != {'latest_git_commit_hash', 'has_changes'} or
                        not isinstance(info['latest_git_commit_hash'], str) or
                        not re.fullmatch('[a-f0-9]{40}', info['latest_git_commit_hash']) or type(info['has_changes']) is not bool):
                    raise ValueError('Invalid Codex metadata source description')
            if any(not isinstance(entry, (str, int, bool)) or
                   (isinstance(entry, str) and (len(entry.encode()) > 512 or '://' in entry)) for entry in turn.values()):
                raise ValueError('Invalid Codex turn metadata values')
        elif not re.fullmatch('[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}' +
                              (':[0-9]{1,6}' if key == 'x-codex-window-id' else ''), item):
            raise ValueError('Invalid Codex metadata identifier')


def _codex_tool(tool: object, count: list[int], namespace: bool = True) -> None:
    """Validate only local function/custom definitions, optionally grouped once."""
    count[0] += 1
    if not isinstance(tool, dict) or count[0] > 64:
        raise ValueError('Codex local tool count or shape exceeds bound')
    if not isinstance(tool.get('name'), str) or not re.fullmatch('[A-Za-z0-9_.-]{1,128}', tool['name']):
        raise ValueError('Invalid Codex local tool name')
    description = tool.get('description')
    if description is not None and (not isinstance(description, str) or len(description.encode()) > 32768):
        raise ValueError('Codex tool description exceeds bound')
    kind = tool.get('type')
    if kind == 'namespace' and namespace:
        if (set(tool) != {'type', 'name', 'description', 'tools'} or not isinstance(tool['description'], str) or
                not isinstance(tool['tools'], list) or not 1 <= len(tool['tools']) <= 32):
            raise ValueError('Unreviewed Codex namespace shape')
        for child in tool['tools']:
            _codex_tool(child, count, namespace=False)
    elif kind == 'function':
        if (not set(tool).issubset({'type', 'name', 'description', 'strict', 'parameters'}) or
                not isinstance(tool.get('parameters'), dict) or
                (tool.get('strict') is not None and type(tool['strict']) is not bool)):
            raise ValueError('Unreviewed Codex function definition')
    elif kind == 'custom':
        if not set(tool).issubset({'type', 'name', 'description', 'format'}):
            raise ValueError('Unreviewed Codex custom definition')
        form = tool.get('format', {'type': 'text'})
        if form != {'type': 'text'}:
            if (not isinstance(form, dict) or set(form) != {'type', 'syntax', 'definition'} or
                    form['type'] != 'grammar' or form['syntax'] not in ('lark', 'regex') or
                    not isinstance(form['definition'], str) or len(form['definition'].encode()) > 32768):
                raise ValueError('Unreviewed Codex custom input format')
    else:
        raise ValueError('Only bounded local Codex tools may be advertised')


def _codex_hints(body: dict) -> None:
    if 'client_metadata' in body:
        _codex_metadata(body.pop('client_metadata'))
    include = body.pop('include', None)
    if include not in (None, [], ['reasoning.encrypted_content']):
        raise ValueError('Unreviewed Codex output include hint')
    reasoning = body.get('reasoning', {})
    if (not isinstance(reasoning, dict) or not set(reasoning).issubset({'effort', 'summary'}) or
            reasoning.get('effort') not in (None, 'none', 'minimal', 'low', 'medium', 'high', 'xhigh') or
            reasoning.get('summary') not in (None, 'auto', 'concise', 'detailed')):
        raise ValueError('Unreviewed Codex reasoning request')
    # The allowlisted mini explicitly supports none. Never send opaque reasoning
    # hints or accept encrypted context whose token cost cannot be bounded.
    body['reasoning'] = {'effort': 'none'}


def _payload(request: dict, config: dict) -> tuple[bytes, int]:
    price = CATALOG[config['runner']]
    path = request.get('path', '').split('?', 1)[0]
    allowed = (price['path'], price['path'].removeprefix('/v1'))
    if request.get('method') != 'POST' or path not in allowed:
        raise ValueError('Broker route denied')
    raw = request.get('body')
    if not isinstance(raw, str) or len(raw.encode()) > config['maxRequestBytes']:
        raise ValueError('Broker request exceeds byte bound')
    body = json.loads(raw)
    if not isinstance(body, dict) or body.get('model') != config['model']:
        raise ValueError('Guest requested a model outside its frozen binding')
    if config['runner'] == 'codex':
        _codex_hints(body)
    if config['runner'] == 'claude-code' and 'context_management' in body:
        # Pinned Claude emits this optional no-op for Haiku5.5's keep-all
        # default. Validate its entire observed documented shape, then disable
        # server context editing; no beta features or extra authority propagate.
        if body['context_management'] != {'edits': [{'type': 'clear_thinking_20251015', 'keep': 'all'}]}:
            raise ValueError('Unreviewed Claude context management request')
        del body['context_management']
    fields = OPENAI_FIELDS if config['runner'] == 'codex' else CLAUDE_FIELDS
    if not set(body).issubset(fields) or body.get('service_tier') not in (None, 'default', 'auto', 'standard_only'):
        raise ValueError('Unreviewed or premium model request fields')
    tools = body.get('tools', [])
    if not isinstance(tools, list) or len(tools) > 64:
        raise ValueError('Local CLI tool count or shape exceeds bound')
    count = [0]
    for tool in tools:
        if config['runner'] == 'codex':
            _codex_tool(tool, count)
        elif not isinstance(tool, dict) or tool.get('type', 'function') not in ('function', 'custom'):
            raise ValueError('Only local CLI tools may be advertised')
    # Validated local definitions contain schemas with property names such as
    # image_url. These are declarations, not actual externally fetched inputs.
    # Scrub real input separately; external schema references remain forbidden.
    if config['runner'] == 'codex' and 'tools' in body:
        definitions = body.pop('tools')
        body = _scrub(body)
        body['tools'] = _scrub(definitions, schema=True)
    else:
        body = _scrub(body)
    body['stream'] = True
    if config['runner'] == 'codex':
        if body.get('include') or body.get('prompt_cache_retention'):
            raise ValueError('Opaque response state or extended caching is forbidden')
        body['store'] = False
        body['service_tier'] = 'default'
        body['max_output_tokens'] = config['maxOutputTokens']
    else:
        body['service_tier'] = 'standard_only'
        body['max_tokens'] = config['maxOutputTokens']
        body['thinking'] = {'type': 'disabled'}
    data = json.dumps(body, ensure_ascii=False, sort_keys=True, separators=(',', ':'), allow_nan=False).encode()
    if len(data) > config['maxRequestBytes']:
        raise ValueError('Normalized model input exceeds bound')
    # A byte is a conservative upper bound for text tokens. Twice the complete
    # wire bytes plus 8192 bounds role/tool/schema framing for <=512 items, and
    # rejects opaque context which could conceal unaccounted input tokens.
    input_upper = max(len(data), len(raw.encode())) * 2 + 8192
    if input_upper > 262144:
        raise ValueError('Model context exceeds reviewed conservative token bound')
    debit = math.ceil(input_upper * price['inputMicrosPerToken'] +
                      config['maxOutputTokens'] * price['outputMicrosPerToken'])
    return data, debit


def _active(state: dict) -> float:
    remaining = _instant(state['deadline']) - time.time()
    if state.get('revoked') or remaining <= 0:
        raise ValueError('Broker task capability revoked or expired')
    return remaining


def _authorize(state: dict) -> None:
    authorize = state.get('authorize')
    if not callable(authorize):
        raise ValueError('Trusted controller authorization callback required')
    _active(state)
    authorize()
    _active(state)


def _publish_ledger(path: Path, ledger: dict, suffix: str = '.pending') -> None:
    temporary = path.with_suffix(suffix)
    target = os.open(temporary, os.O_CREAT | os.O_EXCL | os.O_WRONLY | os.O_NOFOLLOW, 0o600)
    with os.fdopen(target, 'w') as stream:
        json.dump(ledger, stream)
        stream.flush()
        os.fsync(stream.fileno())
    os.replace(temporary, path)
    parent = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(parent)
    finally:
        os.close(parent)


def _completion_guard(path: Path, fingerprint: str) -> None:
    """Retain a durable fence across process death during completion publication."""
    guard = path.with_suffix('.completion-guard')
    descriptor = os.open(guard, os.O_CREAT | os.O_EXCL | os.O_WRONLY | os.O_NOFOLLOW, 0o600)
    with os.fdopen(descriptor, 'w') as stream:
        stream.write(fingerprint)
        stream.flush()
        os.fsync(stream.fileno())
    parent = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(parent)
    finally:
        os.close(parent)


def _debit(state: dict, config: dict, limits: dict, amount: int, fingerprint: str, complete: bool = False) -> None:
    """Reserve an irrevocable payload identity and charge, or finish that exact effect.

    The same lock/atomic durable publication covers counters and payload state.
    A process crash, missing terminal SSE or failed completion write leaves pending
    evidence and blocks every later request. No caller can reset uncertainty.
    """
    path = Path(state['journalPath'])
    if not path.is_absolute() or path.parent.resolve(strict=True) != path.parent or path.is_symlink():
        raise ValueError('Invalid broker journal location')
    lock_path = path.with_suffix('.lock')
    descriptor = os.open(lock_path, os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
    try:
        fcntl.flock(descriptor, fcntl.LOCK_EX)
        if any(path.with_suffix(suffix).exists() for suffix in ('.pending', '.uncertain', '.completion-guard')):
            raise ValueError('Broker journal has an incomplete durable publication')
        ledger = {'correlationId': state['correlationId'], 'requests': 0, 'reservedMicros': 0,
                  'fingerprints': [], 'pendingFingerprint': None}
        if path.exists():
            existing = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
            with os.fdopen(existing, 'r') as source:
                ledger = json.loads(source.read(8193))
        if (ledger['correlationId'] != state['correlationId'] or
                type(ledger['requests']) is not int or type(ledger['reservedMicros']) is not int or
                ledger['requests'] < 0 or ledger['reservedMicros'] < 0):
            raise ValueError('Broker journal identity or counters differ')
        fingerprints = ledger.get('fingerprints')
        if (not isinstance(fingerprints, list) or len(fingerprints) != ledger['requests'] or
                len(fingerprints) > BOUNDS['maxRequests'] or
                any(not isinstance(item, str) or not re.fullmatch('[a-f0-9]{64}', item) for item in fingerprints) or
                len(set(fingerprints)) != len(fingerprints)):
            raise ValueError('Legacy or inconsistent broker effects require reconciliation')
        if complete:
            if ledger.get('pendingFingerprint') != fingerprint or fingerprint not in fingerprints:
                raise ValueError('Broker completion does not match retained effect')
            _active(state)
            # The original pending debit remains durable until this guard is
            # itself durable. Only then may completion replace the ledger.
            _completion_guard(path, fingerprint)
            ledger['pendingFingerprint'] = None
        else:
            if ledger.get('pendingFingerprint') is not None or fingerprint in fingerprints:
                raise ValueError('Broker effect is duplicate or outcome is uncertain')
            if ledger['requests'] >= config['maxRequests'] or ledger['reservedMicros'] + amount > limits['maxCostMicros']:
                raise ValueError('Broker conservative billing ceiling exhausted')
            _active(state)
            ledger['requests'] += 1
            ledger['reservedMicros'] += amount
            ledger['fingerprints'].append(fingerprint)
            ledger['pendingFingerprint'] = fingerprint
            ledger['priceReview'] = PRICE_REVIEW
        try:
            _publish_ledger(path, ledger)
        except OSError:
            if complete:
                # replace() may already have exposed pending=None before the
                # parent fsync failed. Re-publish retained uncertainty using a
                # separate exclusive staging file; failed recovery also leaves
                # that staging evidence to fence the next process.
                ledger['pendingFingerprint'] = fingerprint
                _publish_ledger(path, ledger, suffix='.uncertain')
            raise
        if complete:
            # The cleared ledger is already fsynced, including its directory.
            # No directory fsync is required for this removal: a guard that
            # reappears after a crash can only reject further effects safely.
            path.with_suffix('.completion-guard').unlink()
        state['requests'] = ledger['requests']
        state['reservedMicros'] = ledger['reservedMicros']
    finally:
        os.close(descriptor)


def _terminal_stream(content: bytes, runner: str) -> None:
    """Require the vendor's terminal SSE event before releasing the pending effect."""
    lines = content.decode('utf-8').splitlines()
    events = []
    for line in lines:
        if line.startswith('data:'):
            data = line[5:].strip()
            if data and data != '[DONE]':
                events.append(json.loads(data))
        if len(events) > 8192:
            raise ValueError('Broker SSE event count exceeds bound')
    if not events or not isinstance(events[-1], dict):
        raise ValueError('Broker stream has no terminal event')
    terminal = events[-1]
    if runner == 'codex':
        if terminal.get('type') != 'response.completed' or terminal.get('response', {}).get('status') != 'completed':
            raise ValueError('Broker Responses stream ended before completion')
    elif terminal.get('type') != 'message_stop':
        raise ValueError('Broker Messages stream ended before completion')


def _post(data: bytes, state: dict, config: dict) -> tuple[int, str, bytes]:
    price = CATALOG[config['runner']]
    duration = min(config['requestTimeoutSeconds'], _active(state))
    end = time.monotonic() + duration
    connection = http.client.HTTPSConnection(price['host'], timeout=duration, context=ssl.create_default_context())
    headers = {'Content-Type': 'application/json', 'Accept': 'text/event-stream',
               'User-Agent': 'godseye-bounded-coding-broker/1'}
    if config['runner'] == 'codex':
        headers['Authorization'] = 'Bearer ' + config['apiKey']
    else:
        headers.update({'x-api-key': config['apiKey'], 'anthropic-version': '2023-06-01'})
    try:
        _authorize(state)
        connection.request('POST', price['path'], body=data, headers=headers)
        response = connection.getresponse()
        state["providerRequestId"] = response.getheader("x-request-id" if config["runner"] == "codex" else "request-id")
        if response.status != 200 or 'text/event-stream' not in response.getheader('Content-Type', ''):
            # Never forward vendor diagnostics, headers, redirects or authentication.
            raise ValueError('Vendor response unavailable or incompatible')
        chunks = []
        total = 0
        while True:
            remaining = min(end - time.monotonic(), _active(state))
            if remaining <= 0:
                raise ValueError('Broker response deadline exhausted')
            if connection.sock:
                connection.sock.settimeout(remaining)
            chunk = response.read1(min(16384, config['maxResponseBytes'] - total + 1))
            if not chunk:
                break
            total += len(chunk)
            if total > config['maxResponseBytes']:
                raise ValueError('Broker response exceeds byte bound')
            chunks.append(chunk)
        _active(state)
        return 200, 'text/event-stream', b''.join(chunks)
    finally:
        connection.close()


def handle(request: dict, state: dict, config: dict, limits: dict) -> dict:
    """Authorize, durably reserve then make at most one bounded official API POST."""
    try:
        validate(config, limits)
        _active(state)
        data, debit = _payload(request, config)
        fingerprint = hashlib.sha256(data).hexdigest()
        _authorize(state)
        _debit(state, config, limits, debit, fingerprint)
        sequence = state['requests']
        callback = state.get('attempts')
        if not callable(callback):
            raise ValueError('Acknowledged attempt accounting is unavailable')
        callback('attempt-intent', {'sequence':sequence,'requestHash':fingerprint,'provider':'openai' if config['runner']=='codex' else 'anthropic',
                                  'model':config['model'],'parentSequence':sequence-1 if sequence>1 else None,'relation':'continuation' if sequence>1 else 'initial'})
        content = b''
        state['providerRequestId'] = None
        complete = False
        try:
            status, content_type, content = _post(data, state, config)
            _terminal_stream(content, config['runner'])
            complete = True
        finally:
            report = attempt_outcome(sequence, fingerprint, content, 'openai' if config['runner']=='codex' else 'anthropic', True, complete, request_id=state.get('providerRequestId'))
            report_path = Path(state['journalPath']).parent / 'attempts.json'
            reports = json.loads(report_path.read_text()) if report_path.exists() else []
            reports.append(report)
            _publish_ledger(report_path, reports)
            callback('attempt-outcome', report)
        _terminal_stream(content, config['runner'])
        _debit(state, config, limits, 0, fingerprint, complete=True)
        return {'status': status, 'headers': {'content-type': content_type},
                'bodyBase64': base64.b64encode(content).decode()}
    except (ValueError, KeyError, TypeError, AttributeError, OSError, http.client.HTTPException):
        state['failedClosed'] = True
        content = json.dumps({'error': {'type': 'broker_policy_error',
                                       'message': 'Task model gateway unavailable or bounded policy denied'}}).encode()
        return {'status': 403, 'headers': {'content-type': 'application/json'},
                'bodyBase64': base64.b64encode(content).decode()}
