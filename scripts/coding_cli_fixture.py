"""Bounded in-process fake vendor APIs for disposable-KVM CLI qualification.

This module never executes commands or contacts a vendor. The real guest CLI must
execute the fixed edit and test, then return their tool output before completion.
Fixture success establishes protocol compatibility, never paid model entitlement.
"""
import base64
import json
from typing import Any

MAX_REQUEST_BYTES = 1024 * 1024
MAX_REQUESTS = 16
COMMANDS = ("printf 'module.exports = 42;\\n' > answer.cjs", '/usr/bin/node --test answer.test.cjs')
SUMMARY = 'Synthetic edit complete; test passed.'


def _response(status: int, body: str, sse: bool = False) -> dict:
    return {'status': status, 'headers': {'content-type': 'text/event-stream' if sse else 'application/json'},
            'bodyBase64': base64.b64encode(body.encode()).decode()}


def _sse(events: list[tuple[str, dict]]) -> str:
    return ''.join('event: ' + name + '\ndata: ' + json.dumps(payload, separators=(',', ':')) + '\n\n'
                   for name, payload in events)


def _codex_tool(body: dict, command: str) -> tuple[str, str]:
    tools = body.get('tools', [])
    for preferred, argument in (('shell_command', 'command'), ('exec_command', 'cmd'), ('shell', 'command')):
        for tool in tools:
            name = tool.get('name', '')
            if name == preferred or name.endswith('.' + preferred):
                value: Any = ['/bin/sh', '-c', command] if preferred == 'shell' else command
                args: dict[str, Any] = {argument: value}
                properties = tool.get('parameters', {}).get('properties', {})
                if 'yield_time_ms' in properties:
                    args['yield_time_ms'] = 1000
                return name, json.dumps(args)
    raise ValueError('CLI did not expose a supported shell tool')


def _codex(body: dict, state: dict) -> str:
    turn = state.get('codexTurn', 0)
    tool_outputs = [item for item in body.get('input', [])
                    if isinstance(item, dict) and item.get('type') == 'function_call_output']
    if turn and not tool_outputs:
        raise ValueError('Missing observed guest tool result')
    if turn:
        state['lastToolOutput'] = str(tool_outputs[-1].get('output', ''))[:4096]
    if turn == 2 and not any('pass' in str(item.get('output', '')).lower() for item in tool_outputs):
        raise ValueError('Guest test success not observed')
    response_id = 'resp_fixture_' + str(turn)
    response = {'id': response_id, 'object': 'response', 'created_at': 1, 'status': 'in_progress',
                'model': body.get('model', 'fixture'), 'output': []}
    events = [('response.created', {'type': 'response.created', 'response': response})]
    if turn < len(COMMANDS):
        name, arguments = _codex_tool(body, COMMANDS[turn])
        item = {'id': 'fc_fixture_' + str(turn), 'type': 'function_call',
                'call_id': 'call_fixture_' + str(turn), 'name': name, 'arguments': arguments,
                'status': 'completed'}
        empty = {**item, 'arguments': '', 'status': 'in_progress'}
        events += [('response.output_item.added', {'type': 'response.output_item.added', 'output_index': 0, 'item': empty}),
                   ('response.function_call_arguments.delta', {'type': 'response.function_call_arguments.delta',
                    'item_id': item['id'], 'output_index': 0, 'delta': arguments}),
                   ('response.function_call_arguments.done', {'type': 'response.function_call_arguments.done',
                    'item_id': item['id'], 'output_index': 0, 'arguments': arguments})]
        state.setdefault('commands', []).append(COMMANDS[turn])
    else:
        text = SUMMARY
        if body.get('text', {}).get('format', {}).get('type') == 'json_schema':
            text = json.dumps({'summary': SUMMARY})
        item = {'id': 'msg_fixture', 'type': 'message', 'role': 'assistant', 'status': 'completed',
                'content': [{'type': 'output_text', 'text': text, 'annotations': []}]}
        events += [('response.output_item.added', {'type': 'response.output_item.added', 'output_index': 0,
                    'item': {**item, 'status': 'in_progress', 'content': []}}),
                   ('response.output_text.delta', {'type': 'response.output_text.delta', 'item_id': item['id'],
                    'output_index': 0, 'content_index': 0, 'delta': text})]
        state['completed'] = True
    events.append(('response.output_item.done', {'type': 'response.output_item.done', 'output_index': 0, 'item': item}))
    completed = {**response, 'status': 'completed', 'output': [item],
                 'usage': {'input_tokens': 10, 'output_tokens': 10, 'total_tokens': 20,
                           'input_tokens_details': {'cached_tokens': 0},
                           'output_tokens_details': {'reasoning_tokens': 0}}}
    events.append(('response.completed', {'type': 'response.completed', 'response': completed}))
    state['codexTurn'] = turn + 1
    return _sse(events)


def _claude(body: dict, state: dict) -> str:
    turn = state.get('claudeTurn', 0)
    results = [part for message in body.get('messages', []) if isinstance(message.get('content'), list)
               for part in message['content'] if isinstance(part, dict) and part.get('type') == 'tool_result']
    if turn and (not results or results[-1].get('is_error')):
        raise ValueError('Missing or failed observed guest tool result')
    if turn == 2 and 'pass' not in str(results[-1]).lower():
        raise ValueError('Guest test success not observed')
    message = {'id': 'msg_fixture_' + str(turn), 'type': 'message', 'role': 'assistant',
               'model': body.get('model', 'fixture'), 'content': [], 'stop_reason': None,
               'stop_sequence': None, 'usage': {'input_tokens': 10, 'output_tokens': 1}}
    events = [('message_start', {'type': 'message_start', 'message': message})]
    if turn < len(COMMANDS):
        name = next((tool['name'] for tool in body.get('tools', []) if tool.get('name') == 'Bash'), None)
        if name is None:
            raise ValueError('CLI did not expose Bash tool')
        block = {'type': 'tool_use', 'id': 'toolu_fixture_' + str(turn), 'name': name, 'input': {}}
        delta = {'type': 'input_json_delta', 'partial_json': json.dumps({'command': COMMANDS[turn],
                 'description': 'Run bounded synthetic qualification step'})}
        state.setdefault('commands', []).append(COMMANDS[turn])
        reason = 'tool_use'
    else:
        block = {'type': 'text', 'text': ''}
        delta = {'type': 'text_delta', 'text': SUMMARY}
        reason = 'end_turn'
        state['completed'] = True
    events += [('content_block_start', {'type': 'content_block_start', 'index': 0, 'content_block': block}),
               ('content_block_delta', {'type': 'content_block_delta', 'index': 0, 'delta': delta}),
               ('content_block_stop', {'type': 'content_block_stop', 'index': 0}),
               ('message_delta', {'type': 'message_delta', 'delta': {'stop_reason': reason, 'stop_sequence': None},
                                  'usage': {'output_tokens': 10}}),
               ('message_stop', {'type': 'message_stop'})]
    state['claudeTurn'] = turn + 1
    return _sse(events)


def handle(request: dict, state: dict) -> dict:
    """Return a fake API response for one exact run; state is owned by its broker."""
    state['requests'] = state.get('requests', 0) + 1
    if state['requests'] > MAX_REQUESTS:
        return _response(429, json.dumps({'error': 'Fixture request bound exceeded'}))
    raw = request.get('body', '')
    if isinstance(raw, dict):
        raw = json.dumps(raw)
    if not isinstance(raw, str) or len(raw.encode()) > MAX_REQUEST_BYTES:
        return _response(413, json.dumps({'error': 'Fixture body bound exceeded'}))
    path = request.get('path', '').split('?', 1)[0].rstrip('/')
    if request.get('method') != 'POST' or path not in ('/responses', '/v1/responses', '/v1/messages',
                                                                      '/messages', '/v1/messages/count_tokens'):
        return _response(404, json.dumps({'error': 'Fixture route denied'}))
    try:
        body = json.loads(raw)
        if not isinstance(body, dict):
            raise ValueError('Expected JSON object')
        if path.endswith('/count_tokens'):
            return _response(200, json.dumps({'input_tokens': 10}))
        state['lastToolNames'] = [tool.get('name') for tool in body.get('tools', [])][:64]
        stream = _codex(body, state) if path.endswith('/responses') else _claude(body, state)
        return _response(200, stream, True)
    except (ValueError, KeyError, TypeError, AttributeError) as error:
        state['error'] = str(error)[:512]
        return _response(400, json.dumps({'error': {'message': state['error'], 'type': 'invalid_request_error'}}))
