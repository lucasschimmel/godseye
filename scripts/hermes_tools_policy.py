"""Exact first-party model-facing catalog; neither native toolsets nor arbitrary schemas."""
import json
import re

NAMES = ('godseye_workspace_list', 'godseye_workspace_read', 'godseye_workspace_write',
         'godseye_workspace_search', 'godseye_json_validate')


def validate(grant: dict) -> None:
    if set(grant) != {'policy', 'maxModelRequests', 'workspace'}:
        raise ValueError('Invalid task tool selection')
    policy = grant['policy']
    caps = {'maxCalls': 3, 'timeoutSeconds': 30, 'maxReadBytes': 65536,
            'maxWriteBytes': 65536, 'maxWorkspaceBytes': 1048576, 'maxOutputBytes': 32768}
    if (set(policy) != {'version', 'tools', 'resources', *caps}
            or policy['version'] != 1 or not isinstance(policy['tools'], list)
            or not 1 <= len(policy['tools']) <= 5 or len(set(policy['tools'])) != len(policy['tools'])
            or any(name not in NAMES for name in policy['tools'])
            or any(type(policy.get(name)) is not int or not 1 <= policy[name] <= cap for name, cap in caps.items())
            or policy['resources'] != {'memoryMiB': 512, 'swapMiB': 0, 'pids': 128, 'cpuMilliCores': 500}
            or type(grant['maxModelRequests']) is not int or not 2 <= grant['maxModelRequests'] <= 4):
        raise ValueError('Tool bounds refused')
    workspace = grant['workspace']
    if set(workspace) != {'kind', 'files'} or workspace['kind'] != 'scratch' or not isinstance(workspace['files'], list) or len(workspace['files']) > 8:
        raise ValueError('Tool workspace refused')
    seen, total = set(), 0
    for item in workspace['files']:
        if set(item) != {'path', 'content'} or not isinstance(item['content'], str) or len(item['content'].encode()) > 16384:
            raise ValueError('Tool seed refused')
        path = item['path']
        if (not isinstance(path, str) or not re.fullmatch(r'(scratch|artifacts)/[A-Za-z0-9._/-]{1,150}', path)
                or len(path) > 160 or len(path.split('/')) > 8
                or any(part in ('', '.', '..') or part.startswith('.env') or re.search('secret|credential|password|token|api_key', part, re.I) for part in path.split('/'))
                or path in seen):
            raise ValueError('Tool seed path refused')
        seen.add(path)
        total += len(item['content'].encode())
    if total > min(policy['maxWriteBytes'], policy['maxWorkspaceBytes']):
        raise ValueError('Tool seed budget exceeded')


def schemas(grant: dict | None) -> list[dict]:
    if grant is None:
        return []
    validate(grant)
    result = []
    for name in grant['policy']['tools']:
        properties = {'content': {'type': 'string', 'maxLength': 16384}} if name.endswith('_validate') else {'path': {'type': 'string', 'maxLength': 160}}
        if name.endswith('_write'):
            properties['content'] = {'type': 'string', 'maxLength': 16384}
        if name.endswith('_search'):
            properties['text'] = {'type': 'string', 'minLength': 1, 'maxLength': 16384}
        result.append({'type': 'function', 'function': {'name': name,
                       'description': 'Bounded first-party operation on this task private scratch workspace; no shell or external access.',
                       'parameters': {'type': 'object', 'properties': properties, 'required': list(properties), 'additionalProperties': False}}})
    return result


def exact_call(value: dict, grant: dict) -> dict:
    if set(value) != {'id', 'name', 'arguments'} or value['name'] not in grant['policy']['tools'] or not re.fullmatch(r'[A-Za-z0-9._:-]{1,128}', value['id']):
        raise ValueError('Tool call identity refused')
    arguments = value['arguments']
    if isinstance(arguments, str):
        if len(arguments.encode()) > 32768:
            raise ValueError('Tool arguments exceeded')
        arguments = json.loads(arguments)
    schema = next(item['function']['parameters'] for item in schemas(grant) if item['function']['name'] == value['name'])
    if not isinstance(arguments, dict) or set(arguments) != set(schema['required']) or any(not isinstance(item, str) or len(item.encode()) > 16384 for item in arguments.values()):
        raise ValueError('Tool argument schema refused')
    return {**value, 'arguments': arguments}
