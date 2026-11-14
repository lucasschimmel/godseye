"""Four E08 accounting probes of production coding broker; only HTTPS transport is synthetic."""
import importlib.util
import json
from pathlib import Path
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('e08_legacy_coding_fixture', Path(__file__).with_name('coding-broker.py'))
legacy = importlib.util.module_from_spec(spec)
spec.loader.exec_module(legacy)


class VendorResponse(legacy.Response):
    def __init__(self, content: bytes, header: str) -> None:
        super().__init__([content])
        self.header = header

    def getheader(self, name: str, default: str = '') -> str | None:
        if name.lower() == 'content-type':
            return 'text/event-stream'
        if name.lower() in ('x-request-id', 'request-id'):
            return self.header
        return None


class AccountingProof(legacy.BoundedBroker):
    def setUp(self) -> None:
        super().setUp()
        test = self

        class Connection(legacy.Connection):
            def request(self, method: str, path: str, body: bytes, headers: dict) -> None:
                test.assertEqual(test.attempt_reports[-1][0], 'attempt-intent')
                test.assertEqual(test.attempt_reports[-1][1]['sequence'], test.ledger()['requests'])
                super().request(method, path, body, headers)
        self.accounted_http = patch.object(legacy.broker.http.client, 'HTTPSConnection', side_effect=lambda *args, **kwargs: Connection(self))
        self.accounted_http.start()

    def tearDown(self) -> None:
        self.accounted_http.stop()
        super().tearDown()

    def test_T_AC_801_802_OpenAI_intent_ACK_and_exclusive_usage_before_real_broker_POST(self) -> None:
        body = {'type': 'response.completed', 'response': {'status': 'completed', 'id': 'response-is-not-request-id',
                'usage': {'input_tokens': 30, 'output_tokens': 20, 'input_tokens_details': {'cached_tokens': 7},
                          'output_tokens_details': {'reasoning_tokens': 5}}}}
        self.response = VendorResponse(('data: '+json.dumps(body)+'\n\n').encode(), 'req-openai-fixture')
        self.assertEqual(self.handle()['status'], 200)
        report = self.attempt_reports[-1][1]
        self.assertEqual(report['categories'], {'input': 23, 'output': 15, 'cacheRead': 7, 'cacheWrite': 0, 'reasoning': 5})
        self.assertEqual(report['providerRequestId'], 'req-openai-fixture')
        self.assertEqual(report['reportedTotals'], {'input': 30, 'output': 20})
        self.assertEqual(report['state'], 'succeeded')
        self.assertEqual(len(self.posts), 1)

    def test_T_AC_802_Anthropic_cache_TTL_and_HTTP_request_identity_are_retained(self) -> None:
        self.config.update(runner='claude-code', model='claude-haiku-5-5')
        frames = [{'type': 'message_start', 'message': {'id': 'message-is-not-request-id', 'usage': {
                    'input_tokens': 10, 'output_tokens': 0, 'cache_read_input_tokens': 4, 'cache_creation_input_tokens': 3,
                    'cache_creation': {'ephemeral_5m_input_tokens': 3, 'ephemeral_1h_input_tokens': 0}}}},
                  {'type': 'message_delta', 'usage': {'output_tokens': 7}}, {'type': 'message_stop'}]
        self.response = VendorResponse(''.join('data: '+json.dumps(frame)+'\n\n' for frame in frames).encode(), 'req-anthropic-fixture')
        body = {'model': self.config['model'], 'messages': [{'role': 'user', 'content': 'Synthetic only'}], 'max_tokens': 32}
        self.assertEqual(self.handle(self.request(body, '/v1/messages'))['status'], 200)
        report = self.attempt_reports[-1][1]
        self.assertEqual(report['categories'], {'input': 10, 'output': 7, 'cacheRead': 4, 'cacheWrite': 3, 'reasoning': 0})
        self.assertEqual(report['cacheWriteTtl'], '5m')
        self.assertEqual(report['providerRequestId'], 'req-anthropic-fixture')

    def test_T_AC_801_missing_attempt_ACK_blocks_POST_and_retains_durable_debit(self) -> None:
        def deny(_kind: str, _payload: dict) -> None:
            raise ValueError('Synthetic missing durable acknowledgement')
        self.state['attempts'] = deny
        self.assertEqual(self.handle()['status'], 403)
        self.assertEqual(self.posts, [])
        self.assertGreater(self.ledger()['reservedMicros'], 0)
        self.reopen_state()
        self.assertEqual(self.handle()['status'], 403)
        self.assertEqual(self.posts, [])

    def test_T_AC_802_truncated_known_counts_stay_unknown_and_never_replay_after_reopen(self) -> None:
        frame = {'type': 'response.in_progress', 'response': {'usage': {'input_tokens': 30, 'output_tokens': 20,
                 'input_tokens_details': {'cached_tokens': 7}, 'output_tokens_details': {'reasoning_tokens': 5}}}}
        self.response = VendorResponse(('data: '+json.dumps(frame)+'\n\n').encode(), 'req-truncated-fixture')
        self.assertEqual(self.handle()['status'], 403)
        report = self.attempt_reports[-1][1]
        self.assertEqual(report['state'], 'unknown')
        self.assertEqual(report['categories']['input'], 23)
        self.assertEqual(report['categories']['output'], 15)
        self.reopen_state()
        self.assertEqual(self.handle()['status'], 403)
        self.assertEqual(len(self.posts), 1)


if __name__ == '__main__':
    names = [name for name in AccountingProof.__dict__ if name.startswith('test_T_AC_')]
    result = unittest.TextTestRunner(verbosity=2).run(unittest.TestSuite(AccountingProof(name) for name in names))
    raise SystemExit(0 if result.wasSuccessful() else 1)
