"""Gemini gateway tests use synthetic credentials and mocked Google responses."""
import http.client
import io
import json
from pathlib import Path
import stat
import tempfile
import threading
import unittest
from unittest.mock import Mock, patch
import gemini
import server

FAKE_KEY = 'synthetic-test-key-not-a-real-credential'


class GatewayTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.gateway = gemini.GeminiGateway(self.temp.name)

    def test_key_storage_permissions_replace_remove_and_invalid_inputs(self):
        g = self.gateway
        self.assertEqual(g.key(), '')
        for key in [None, [], 'short', 'x' * 513, 'a' * 20 + '\n']:
            with self.assertRaises(gemini.GeminiError):
                g.save(key)
        g.save(FAKE_KEY)
        self.assertEqual(g.key(), FAKE_KEY)
        self.assertEqual(stat.S_IMODE(g.path.stat().st_mode), 0o600)
        self.assertEqual(gemini.GeminiGateway(self.temp.name).key(), FAKE_KEY)
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
        response.read.return_value = json.dumps({'data': [{'id': i} for i in ['models/gemini-3.8-flash', 'gemini-3.8-flash', 'gemini-pro', 'gemini-2.5-flash']]}).encode()
        with patch.object(g, 'connect', return_value=(connection, response)) as connect:
            result = g.models()
            self.assertEqual([m['id'] for m in result], ['gemini-3.8-flash', 'gemini-2.5-flash'])
            self.assertEqual(g.models(), result)
            connect.assert_called_once()
            self.assertNotIn(FAKE_KEY, json.dumps(result))
        connection.close.assert_called_once()

    def test_catalog_failures_back_off_and_replacing_key_allows_retry(self):
        g = self.gateway
        g.save(FAKE_KEY)
        with patch.object(g, 'connect', side_effect=gemini.GeminiError(403, 'Denied')) as connect:
            with self.assertRaises(gemini.GeminiError): g.models()
            with self.assertRaises(gemini.GeminiError): g.models()
            self.assertEqual(connect.call_count, 1)
            g.save(FAKE_KEY)
            with self.assertRaises(gemini.GeminiError): g.models()
            self.assertEqual(connect.call_count, 2)

    def test_payload_enforces_models_roles_uploaded_images_and_drops_extras(self):
        g = self.gateway
        good = {'model': 'gemini-2.5-flash', 'messages': [{'role': 'user', 'content': 'hello'}], 'reasoning_effort': 'none', 'temperature': 0, 'api_key': FAKE_KEY, 'max_tokens': -1}
        result = g.payload(good)
        self.assertEqual(result, {'model': 'gemini-2.5-flash', 'messages': good['messages'], 'stream': True, 'stream_options': {'include_usage': True}, 'reasoning_effort': 'none'})
        for invalid in [None, [], {}, {**good, 'model': []}, {**good, 'model': 'gemini-pro'}, {**good, 'messages': []}, {**good, 'messages': [{'role': 'tool', 'content': 'hello'}]}, {**good, 'model': 'gemini-3.8-flash'}]:
            with self.subTest(invalid=invalid), self.assertRaises(gemini.GeminiError): g.payload(invalid)
        for url, valid in [('https://example.com/image.png', False), ('data:image/svg+xml;base64,AAAA', False), ('data:image/png;base64,AAAA', True)]:
            raw = {**good, 'messages': [{'role': 'user', 'content': [{'type': 'image_url', 'image_url': {'url': url}}]}]}
            if valid: self.assertEqual(g.payload(raw)['messages'], raw['messages'])
            else:
                with self.assertRaises(gemini.GeminiError): g.payload(raw)

    def test_upstream_uses_fixed_tls_host_and_header_not_url_and_sanitizes_errors(self):
        g = self.gateway
        connection = Mock()
        connection.getresponse.return_value.status = 429
        with patch('gemini.http.client.HTTPSConnection', return_value=connection) as factory:
            with self.assertRaises(gemini.GeminiError) as caught:
                g.connect('GET', '/v1beta/openai/models', FAKE_KEY)
            self.assertEqual(caught.exception.status, 429)
            self.assertNotIn(FAKE_KEY, str(caught.exception))
            factory.assert_called_once_with('generativelanguage.googleapis.com', timeout=20)
            args, kwargs = connection.request.call_args
            self.assertNotIn(FAKE_KEY, str(args))
            self.assertEqual(kwargs['headers']['Authorization'], 'Bearer ' + FAKE_KEY)


class EndpointTests(unittest.TestCase):
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
        self.gateway = gemini.GeminiGateway(self.temp.name)
        patcher = patch.object(server, 'GEMINI', self.gateway)
        patcher.start(); self.addCleanup(patcher.stop)

    def request(self, method, endpoint, payload=None, headers=None):
        c = http.client.HTTPConnection('127.0.0.1', self.http.server_port, timeout=5)
        c.request(method, endpoint, json.dumps(payload) if payload is not None else None,
                  {'X-Orbit-Gemini': '1', 'Content-Type': 'application/json', **(headers or {})})
        response = c.getresponse()
        result = response.status, response.read()
        c.close()
        return result

    def test_settings_key_never_returned_and_same_origin_required(self):
        path = '/api/gemini/settings'
        for headers in [{'Origin': 'https://evil.example'}, {'Host': 'evil.example'}, {'Sec-Fetch-Site': 'cross-site'}, {'X-Orbit-Gemini': ''}]:
            self.assertEqual(self.request('POST', path, {'key': FAKE_KEY}, headers)[0], 403)
        self.assertEqual(self.gateway.key(), '')
        self.assertEqual(self.request('POST', path, {'key': FAKE_KEY}), (200, b'{"configured": true}'))
        self.assertEqual(self.request('GET', path), (200, b'{"configured": true}'))
        self.assertEqual(self.request('POST', path, {'key': ''}), (200, b'{"configured": false}'))

    def test_streaming_and_error_path_release_capacity(self):
        self.gateway.save(FAKE_KEY)
        payload = {'model': 'gemini-3.8-flash', 'messages': [{'role': 'user', 'content': 'Hello'}]}
        stream = b'data: {"choices":[{"delta":{"content":"Hello"}}]}\n\ndata: [DONE]\n\n'
        response = Mock()
        response.getheader.return_value = 'text/event-stream'
        response.read1.side_effect = [stream[:20], stream[20:], b'']
        connection = Mock()
        with patch.object(self.gateway, 'connect', return_value=(connection, response)):
            self.assertEqual(self.request('POST', '/api/gemini/chat', payload), (200, stream))
        connection.close.assert_called_once()
        with patch.object(self.gateway, 'connect', side_effect=OSError('private diagnostic ' + FAKE_KEY)):
            status, result = self.request('POST', '/api/gemini/chat', payload)
            self.assertEqual(status, 502)
            self.assertNotIn(FAKE_KEY.encode(), result)
        for _ in range(3): self.assertTrue(self.gateway.slots.acquire(blocking=False))
        self.assertFalse(self.gateway.slots.acquire(blocking=False))

    def test_invalid_endpoints_payload_and_secret_static_download(self):
        self.assertEqual(self.request('POST', '/api/gemini/chat', {})[0], 401)
        self.assertEqual(self.request('GET', '/api/gemini/chat')[0], 405)
        self.assertEqual(self.request('GET', '/api/gemini/unknown')[0], 404)
        for method in ['GET', 'HEAD']:
            for path in ['/.orbit-gemini.json', '/%2Eorbit-gemini.json']:
                self.assertEqual(self.request(method, path)[0], 404)
        self.assertEqual(self.request('POST', '/api/gemini/settings', {}, {'Content-Length': 'invalid'})[0], 400)
        self.assertEqual(self.request('POST', '/api/gemini/settings', {})[0], 400)

if __name__ == '__main__': unittest.main()
