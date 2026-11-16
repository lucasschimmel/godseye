"""Bounded standard OpenAI tool-call SSE, enabled only for the exact first-party catalog."""
import json
import time
from hermes_tools_policy import exact_call


def frames(response, stop, deadline: float, model: str, grant: dict, accept_calls):
    pending, total, count, text_bytes = b'', 0, 0, 0
    finished, done, calls = None, False, {}
    while not stop.is_set() and time.time() < deadline:
        chunk = response.read1(4096)
        if not chunk:
            break
        total += len(chunk)
        if total > 2 * 1024 * 1024:
            raise ValueError('Tool model stream exceeded')
        pending = (pending + chunk).replace(b'\r\n', b'\n')
        while b'\n\n' in pending:
            frame, pending = pending.split(b'\n\n', 1)
            count += 1
            if len(frame) > 65536 or count > 4096 or done:
                raise ValueError('Tool stream frame refused')
            lines = frame.decode('utf-8').splitlines()
            if any(line and not line.startswith(('data:', ':')) for line in lines):
                raise ValueError('Tool stream fields refused')
            data = '\n'.join(line[5:].lstrip() for line in lines if line.startswith('data:'))
            if not data:
                continue
            if data == '[DONE]':
                if finished is None:
                    raise ValueError('Tool stream missing terminal completion')
                selected = [exact_call(value, grant) for _, value in sorted(calls.items())]
                if bool(selected) != (finished == 'tool_calls'):
                    raise ValueError('Tool stream completion mismatch')
                accept_calls(selected)
                done = True
            else:
                value = json.loads(data)
                if not isinstance(value, dict) or value.get('object') != 'chat.completion.chunk' or value.get('model') != model:
                    raise ValueError('Tool model response refused')
                choices = value.get('choices')
                if not isinstance(choices, list) or len(choices) > 1:
                    raise ValueError('Tool model choice refused')
                for choice in choices:
                    if not isinstance(choice, dict) or choice.get('index') != 0 or finished is not None:
                        raise ValueError('Tool model choice state refused')
                    delta = choice.get('delta')
                    if not isinstance(delta, dict) or set(delta) - {'role', 'content', 'refusal', 'reasoning', 'reasoning_content', 'tool_calls'}:
                        raise ValueError('Tool model delta refused')
                    for name in ('role', 'content', 'refusal', 'reasoning', 'reasoning_content'):
                        if delta.get(name) is not None and not isinstance(delta[name], str):
                            raise ValueError('Tool model text refused')
                    text_bytes += len((delta.get('content') or '').encode())
                    if text_bytes > 32768 or len((delta.get('content') or '').encode()) > 4096:
                        raise ValueError('Tool model text exceeded')
                    fragments = delta.get('tool_calls') or []
                    if not isinstance(fragments, list) or len(fragments) > grant['policy']['maxCalls']:
                        raise ValueError('Tool model call collection refused')
                    for fragment in fragments:
                        if (not isinstance(fragment, dict) or set(fragment) - {'index', 'id', 'type', 'function'}
                                or type(fragment.get('index')) is not int or not 0 <= fragment['index'] < grant['policy']['maxCalls']
                                or fragment.get('type', 'function') != 'function'):
                            raise ValueError('Tool call fragment refused')
                        call = calls.setdefault(fragment['index'], {'id': '', 'name': '', 'arguments': ''})
                        function = fragment.get('function') or {}
                        if not isinstance(function, dict) or set(function) - {'name', 'arguments'}:
                            raise ValueError('Tool function fragment refused')
                        for destination, part in (('id', fragment.get('id', '')), ('name', function.get('name', '')), ('arguments', function.get('arguments', ''))):
                            if not isinstance(part, str):
                                raise ValueError('Tool function fragment type refused')
                            call[destination] += part
                        if len(call['id']) > 128 or len(call['name']) > 64 or len(call['arguments'].encode()) > 32768:
                            raise ValueError('Tool function fragment bound exceeded')
                    reason = choice.get('finish_reason')
                    if reason is not None:
                        if reason not in ('stop', 'length', 'tool_calls'):
                            raise ValueError('Tool model completion refused')
                        finished = reason
            if not done:
                yield ('data: ' + data + '\n\n').encode()
        if len(pending) > 65536:
            raise ValueError('Tool model partial frame exceeded')
    if stop.is_set() or time.time() >= deadline or pending.strip() or not done:
        raise ValueError('Tool model stream incomplete')
    yield b'data: [DONE]\n\n'
