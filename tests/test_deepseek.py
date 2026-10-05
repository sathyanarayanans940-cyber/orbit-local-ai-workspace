"""DeepSeek gateway tests use synthetic credentials and mocked DeepSeek responses."""
import http.client
import io
import json
from pathlib import Path
import stat
import tempfile
import threading
import unittest
from concurrent.futures import ThreadPoolExecutor
from unittest.mock import Mock, patch
import deepseek
import server

FAKE_KEY = 'synthetic-test-key-not-a-real-credential'


class CompletionTests(unittest.TestCase):
    def test_fragmented_unicode_comments_and_done_release_only_a_completed_event(self):
        parser = deepseek.StreamCompletion()
        live = b': keep-alive\r\n\r\ndata: {"choices":[{"delta":{"content":"' + '🙂'.encode() + b'"},"finish_reason":null}]}\n\n'
        for byte in live: self.assertFalse(parser.feed(bytes([byte])))
        final = b'data: {"choices":[{"delta":{"content":"final"},"finish_reason":"stop"}]}\r\n\r\n'
        for byte in final[:-2]: self.assertFalse(parser.feed(bytes([byte])))
        # A CR itself terminates the blank SSE line; the following LF belongs
        # to that separator rather than introducing another blank line.
        self.assertTrue(parser.feed(final[-2:-1]))
        parser = deepseek.StreamCompletion()
        self.assertFalse(parser.feed(b'data: [DO'))
        self.assertTrue(parser.feed(b'NE]\n\n'))

    def test_multiline_events_invalid_shapes_and_limits_do_not_create_false_completion(self):
        parser = deepseek.StreamCompletion()
        for event in [b'data: []\n\n', b'data: {"choices":null}\n\n', b'data: {"choices":[null]}\n\n', b'data: {"content":"finish_reason stop"}\n\n', b'data: malformed\n\n']:
            self.assertFalse(parser.feed(event))
        self.assertTrue(parser.feed(b'data: {"choices": [\ndata: {"finish_reason":"length"}]}\n\n'))
        parser = deepseek.StreamCompletion()
        for _ in range(40): self.assertFalse(parser.feed(b'x' * 65536))
        self.assertLessEqual(len(parser.buffer), 2 * 1024 * 1024)
        self.assertTrue(parser.feed(b'\ndata: [DONE]\n\n'))


class GatewayTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.gateway = deepseek.DeepSeekGateway(self.temp.name)

    def test_key_storage_permissions_replace_remove_and_invalid_inputs(self):
        g = self.gateway
        self.assertEqual(g.key(), '')
        for key in [None, [], 'short', 'x' * 513, 'a' * 20 + '\n']:
            with self.assertRaises(deepseek.DeepSeekError):
                g.save(key)
        g.save(FAKE_KEY)
        self.assertEqual(g.key(), FAKE_KEY)
        self.assertEqual(stat.S_IMODE(g.path.stat().st_mode), 0o600)
        self.assertEqual(deepseek.DeepSeekGateway(self.temp.name).key(), FAKE_KEY)
        g.save(FAKE_KEY + '-replacement')
        self.assertEqual(g.key(), FAKE_KEY + '-replacement')
        g.save('')
        self.assertEqual(g.key(), '')
        self.assertEqual(len(list(Path(self.temp.name).iterdir())), 1)

    def test_unconfigured_skips_network_and_catalog_filters_caches_without_key(self):
        g = self.gateway
        with patch.object(g, 'connect') as connect:
            self.assertEqual(g.models(), [])
            connect.assert_not_called()
        g.save(FAKE_KEY)
        connection, response = Mock(), Mock()
        response.read.return_value = json.dumps({'data': [{'id': i} for i in ['deepseek-flash', 'deepseek-flash', 'deepseek-chat', 'deepseek-v4-pro']]}).encode()
        with patch.object(g, 'connect', return_value=(connection, response)) as connect:
            result = g.models()
            self.assertEqual([m['id'] for m in result], ['deepseek-flash', 'deepseek-v4-pro'])
            self.assertEqual(g.models(), result)
            connect.assert_called_once()
            self.assertNotIn(FAKE_KEY, json.dumps(result))
        connection.close.assert_called_once()

    def test_catalog_failures_back_off_and_replacing_key_allows_retry(self):
        g = self.gateway
        g.save(FAKE_KEY)
        with patch.object(g, 'connect', side_effect=deepseek.DeepSeekError(403, 'Denied')) as connect:
            with self.assertRaises(deepseek.DeepSeekError): g.models()
            with self.assertRaises(deepseek.DeepSeekError): g.models()
            self.assertEqual(connect.call_count, 1)
            g.save(FAKE_KEY)
            with self.assertRaises(deepseek.DeepSeekError): g.models()
            self.assertEqual(connect.call_count, 2)

    def test_slow_catalog_does_not_block_credentials_or_publish_a_replaced_key(self):
        g = self.gateway; g.save(FAKE_KEY)
        entered, release = threading.Event(), threading.Event()
        connection, response = Mock(), Mock()
        response.read.return_value = b'{"data":[{"id":"deepseek-flash"}]}'
        def slow_catalog(*args, **kwargs):
            entered.set()
            if not release.wait(3): raise TimeoutError('Catalog test deadline')
            return connection, response
        with patch.object(g, 'connect', side_effect=slow_catalog), ThreadPoolExecutor(3) as workers:
            pending = workers.submit(g.models)
            try:
                self.assertTrue(entered.wait(1))
                self.assertEqual(workers.submit(g.key).result(timeout=1), FAKE_KEY)
                workers.submit(g.save, FAKE_KEY + '-replacement').result(timeout=1)
            finally:
                release.set()
            self.assertEqual(pending.result(timeout=1), [])
        self.assertEqual(g.key(), FAKE_KEY + '-replacement')
        self.assertIsNone(g.cache)
        self.assertEqual(g.retry_after, 0)
        connection.close.assert_called_once()

    def test_old_catalog_failure_cannot_back_off_a_new_key(self):
        g = self.gateway; g.save(FAKE_KEY)
        entered, release = threading.Event(), threading.Event()
        def fail_late(*args, **kwargs):
            entered.set(); release.wait(3)
            raise deepseek.DeepSeekError(401, 'Old key rejected')
        with patch.object(g, 'connect', side_effect=fail_late), ThreadPoolExecutor(2) as workers:
            pending = workers.submit(g.models)
            try:
                self.assertTrue(entered.wait(1))
                workers.submit(g.save, FAKE_KEY + '-replacement').result(timeout=1)
            finally: release.set()
            with self.assertRaises(deepseek.DeepSeekError): pending.result(timeout=1)
        self.assertEqual(g.retry_after, 0)

    def test_connection_timings_are_metadata_only_and_thinking_off_remains_off(self):
        connection = Mock(); response = connection.getresponse.return_value
        response.status = 200
        with patch('deepseek.http.client.HTTPSConnection', return_value=connection), patch('deepseek.time.perf_counter', side_effect=[1, 1.15, 1.35]):
            c, r = self.gateway.connect('POST', '/chat/completions', FAKE_KEY, {'thinking': {'type': 'disabled'}})
        connection.connect.assert_called_once()
        self.assertAlmostEqual(c.orbit_timing['connect'], 150)
        self.assertAlmostEqual(c.orbit_timing['headers'], 200)
        self.assertNotIn(FAKE_KEY, json.dumps(c.orbit_timing))
        self.assertEqual(json.loads(connection.request.call_args.kwargs['body'])['thinking'], {'type': 'disabled'})

    def test_payload_contract_vision_thinking_json_and_token_limits(self):
        g = self.gateway
        raw = {'model': 'deepseek-flash', 'messages': [{'role': 'user', 'content': 'hello'}]}
        payload = g.payload(raw)
        self.assertEqual(payload['thinking'], {'type': 'enabled'})
        self.assertEqual(payload['reasoning_effort'], 'high')
        self.assertNotIn('max_tokens', payload)
        for effort in ('low', 'high', 'max'):
            self.assertEqual(g.payload({**raw, 'reasoning_effort': effort})['reasoning_effort'], effort)
        off = g.payload({**raw, 'thinking': {'type': 'disabled'}, 'temperature': 2, 'api_key': FAKE_KEY})
        self.assertNotIn('reasoning_effort', off)
        self.assertNotIn('api_key', off)
        self.assertNotIn('temperature', off)
        for invalid in [None, [], {}, {**raw, 'model': []}, {**raw, 'model': 'deepseek-chat'}, {**raw, 'messages': []},
                        {**raw, 'thinking': None}, {**raw, 'reasoning_effort': 'medium'}]:
            with self.subTest(invalid=invalid), self.assertRaises(deepseek.DeepSeekError): g.payload(invalid)
        for count in [-1, 0, 393217, True, '8192']:
            with self.assertRaises(deepseek.DeepSeekError): g.payload({**raw, 'max_tokens': count})
        self.assertEqual(g.payload({**raw, 'max_tokens': 393216})['max_tokens'], 393216)
        json_payload = g.payload({**raw, 'response_format': {'type': 'json_object'}})
        self.assertIn('JSON', json_payload['messages'][0]['content'])
        for model, role, url, valid in [('deepseek-flash', 'user', 'data:image/png;base64,AAAA', True),
                ('deepseek-v4-pro', 'user', 'data:image/png;base64,AAAA', False),
                ('deepseek-flash', 'assistant', 'data:image/png;base64,AAAA', False),
                ('deepseek-flash', 'system', 'data:image/png;base64,AAAA', False),
                ('deepseek-flash', 'user', 'https://example.com/image.png', False),
                ('deepseek-flash', 'user', 'data:image/svg+xml;base64,AAAA', False)]:
            image = {**raw, 'model': model, 'messages': [{'role': role, 'content': [{'type': 'image_url', 'image_url': {'url': url}}]}]}
            if valid: self.assertEqual(g.payload(image)['messages'], image['messages'])
            else:
                with self.assertRaises(deepseek.DeepSeekError): g.payload(image)
        images = [{'type': 'image_url', 'image_url': {'url': 'data:image/png;base64,AAAA'}}] * 601
        with self.assertRaises(deepseek.DeepSeekError): g.payload({**raw, 'messages': [{'role': 'user', 'content': images}]})

    def test_catalog_metadata_controls_vision_and_unknown_models_are_not_guessed(self):
        g = self.gateway; g.save(FAKE_KEY)
        response = Mock()
        response.read.return_value = json.dumps({'data': [None, {'id': []}, {'id': 'deepseek-flash', 'input_modalities': ['text']}, {'id': 'unknown-vision'}]}).encode()
        with patch.object(g, 'connect', return_value=(Mock(), response)):
            self.assertEqual(g.models(), [{'id': 'deepseek-flash', 'name': 'DeepSeek V4.1 Flash', 'remote': True, 'capabilities': ['thinking']}])

    def test_billing_and_rate_errors_are_actionable_and_never_echo_credentials(self):
        for status in [400, 401, 402, 403, 413, 422, 429, 500, 503, 418]:
            connection = Mock(); connection.getresponse.return_value.status = status
            with patch('deepseek.http.client.HTTPSConnection', return_value=connection):
                with self.assertRaises(deepseek.DeepSeekError) as caught: self.gateway.connect('GET', '/models', FAKE_KEY)
                self.assertNotIn(FAKE_KEY, str(caught.exception))
                self.assertEqual(caught.exception.status, status if status in deepseek.ERRORS else 502)
                if status == 402: self.assertIn('balance', str(caught.exception))
            connection.close.assert_called()

    def test_upstream_uses_fixed_tls_host_and_header_not_url_and_sanitizes_errors(self):
        g = self.gateway
        connection = Mock()
        connection.getresponse.return_value.status = 429
        with patch('deepseek.http.client.HTTPSConnection', return_value=connection) as factory:
            with self.assertRaises(deepseek.DeepSeekError) as caught:
                g.connect('GET', '/models', FAKE_KEY)
            self.assertEqual(caught.exception.status, 429)
            self.assertNotIn(FAKE_KEY, str(caught.exception))
            factory.assert_called_once_with('api.deepseek.com', timeout=20)
            args, kwargs = connection.request.call_args
            self.assertNotIn(FAKE_KEY, str(args))
            self.assertEqual(kwargs['headers']['Authorization'], 'Bearer ' + FAKE_KEY)


class EndpointFixture(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.http = server.IPv4ThreadingHTTPServer(('127.0.0.1', 0), server.OrbitHandler)
        cls.thread = threading.Thread(target=cls.http.serve_forever, daemon=True)
        cls.thread.start()

    @classmethod
    def tearDownClass(cls):
        cls.http.shutdown(); cls.http.server_close(); cls.thread.join()

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.gateway = deepseek.DeepSeekGateway(self.temp.name)
        patcher = patch.object(server, 'DEEPSEEK', self.gateway)
        patcher.start(); self.addCleanup(patcher.stop)

    def request(self, method, endpoint, payload=None, headers=None, include_headers=False):
        c = http.client.HTTPConnection('127.0.0.1', self.http.server_port, timeout=5)
        c.request(method, endpoint, json.dumps(payload) if payload is not None else None,
                  {'X-Orbit-DeepSeek': '1', 'Content-Type': 'application/json', **(headers or {})})
        response = c.getresponse()
        result = (response.status, response.read(), dict(response.getheaders())) if include_headers else (response.status, response.read())
        c.close()
        return result


class EndpointTests(EndpointFixture):
    def test_settings_key_never_returned_and_same_origin_required(self):
        path = '/api/deepseek/settings'
        for headers in [{'Origin': 'https://evil.example'}, {'Host': 'evil.example'}, {'Sec-Fetch-Site': 'cross-site'}, {'X-Orbit-DeepSeek': ''}]:
            self.assertEqual(self.request('POST', path, {'key': FAKE_KEY}, headers)[0], 403)
        self.assertEqual(self.gateway.key(), '')
        self.assertEqual(self.request('POST', path, {'key': FAKE_KEY}), (200, b'{"configured": true}'))
        self.assertEqual(self.request('GET', path), (200, b'{"configured": true}'))
        self.assertEqual(self.request('POST', path, {'key': ''}), (200, b'{"configured": false}'))

    def test_streaming_and_error_path_release_capacity(self):
        self.gateway.save(FAKE_KEY)
        payload = {'model': 'deepseek-flash', 'messages': [{'role': 'user', 'content': 'Hello'}]}
        stream = b'data: {"choices":[{"delta":{"content":"Hello"}}]}\n\ndata: [DONE]\n\n'
        response = Mock()
        response.getheader.return_value = 'text/event-stream'
        response.read1.side_effect = [stream[:20], stream[20:], b'']
        connection = Mock()
        with patch.object(self.gateway, 'connect', return_value=(connection, response)):
            self.assertEqual(self.request('POST', '/api/deepseek/chat', payload), (200, stream))
        connection.close.assert_called_once()
        with patch.object(self.gateway, 'connect', side_effect=OSError('private diagnostic ' + FAKE_KEY)):
            status, result = self.request('POST', '/api/deepseek/chat', payload)
            self.assertEqual(status, 502)
            self.assertNotIn(FAKE_KEY.encode(), result)
        for _ in range(3): self.assertTrue(self.gateway.slots.acquire(blocking=False))
        self.assertFalse(self.gateway.slots.acquire(blocking=False))

    def test_midstream_disconnect_and_busy_capacity_have_no_false_completion(self):
        self.gateway.save(FAKE_KEY)
        payload = {'model': 'deepseek-flash', 'messages': [{'role': 'user', 'content': 'Hello'}]}
        response = Mock(); response.getheader.return_value = 'text/event-stream'
        response.read1.side_effect = [b': keep-alive\n\n', OSError('private ' + FAKE_KEY)]
        with patch.object(self.gateway, 'connect', return_value=(Mock(), response)):
            status, body = self.request('POST', '/api/deepseek/chat', payload)
            self.assertEqual(status, 200)
            self.assertIn(b'data: {"error":', body)
            self.assertNotIn(FAKE_KEY.encode(), body)
            self.assertNotIn(b'[DONE]', body)
        for _ in range(3): self.gateway.slots.acquire()
        with patch.object(self.gateway, 'connect') as connect:
            self.assertEqual(self.request('POST', '/api/deepseek/chat', payload)[0], 429)
            connect.assert_not_called()
        for _ in range(3): self.gateway.slots.release()

    def test_invalid_endpoints_payload_and_secret_static_download(self):
        self.assertEqual(self.request('POST', '/api/deepseek/chat', {})[0], 401)
        self.assertEqual(self.request('GET', '/api/deepseek/chat')[0], 405)
        self.assertEqual(self.request('GET', '/api/deepseek/unknown')[0], 404)
        for method in ['GET', 'HEAD']:
            for path in ['/.orbit-deepseek.json', '/%2Eorbit-deepseek.json']:
                self.assertEqual(self.request(method, path)[0], 404)
        self.assertEqual(self.request('POST', '/api/deepseek/settings', {}, {'Content-Length': 'invalid'})[0], 400)
        self.assertEqual(self.request('POST', '/api/deepseek/settings', {})[0], 400)

class LatencyEndpointTests(EndpointFixture):
    def test_chat_is_not_queued_behind_a_catalog_refresh_and_exposes_safe_timing(self):
        g = self.gateway; g.save(FAKE_KEY)
        entered, release = threading.Event(), threading.Event()
        stream = b'data: {"choices":[{"delta":{"content":"OK"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n'
        catalog, reply = Mock(), Mock()
        catalog.read.return_value = b'{"data":[{"id":"deepseek-flash"}]}'
        reply.getheader.return_value = 'text/event-stream'; reply.read1.side_effect = [stream, b'']
        def connect(method, path, key, payload=None, timeout=20):
            connection = Mock(); connection.orbit_timing = {'connect': 150, 'headers': 200}
            if path == '/models':
                entered.set()
                if not release.wait(3): raise TimeoutError('Catalog test deadline')
                return connection, catalog
            return connection, reply
        payload = {'model': 'deepseek-flash', 'messages': [{'role': 'user', 'content': 'Synthetic prompt'}], 'thinking': {'type': 'disabled'}}
        with patch.object(g, 'connect', side_effect=connect), ThreadPoolExecutor(2) as workers:
            pending = workers.submit(self.request, 'GET', '/api/deepseek/models')
            try:
                self.assertTrue(entered.wait(1))
                status, body, headers = workers.submit(self.request, 'POST', '/api/deepseek/chat', payload, include_headers=True).result(timeout=1)
                self.assertEqual((status, body), (200, stream))
                self.assertEqual(headers['Server-Timing'], 'deepseek_connect;dur=150.0, deepseek_headers;dur=200.0')
                self.assertNotIn(FAKE_KEY, str(headers))
            finally: release.set()
            self.assertEqual(pending.result(timeout=1)[0], 200)

    def test_completed_stream_releases_capacity_without_waiting_for_socket_eof(self):
        self.gateway.save(FAKE_KEY)
        payload = {'model': 'deepseek-flash', 'messages': [{'role': 'user', 'content': 'Synthetic prompt'}]}
        final = b'data: {"choices":[{"delta":{"content":"Complete"},"finish_reason":"stop"}],"usage":{"total_tokens":150}}\n\n'
        response = Mock(); response.getheader.return_value = 'text/event-stream'
        response.read1.side_effect = [final[:17], final[17:], AssertionError('Waited for EOF after completion')]
        connection = Mock()
        with patch.object(self.gateway, 'connect', return_value=(connection, response)):
            self.assertEqual(self.request('POST', '/api/deepseek/chat', payload), (200, final))
        self.assertEqual(response.read1.call_count, 2)
        connection.close.assert_called_once()
        for _ in range(3): self.assertTrue(self.gateway.slots.acquire(blocking=False))
        self.assertFalse(self.gateway.slots.acquire(blocking=False))


if __name__ == '__main__': unittest.main()
