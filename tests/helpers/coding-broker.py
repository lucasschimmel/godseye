"""Independent broker tests: actual durable ledger and a fake HTTPS transport only."""
import base64
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'scripts'))
import coding_guest_broker as broker

NOW = datetime(2026, 11, 14, 12, tzinfo=timezone.utc).timestamp()


class Response:
    status = 200
    def __init__(self, chunks=None):
        self.chunks = list(chunks or [b'data: {"type":"response.completed","response":{"status":"completed"}}\n\n'])
    def getheader(self, name, default=''):
        return 'text/event-stream' if name.lower() == 'content-type' else None
    def read1(self, maximum):
        return self.chunks.pop(0) if self.chunks else b''


class Connection:
    sock = None
    def __init__(self, test):
        self.test = test
    def request(self, method, path, body, headers):
        # The external POST boundary observes a completely published ledger.
        ledger = json.loads(Path(self.test.state['journalPath']).read_text())
        self.test.assertGreater(ledger['reservedMicros'], 0)
        self.test.assertEqual(ledger['requests'], len(self.test.posts) + 1)
        self.test.posts.append((method, path, json.loads(body), headers))
        if self.test.transport_error:
            raise OSError('Synthetic transport ACK lost')
    def getresponse(self):
        return self.test.response
    def close(self):
        self.test.closed += 1


class BoundedBroker(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix='godseye-coding-broker-')
        self.root = Path(self.temporary.name)
        self.authorizations = 0
        self.attempt_reports = []
        self.posts = []
        self.closed = 0
        self.transport_error = False
        self.response = Response()
        self.config = {'runner': 'codex', 'model': 'gpt-5.4-mini', 'apiKey': 'synthetic-only-no-upstream-value',
                       'maxRequests': 2, 'maxRequestBytes': 10000, 'maxResponseBytes': 1000,
                       'maxOutputTokens': 32, 'requestTimeoutSeconds': 5}
        self.limits = {'maxCostMicros': 1000000}
        self.state = {'deadline': '2026-11-14T12:01:00Z', 'journalPath': str(self.root / 'usage.json'),
                      'correlationId': 'synthetic-task-correlation', 'authorize': self.authorize,
                      'attempts': self.attempt}
        self.time = patch.object(broker.time, 'time', return_value=NOW)
        self.http = patch.object(broker.http.client, 'HTTPSConnection', side_effect=lambda *args, **kwargs: Connection(self))
        self.ssl = patch.object(broker.ssl, 'create_default_context', return_value=object())
        self.time.start()
        self.http.start()
        self.ssl.start()
    def tearDown(self):
        self.ssl.stop()
        self.http.stop()
        self.time.stop()
        self.temporary.cleanup()
    def authorize(self):
        self.authorizations += 1
    def attempt(self, kind, payload):
        self.attempt_reports.append((kind, payload))
    def request(self, body=None, path='/v1/responses'):
        return {'method': 'POST', 'path': path, 'body': json.dumps(body or {'model': self.config['model'], 'input': 'synthetic input', 'max_output_tokens': 100000})}
    def handle(self, request=None):
        return broker.handle(request or self.request(), self.state, self.config, self.limits)
    def ledger(self):
        return json.loads(Path(self.state['journalPath']).read_text())
    def reopen_state(self):
        # Reconstruct a new broker process's capability, retaining only the same
        # durable journal identity. No in-memory failedClosed/counter is reused.
        self.state = {'deadline': '2026-11-14T12:01:00Z', 'journalPath': str(self.root / 'usage.json'),
                      'correlationId': 'synthetic-task-correlation', 'authorize': self.authorize,
                      'attempts': self.attempt}
    def completion_fault(self, exception):
        """Fault the directory sync after actual completion replacement, independent of extra guard writes."""
        original_replace = broker.os.replace
        original_fsync = broker.os.fsync
        armed = False
        fired = False
        def observe_replace(source, destination):
            nonlocal armed
            completion = (Path(destination) == Path(self.state['journalPath']) and
                          json.loads(Path(source).read_text()).get('pendingFingerprint') is None)
            original_replace(source, destination)
            if completion:
                armed = True
        def fault_sync(descriptor):
            nonlocal fired
            if armed and not fired:
                fired = True
                raise exception
            original_fsync(descriptor)
        return (patch.object(broker.os, 'replace', side_effect=observe_replace),
                patch.object(broker.os, 'fsync', side_effect=fault_sync))

    def test_T_AC_791_durable_debit_and_controller_authorization_precede_only_POST(self):
        result = self.handle()
        self.assertEqual(result['status'], 200)
        self.assertEqual(len(self.posts), 1)
        self.assertEqual(self.authorizations, 2)
        self.assertEqual(self.ledger()['requests'], 1)
        self.assertEqual(self.posts[0][0:2], ('POST', '/v1/responses'))
        self.assertEqual(self.posts[0][2]['max_output_tokens'], 32)
        self.assertFalse(self.posts[0][2]['store'])
        self.assertEqual(self.posts[0][2]['service_tier'], 'default')

    def test_T_AC_788_lost_ACK_retains_debit_without_retry_or_refund(self):
        self.config['maxRequests'] = 1
        self.transport_error = True
        self.assertEqual(self.handle()['status'], 403)
        debit = self.ledger()['reservedMicros']
        self.assertGreater(debit, 0)
        self.assertEqual(len(self.posts), 1)
        self.assertEqual(self.handle()['status'], 403)
        self.assertEqual(len(self.posts), 1)
        self.assertEqual(self.ledger()['reservedMicros'], debit)

    def test_T_AC_788_identical_payload_after_lost_ACK_and_reopen_never_posts_again(self):
        self.config['maxRequests'] = 4
        self.transport_error = True
        self.assertEqual(self.handle()['status'], 403)
        first = self.ledger()
        self.assertEqual(len(self.posts), 1)
        self.reopen_state()
        self.transport_error = False
        self.response = Response()
        self.assertEqual(self.handle()['status'], 403)
        self.assertEqual(len(self.posts), 1)
        self.assertEqual(self.ledger()['reservedMicros'], first['reservedMicros'])
        self.assertEqual(self.ledger()['requests'], first['requests'])

    def test_T_AC_788_known_duplicate_payload_is_denied_before_upstream_IO_or_extra_debit(self):
        self.config['maxRequests'] = 4
        self.assertEqual(self.handle()['status'], 200)
        first = self.ledger()
        self.reopen_state()
        self.response = Response()
        self.assertEqual(self.handle()['status'], 403)
        self.assertEqual(len(self.posts), 1)
        self.assertEqual(self.ledger()['reservedMicros'], first['reservedMicros'])
        self.assertEqual(self.ledger()['requests'], 1)

    def test_T_AC_788_reordered_equivalent_payload_cannot_bypass_durable_deduplication(self):
        self.config['maxRequests'] = 4
        self.assertEqual(self.handle()['status'], 200)
        first = self.ledger()
        self.reopen_state()
        # Output policy is normalized by the broker. Reordering fields and changing
        # the guest's ignored output maximum must remain the same paid effect.
        reordered = self.request({'max_output_tokens': 1, 'input': 'synthetic input', 'model': self.config['model']})
        self.assertEqual(self.handle(reordered)['status'], 403)
        self.assertEqual(len(self.posts), 1)
        self.assertEqual(self.ledger()['reservedMicros'], first['reservedMicros'])

    def test_T_AC_788_uncertain_request_blocks_even_a_distinct_payload_after_reopen(self):
        self.config['maxRequests'] = 4
        self.transport_error = True
        self.assertEqual(self.handle()['status'], 403)
        first = self.ledger()
        self.reopen_state()
        self.transport_error = False
        self.response = Response()
        distinct = self.request({'model': self.config['model'], 'input': 'Different new payload after unknown effect'})
        self.assertEqual(self.handle(distinct)['status'], 403)
        self.assertEqual(len(self.posts), 1)
        self.assertEqual(self.ledger()['reservedMicros'], first['reservedMicros'])

    def test_T_AC_788_truncated_vendor_stream_retains_pending_and_blocks_further_effects(self):
        self.config['maxRequests'] = 4
        self.response = Response([b'data: {"type":"response.output_text.delta","delta":"unfinished"}\n\n'])
        self.assertEqual(self.handle()['status'], 403)
        first = self.ledger()
        self.reopen_state()
        self.response = Response()
        distinct = self.request({'model': self.config['model'], 'input': 'Different new payload after truncated stream'})
        self.assertEqual(self.handle(distinct)['status'], 403)
        self.assertEqual(len(self.posts), 1)
        self.assertEqual(self.ledger()['reservedMicros'], first['reservedMicros'])

    def test_T_AC_788_failed_completion_durability_keeps_followup_requests_fenced_after_reopen(self):
        self.config['maxRequests'] = 4
        replace_fault, sync_fault = self.completion_fault(OSError('Synthetic completion directory persistence failure'))
        with replace_fault, sync_fault:
            self.assertEqual(self.handle()['status'], 403)
        self.assertEqual(len(self.posts), 1)
        first = self.ledger()['reservedMicros']
        self.reopen_state()
        self.response = Response()
        distinct = self.request({'model': self.config['model'], 'input': 'New turn after unconfirmed journal completion'})
        self.assertEqual(self.handle(distinct)['status'], 403)
        self.assertEqual(len(self.posts), 1)
        self.assertEqual(self.ledger()['reservedMicros'], first)

    def test_T_AC_788_process_death_during_completion_publication_keeps_reopened_effect_fenced(self):
        self.config['maxRequests'] = 4
        # BaseException models process death, so an OSError-only recovery handler
        # cannot execute. Extra prepublished guards must survive independently.
        replace_fault, sync_fault = self.completion_fault(SystemExit('Synthetic process died before durable completion'))
        with replace_fault, sync_fault:
            with self.assertRaises(SystemExit):
                self.handle()
        self.assertEqual(len(self.posts), 1)
        first = self.ledger()['reservedMicros']
        self.reopen_state()
        self.response = Response()
        distinct = self.request({'model': self.config['model'], 'input': 'New turn after broker process died'})
        self.assertEqual(self.handle(distinct)['status'], 403)
        self.assertEqual(len(self.posts), 1)
        self.assertEqual(self.ledger()['reservedMicros'], first)

    def test_T_AC_788_distinct_next_tool_turn_can_follow_a_fully_observed_previous_response(self):
        self.config['maxRequests'] = 4
        self.assertEqual(self.handle()['status'], 200)
        first = self.ledger()['reservedMicros']
        self.reopen_state()
        self.response = Response()
        next_turn = self.request({'model': self.config['model'], 'input': 'Observed previous tool output; distinct next turn'})
        self.assertEqual(self.handle(next_turn)['status'], 200)
        self.assertEqual(len(self.posts), 2)
        self.assertEqual(self.ledger()['requests'], 2)
        self.assertGreater(self.ledger()['reservedMicros'], first)

    def test_T_AC_791_budget_and_request_limits_fail_before_any_extra_POST(self):
        self.limits['maxCostMicros'] = 1000
        self.assertEqual(self.handle()['status'], 403)
        self.assertEqual(self.posts, [])
        self.limits['maxCostMicros'] = 1000000
        self.config['maxRequests'] = 1
        self.assertEqual(self.handle()['status'], 200)
        self.assertEqual(self.handle()['status'], 403)
        self.assertEqual(len(self.posts), 1)

    def test_T_AC_789_missing_or_failed_controller_ack_never_POSTs(self):
        for callback in (None, lambda: (_ for _ in ()).throw(ValueError('Synthetic no acknowledgement'))):
            self.state['authorize'] = callback
            self.assertEqual(self.handle()['status'], 403)
        self.assertEqual(self.posts, [])
        self.assertFalse(Path(self.state['journalPath']).exists())

    def test_T_AC_789_revocation_at_second_authorization_retains_debit_but_never_POSTs(self):
        def revoke():
            self.authorizations += 1
            if self.authorizations == 2:
                self.state['revoked'] = True
        self.state['authorize'] = revoke
        self.assertEqual(self.handle()['status'], 403)
        self.assertEqual(self.posts, [])
        self.assertEqual(self.authorizations, 2)
        self.assertEqual(self.ledger()['requests'], 1)
        self.assertGreater(self.ledger()['reservedMicros'], 0)

    def test_T_AC_789_expired_or_revoked_task_does_not_debit_or_POST(self):
        for change in ({'deadline': '2026-11-14T11:59:59Z'}, {'revoked': True}):
            self.state.update(change)
            self.assertEqual(self.handle()['status'], 403)
        self.assertEqual(self.posts, [])
        self.assertFalse(Path(self.state['journalPath']).exists())

    def test_T_AC_791_request_and_response_bytes_are_bounded_without_refund(self):
        self.config['maxRequestBytes'] = 10
        self.assertEqual(self.handle()['status'], 403)
        self.assertEqual(self.posts, [])
        self.config['maxRequestBytes'] = 10000
        self.response = Response([b'x' * 1001])
        self.assertEqual(self.handle()['status'], 403)
        self.assertEqual(len(self.posts), 1)
        self.assertGreater(self.ledger()['reservedMicros'], 0)

    def test_T_AC_791_unreviewed_models_tiers_remote_URLs_and_tools_are_denied(self):
        denied = [
            {'model': 'premium-unbound'},
            {'model': self.config['model'], 'service_tier': 'priority'},
            {'model': self.config['model'], 'tools': [{'type': 'web_search'}]},
            {'model': self.config['model'], 'input': [{'type': 'input_image', 'image_url': 'https://fixture.invalid/image'}]},
            {'model': self.config['model'], 'input': [{'type': 'mcp', 'server_url': 'https://fixture.invalid'}]},
        ]
        for body in denied:
            with self.subTest(body=body):
                self.assertEqual(self.handle(self.request(body))['status'], 403)
        self.assertEqual(self.handle(self.request(path='https://fixture.invalid/v1/responses'))['status'], 403)
        self.assertEqual(self.posts, [])

    def test_T_AC_791_durable_ledger_survives_new_in_memory_state(self):
        self.config['maxRequests'] = 1
        self.assertEqual(self.handle()['status'], 200)
        self.state = {key: value for key, value in self.state.items() if key not in ('requests', 'reservedMicros')}
        self.assertEqual(self.handle()['status'], 403)
        self.assertEqual(len(self.posts), 1)

    def test_T_AC_791_malformed_or_foreign_ledger_never_resets_counters(self):
        Path(self.state['journalPath']).write_text(json.dumps({'correlationId': 'other', 'requests': 0, 'reservedMicros': 0}))
        self.assertEqual(self.handle()['status'], 403)
        self.assertEqual(self.posts, [])
        self.assertEqual(self.ledger()['correlationId'], 'other')

    def test_T_AC_786_claude_normalizes_fixed_output_and_disables_extra_thinking(self):
        self.config.update(runner='claude-code', model='claude-haiku-5-5')
        self.response = Response([b'event: message_stop\ndata: {"type":"message_stop"}\n\n'])
        body = {'model': self.config['model'], 'messages': [{'role': 'user', 'content': 'Synthetic'}], 'max_tokens': 100000}
        self.assertEqual(self.handle(self.request(body, '/v1/messages'))['status'], 200)
        self.assertEqual(self.posts[0][2]['max_tokens'], 32)
        self.assertEqual(self.posts[0][2]['thinking'], {'type': 'disabled'})
        self.assertEqual(self.posts[0][2]['service_tier'], 'standard_only')

    def test_T_AC_786_documented_Claude_context_hint_is_stripped_without_discounting_input(self):
        self.config.update(runner='claude-code', model='claude-haiku-5-5')
        self.response = Response([b'event: message_stop\ndata: {"type":"message_stop"}\n\n'])
        body = {'model': self.config['model'], 'messages': [{'role': 'user', 'content': 'Synthetic'}],
                'context_management': {'edits': [{'type': 'clear_thinking_20251015', 'keep': 'all'}]}}
        requested = self.request(body, '/v1/messages')
        _, retained_cost = broker._payload(requested, self.config)
        body.pop('context_management')
        _, ordinary_cost = broker._payload(self.request(body, '/v1/messages'), self.config)
        self.assertGreater(retained_cost, ordinary_cost)
        self.assertEqual(self.handle(requested)['status'], 200)
        self.assertEqual(len(self.posts), 1)
        self.assertNotIn('context_management', self.posts[0][2])
        self.assertEqual(self.ledger()['reservedMicros'], retained_cost)
        self.assertEqual(self.handle(self.request(body, '/v1/messages'))['status'], 403)
        self.assertEqual(len(self.posts), 1)
        self.assertEqual(self.ledger()['reservedMicros'], retained_cost)

    def test_T_AC_786_unreviewed_context_edits_or_extended_shapes_never_POST_or_debit(self):
        self.config.update(runner='claude-code', model='claude-haiku-5-5')
        invalid = [{}, {'edits': []}, {'edits': None},
                   {'edits': [{'type': 'clear_thinking_20251015', 'keep': 1}]},
                   {'edits': [{'type': 'clear_tool_uses_20250919', 'keep': 'all'}]},
                   {'edits': [{'type': 'clear_thinking_20251015', 'keep': 'all', 'extra': True}]},
                   {'edits': [{'type': 'clear_thinking_20251015', 'keep': 'all'}], 'extra': True},
                   {'edits': [{'type': 'clear_thinking_20251015', 'keep': 'all'}] * 2}]
        for context in invalid:
            with self.subTest(context=context):
                body = {'model': self.config['model'], 'messages': [], 'context_management': context}
                self.assertEqual(self.handle(self.request(body, '/v1/messages'))['status'], 403)
        self.config.update(runner='codex', model='gpt-5.4-mini')
        codex = {'model': self.config['model'], 'input': 'Synthetic',
                 'context_management': {'edits': [{'type': 'clear_thinking_20251015', 'keep': 'all'}]}}
        self.assertEqual(self.handle(self.request(codex))['status'], 403)
        self.assertEqual(self.posts, [])
        self.assertFalse(Path(self.state['journalPath']).exists())

    def test_T_AC_786_benign_context_hint_never_authorizes_other_fields_or_remote_tools(self):
        self.config.update(runner='claude-code', model='claude-haiku-5-5')
        for expansion in ({'endpoint': 'https://fixture.invalid/private'}, {'tools': [{'type': 'web_search'}]}):
            body = {'model': self.config['model'], 'messages': [],
                    'context_management': {'edits': [{'type': 'clear_thinking_20251015', 'keep': 'all'}]}, **expansion}
            self.assertEqual(self.handle(self.request(body, '/v1/messages'))['status'], 403)
        self.assertEqual(self.posts, [])
        self.assertFalse(Path(self.state['journalPath']).exists())

    def test_T_AC_786_exact_real_CLI_synthetic_payload_replays_once_without_broadening_policy(self):
        supplied = os.environ.get('GODSEYE_TEST_CODING_SYNTHETIC_PAYLOAD')
        if not supplied:
            self.skipTest('Exact native-captured synthetic fixture was not selected')
        path = Path(supplied)
        allowed = Path(__file__).resolve().parents[2] / 'artifacts/coding-composition-fixtures'
        self.assertTrue(path.resolve().is_relative_to(allowed.resolve()))
        self.assertTrue(path.parent.name.startswith('synthetic-'))
        self.assertRegex(path.name, r'^request-[1-9][0-9]*\.json$')
        self.assertFalse(path.is_symlink())
        self.assertEqual(path.stat().st_nlink, 1)
        self.assertLessEqual(path.stat().st_size, 262144)
        requested = json.loads(path.read_text())
        self.config.update(runner='claude-code', model='claude-haiku-5-5')
        self.response = Response([b'event: message_stop\ndata: {"type":"message_stop"}\n\n'])
        self.assertEqual(self.handle(requested)['status'], 200)
        self.assertEqual(len(self.posts), 1)
        self.assertNotIn('context_management', self.posts[0][2])
        self.assertGreater(self.ledger()['reservedMicros'], 0)

    def test_T_AC_785_exact_real_Codex_synthetic_payload_replays_once_with_bounded_normalization(self):
        supplied = os.environ.get('GODSEYE_TEST_CODING_SYNTHETIC_CODEX_PAYLOAD')
        if not supplied:
            self.skipTest('Exact native-captured synthetic Codex fixture was not selected')
        path = Path(supplied)
        allowed = Path(__file__).resolve().parents[2] / 'artifacts/coding-composition-fixtures'
        self.assertTrue(path.resolve().is_relative_to(allowed.resolve()))
        self.assertTrue(path.parent.name.startswith('synthetic-'))
        self.assertRegex(path.name, r'^request-[1-9][0-9]*\.json$')
        self.assertFalse(path.is_symlink())
        self.assertEqual(path.stat().st_nlink, 1)
        self.assertLessEqual(path.stat().st_size, 262144)
        requested = json.loads(path.read_text())
        self.config['maxRequestBytes'] = 262144
        self.assertEqual(self.handle(requested)['status'], 200)
        self.assertEqual(len(self.posts), 1)
        wire = self.posts[0][2]
        self.assertNotIn('client_metadata', wire)
        self.assertFalse(wire.get('include'))
        self.assertEqual(wire['service_tier'], 'default')
        self.assertIs(wire['store'], False)
        self.assertEqual(wire['max_output_tokens'], self.config['maxOutputTokens'])
        self.assertGreater(self.ledger()['reservedMicros'], 0)
    def test_T_AC_785_local_namespace_schema_properties_are_descriptors_not_remote_invocations(self):
        leaf = {'type': 'function', 'name': 'read_local', 'strict': False,
                'parameters': {'type': 'object', 'properties': {
                    'type': {'type': 'string'}, 'image_url': {'type': 'string'},
                    'encrypted_content': {'type': 'string'}}, 'additionalProperties': False}}
        tools = [{'type': 'namespace', 'name': 'local_tools', 'description': 'Synthetic local tools',
                  'tools': [leaf, {'type': 'custom', 'name': 'local_text', 'format': {'type': 'text'}}]}]
        self.assertEqual(self.handle(self.request({'model': self.config['model'], 'input': 'Synthetic',
                                                   'tools': tools}))['status'], 200)
        self.assertEqual(len(self.posts), 1)
        self.assertEqual(self.posts[0][2]['tools'], tools)
        self.assertEqual(self.posts[0][2]['reasoning'], {'effort': 'none'})

    def test_T_AC_785_remote_nested_extra_and_oversized_namespace_definitions_never_POST_or_debit(self):
        local = {'type': 'function', 'name': 'local', 'parameters': {'type': 'object'}}
        namespace = {'type': 'namespace', 'name': 'local_tools', 'description': 'Synthetic', 'tools': [local]}
        bad_tools = [
            [{**namespace, 'tools': [{'type': 'web_search', 'name': 'remote'}]}],
            [{**namespace, 'tools': [{'type': 'mcp', 'name': 'remote', 'server_url': 'https://fixture.invalid'}]}],
            [{**namespace, 'tools': [namespace]}],
            [{**namespace, 'server_url': 'https://fixture.invalid'}],
            [{**namespace, 'tools': [{**local, 'endpoint': 'https://fixture.invalid'}]}],
            [local] * 65,
            [{**namespace, 'tools': [local] * 33}],
            [{**local, 'parameters': {'$ref': 'https://fixture.invalid/schema'}}],
            [{**local, 'parameters': {'properties': {'nested': {'$ref': 'https://fixture.invalid/schema'}}}}],
        ]
        self.config['maxRequestBytes'] = 262144
        for tools in bad_tools:
            with self.subTest(tools=tools):
                self.assertEqual(self.handle(self.request({'model': self.config['model'], 'input': 'Synthetic',
                                                          'tools': tools}))['status'], 403)
        self.assertEqual(self.posts, [])
        self.assertFalse(Path(self.state['journalPath']).exists())

    def test_T_AC_785_malformed_or_external_client_metadata_never_POST_or_debit(self):
        identifier = '12345678-1234-1234-1234-123456789abc'
        invalid = [{'endpoint': 'https://fixture.invalid'}, {'thread_id': 'not-an-id'},
                   {'thread_id': 42}, {'thread_id': identifier, 'unknown': True},
                   {'x-codex-turn-metadata': '{'},
                   {'x-codex-turn-metadata': json.dumps({'endpoint': 'https://fixture.invalid'})},
                   {'x-codex-turn-metadata': json.dumps({'agent_name': 'https://fixture.invalid'})},
                   {'x-codex-turn-metadata': json.dumps({'workspaces': {'/outside': {}}})},
                   {'x-codex-turn-metadata': 'x' * 8193},
                   {'x-codex-turn-metadata': json.dumps({'reasoning_effort': 'high'})},
                   {'x-codex-turn-metadata': json.dumps({'reasoning_effort': None})},
                   {'x-codex-turn-metadata': json.dumps({'reasoning_effort': True})}]
        self.config['maxRequestBytes'] = 262144
        for metadata in invalid:
            with self.subTest(metadata=metadata):
                self.assertEqual(self.handle(self.request({'model': self.config['model'], 'input': 'Synthetic',
                    'client_metadata': metadata}))['status'], 403)
        self.assertEqual(self.posts, [])
        self.assertFalse(Path(self.state['journalPath']).exists())

    def test_T_AC_785_opaque_input_and_unreviewed_response_hints_remain_denied(self):
        denied = [{'input': [{'type': 'reasoning', 'encrypted_content': 'synthetic-opaque'}]},
                  {'input': [{'type': 'message', 'content': [{'type': 'input_file', 'file_id': 'synthetic-file'}]}]},
                  {'input': [{'type': 'input_image', 'image_url': 'https://fixture.invalid/image'}]},
                  {'include': ['reasoning.encrypted_content', 'unknown']},
                  {'include': ['unknown']}, {'include': 'reasoning.encrypted_content'},
                  {'reasoning': {'effort': 'high', 'endpoint': 'https://fixture.invalid'}},
                  {'unknown': True}]
        for expansion in denied:
            with self.subTest(expansion=expansion):
                self.assertEqual(self.handle(self.request({'model': self.config['model'], 'input': 'Synthetic',
                                                          **expansion}))['status'], 403)
        self.assertEqual(self.posts, [])
        self.assertFalse(Path(self.state['journalPath']).exists())

    def test_T_AC_785_dropped_Codex_hints_preserve_raw_byte_charge_and_normalized_dedup(self):
        base = {'model': self.config['model'], 'input': 'Synthetic'}
        hinted = {**base, 'client_metadata': {'thread_id': '12345678-1234-1234-1234-123456789abc'},
                  'include': ['reasoning.encrypted_content'], 'reasoning': {'summary': 'auto', 'effort': 'high'}}
        ordinary_wire, ordinary_cost = broker._payload(self.request(base), self.config)
        hinted_wire, hinted_cost = broker._payload(self.request(hinted), self.config)
        self.assertEqual(json.loads(hinted_wire), json.loads(ordinary_wire))
        self.assertGreater(hinted_cost, ordinary_cost)
        self.assertEqual(self.handle(self.request(hinted))['status'], 200)
        self.assertEqual(self.ledger()['reservedMicros'], hinted_cost)
        self.assertEqual(self.handle(self.request(base))['status'], 403)
        self.assertEqual(len(self.posts), 1)
        self.assertEqual(self.ledger()['reservedMicros'], hinted_cost)
    def test_T_AC_785_fixed_reasoning_none_metadata_is_diagnostic_and_dropped(self):
        body = {'model': self.config['model'], 'input': 'Synthetic',
                'client_metadata': {'x-codex-turn-metadata': json.dumps({'reasoning_effort': 'none'})}}
        self.assertEqual(self.handle(self.request(body))['status'], 200)
        self.assertEqual(len(self.posts), 1)
        self.assertNotIn('client_metadata', self.posts[0][2])
        self.assertEqual(self.posts[0][2]['reasoning'], {'effort': 'none'})
    def test_T_AC_791_policy_errors_do_not_expose_synthetic_authentication(self):
        self.transport_error = True
        response = self.handle()
        text = base64.b64decode(response['bodyBase64']).decode()
        self.assertNotIn(self.config['apiKey'], text)
        self.assertNotIn(str(self.root), text)
        self.assertNotIn('ACK lost', text)
        self.assertTrue(self.state['failedClosed'])


if __name__ == '__main__':
    unittest.main(verbosity=2)
