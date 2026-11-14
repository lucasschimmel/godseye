"""Trusted native broker usage normalization. No request text, keys or vendor diagnostics retained."""
import json
import re

CATEGORIES = ('input', 'output', 'cacheRead', 'cacheWrite', 'reasoning')

def number(value: object) -> int | None:
    return value if type(value) is int and 0 <= value <= 9007199254740991 else None

def outcome(sequence: int, request_hash: str, content: bytes, provider: str, streamed: bool = True, succeeded: bool = True, request_id: str | None = None) -> dict:
    records = []
    try:
        if streamed:
            for line in content.decode().splitlines():
                if line.startswith('data:') and line[5:].strip() not in ('', '[DONE]'):
                    item = json.loads(line[5:].strip())
                    if isinstance(item, dict):
                        records.append(item)
        else:
            records.append(json.loads(content))
    except (ValueError, UnicodeError):
        records = []
    usage = None
    for record in records:
        body = record.get('response', record.get('message', record))
        if isinstance(body, dict):
            if isinstance(body.get('usage'), dict):
                usage = {**(usage or {}), **body['usage']}
        if isinstance(record.get('usage'), dict):
            usage = {**(usage or {}), **record['usage']}
    categories = dict.fromkeys(CATEGORIES)
    totals = {"input": None, "output": None}
    ttl = "not-applicable" if provider == "openai" else "unknown"
    if usage:
        if provider == 'openai':
            total_input = number(usage.get('input_tokens', usage.get('prompt_tokens')))
            total_output = number(usage.get('output_tokens', usage.get('completion_tokens')))
            details = usage.get('input_tokens_details', usage.get('prompt_tokens_details', {}))
            output_details = usage.get('output_tokens_details', usage.get('completion_tokens_details', {}))
            cached = number(details.get('cached_tokens')) if isinstance(details, dict) else None
            reasoning = number(output_details.get('reasoning_tokens')) if isinstance(output_details, dict) else None
            # Missing subsets must not be guessed zero, even when a complete total exists.
            totals = {"input": total_input, "output": total_output}
            categories.update(cacheRead=cached, cacheWrite=0, reasoning=reasoning,
                              input=total_input-cached if total_input is not None and cached is not None and cached<=total_input else None,
                              output=total_output-reasoning if total_output is not None and reasoning is not None and reasoning<=total_output else None)
        else:
            totals = {'input': number(usage.get('input_tokens')), 'output': number(usage.get('output_tokens'))}
            # Anthropic reports thinking within output; it has no separately priced reasoning category.
            categories.update(input=number(usage.get('input_tokens')), output=number(usage.get('output_tokens')), reasoning=0,
                              cacheRead=number(usage.get('cache_read_input_tokens')),
                              cacheWrite=number(usage.get('cache_creation_input_tokens')))
            creation = usage.get('cache_creation')
            if isinstance(creation, dict):
                short, long = number(creation.get('ephemeral_5m_input_tokens')), number(creation.get('ephemeral_1h_input_tokens'))
                if short is not None and long is not None:
                    ttl = 'mixed' if short and long else '1h' if long else '5m'
            # Unclassified/mixed cache creation cannot share an invented unit price.
    # Response body IDs name responses/messages, never the vendor's HTTP request.
    identity = request_id if isinstance(request_id, str) and re.fullmatch(r'[A-Za-z0-9._:/-]{1,128}', request_id) else None
    return {'sequence': sequence, 'requestHash': request_hash, 'state': 'succeeded' if succeeded else 'unknown',
            'categories': categories, 'reportedTotals': totals, 'cacheWriteTtl': ttl, 'providerRequestId': identity, 'streamed': streamed, 'providerReportedMicros': None}
