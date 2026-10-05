"""Cloud gateway contract tests; all inference uses a fake upstream."""
import json
from pathlib import Path
import re
import unittest
from unittest.mock import patch

try:
    from cloud.app import create_app
except ModuleNotFoundError:
    create_app = None

ROOT = Path(__file__).resolve().parent.parent
ORIGIN = 'https://orbit-example.onrender.com'
PASSWORD = 'testpass'  # Exactly eight characters exercises the minimum on every login.


class Upstream:
    def __init__(self, data=None, status=200, lines=None):
        self.status_code = status
        self.data = data or {}
        self.lines = lines or []
        self.closed = False

    def __enter__(self):
        return self

    def __exit__(self, *args):
        self.close()

    def close(self):
        self.closed = True

    def iter_content(self, size):
        yield json.dumps(self.data).encode()

    def iter_lines(self, chunk_size):
        yield from self.lines


@unittest.skipIf(create_app is None, 'Install cloud/requirements.txt to test the optional cloud edition')
class CloudTests(unittest.TestCase):
    def setUp(self):
        self.config = dict(TESTING=True, SECRET_KEY='session-test-key-' * 3,
            ORBIT_PASSWORD=PASSWORD, OLLAMA_API_KEY='test-upstream-secret',
            PUBLIC_ORIGIN=ORIGIN, PUBLIC_DIR=str(ROOT / 'release/Orbit-Cloud/public'))
        self.app = create_app(self.config)
        self.client = self.app.test_client()

    def get(self, path):
        return self.client.get(path, base_url=ORIGIN)

    def post(self, path, **kwargs):
        headers = {'Origin': ORIGIN, **kwargs.pop('headers', {})}
        return self.client.post(path, base_url=ORIGIN, headers=headers, **kwargs)

    def login(self):
        page = self.get('/login')
        csrf = re.search(r'name="csrf" value="([^"]+)"', page.text)[1]
        result = self.post('/login', data={'csrf': csrf, 'password': PASSWORD})
        self.assertEqual(result.status_code, 303)
        return result

    def test_requires_configuration(self):
        for key, value in [('SECRET_KEY', ''), ('ORBIT_PASSWORD', 'seven77'), ('ORBIT_PASSWORD', 'x' * 1025), ('OLLAMA_API_KEY', ''), ('PUBLIC_ORIGIN', 'http://example.com'), ('PUBLIC_ORIGIN', 'https://example.com/path')]:
            with self.subTest(key=key), self.assertRaises(RuntimeError):
                create_app({**self.config, key: value})

    def test_voice_probe_requires_login_and_custom_header(self):
        with patch('cloud.app.VoiceInternetProbe.check', return_value=True) as probe:
            self.assertEqual(self.get('/api/voice/connectivity').status_code, 401)
            probe.assert_not_called()
            self.login()
            self.assertEqual(self.get('/api/voice/connectivity').status_code, 403)
            probe.assert_not_called()
            response = self.client.get('/api/voice/connectivity', base_url=ORIGIN, headers={'X-Orbit-Voice': '1'})
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.json, {'online': True})
            self.assertEqual(response.headers['Cache-Control'], 'no-store')
            probe.assert_called_once()

    def test_anonymous_cannot_read_app_or_call_upstream(self):
        with patch('cloud.app.requests.request') as upstream:
            for path in ('/', '/app.js', '/cloud-config.js'):
                self.assertEqual(self.get(path).status_code, 303)
            self.assertEqual(self.get('/api/ollama/tags').status_code, 401)
            self.assertEqual(self.post('/api/ollama/chat', json={'model': 'x'}).status_code, 401)
            upstream.assert_not_called()
        self.assertEqual(self.get('/healthz').json, {'status': 'ok'})

    def test_login_csrf_bad_password_and_cookie_flags(self):
        self.assertEqual(self.post('/login', data={'password': PASSWORD}).status_code, 403)
        self.get('/login')
        self.assertEqual(self.post('/login', data={'csrf': '日本語', 'password': PASSWORD}).status_code, 403)
        csrf = re.search(r'name="csrf" value="([^"]+)"', self.get('/login').text)[1]
        bad = self.post('/login', data={'csrf': csrf, 'password': 'incorrect'})
        self.assertEqual(bad.status_code, 401)
        result = self.login()
        cookie = result.headers['Set-Cookie']
        for flag in ('Secure', 'HttpOnly', 'SameSite=Strict', 'Path=/'):
            self.assertIn(flag, cookie)

    def test_global_login_rate_limit_cannot_be_bypassed_with_forwarded_ip(self):
        csrf = re.search(r'name="csrf" value="([^"]+)"', self.get('/login').text)[1]
        with patch('cloud.app.check_password_hash', return_value=False):
            for number in range(20):
                self.assertEqual(self.post('/login', data={'csrf': csrf, 'password': 'no'}, headers={'X-Forwarded-For': str(number)}).status_code, 401)
            self.assertEqual(self.post('/login', data={'csrf': csrf, 'password': 'no'}).status_code, 429)

    def test_origin_checks_and_sensitive_files(self):
        self.login()
        for origin in ('https://evil.example', 'null', ''):
            self.assertEqual(self.post('/api/ollama/chat', headers={'Origin': origin}, json={}).status_code, 403)
        self.assertEqual(self.client.get('/', base_url='https://evil.example').status_code, 400)
        for path in ('/server.py', '/cloud/app.py', '/.env', '/service-worker.js', '/%2e%2e/server.py'):
            self.assertEqual(self.get(path).status_code, 404)
        page = self.get('/')
        self.assertEqual(page.status_code, 200)
        self.assertIn('/cloud-config.js', page.text)
        self.assertIn('Sign out', page.text)
        self.assertIn('Message Orbit', page.text)
        self.assertNotIn('test-upstream-secret', page.text)
        self.assertNotIn(PASSWORD, page.text)
        self.assertEqual(page.headers['Cache-Control'], 'no-store')

    def test_analyze_has_separate_sandbox_policy_and_bundled_runtime(self):
        self.login()
        page = self.get('/')
        self.assertNotIn("'unsafe-eval'", page.headers['Content-Security-Policy'])
        self.assertIn('boot.js', page.text)
        self.assertNotIn('<script>', page.text)
        sandbox = self.get('/analyze-sandbox.html')
        self.assertEqual(sandbox.status_code, 200)
        self.assertIn('sandbox allow-scripts;', sandbox.headers['Content-Security-Policy'])
        self.assertIn("connect-src 'none'", sandbox.headers['Content-Security-Policy'])
        self.assertNotIn('allow-same-origin', sandbox.headers['Content-Security-Policy'])
        self.assertNotIn('X-Frame-Options', sandbox.headers)
        cached = self.client.get('/analyze-sandbox.html', base_url=ORIGIN,
            headers={'If-Modified-Since': sandbox.headers['Last-Modified']})
        self.assertEqual(cached.status_code, 304)
        self.assertEqual(cached.headers['Content-Security-Policy'], sandbox.headers['Content-Security-Policy'])
        sandbox.close()
        manifest = self.get('/vendor/analyze/manifest.json')
        self.assertEqual(manifest.status_code, 200)
        for file in manifest.json['files']:
            with self.get('/vendor/analyze/' + file['name']) as response:
                self.assertEqual(response.status_code, 200)
        for path in ['/tests/browser-analyze.html', '/private.json', '/private.zip']:
            self.assertEqual(self.get(path).status_code, 404)

    def test_logout_revokes_access(self):
        self.login()
        csrf = re.search(r'name="csrf" value="([^"]+)"', self.get('/').text)[1]
        self.assertEqual(self.post('/logout', data={'csrf': csrf}).status_code, 303)
        self.assertEqual(self.get('/api/ollama/tags').status_code, 401)

    def test_models_have_cloud_flag_and_are_cached(self):
        self.login()
        response = Upstream({'models': [{'name': 'gemma4:31b', 'details': {'parameter_size': '31B'}}]})
        with patch('cloud.app.requests.request', return_value=response) as upstream:
            result = self.get('/api/ollama/tags')
            self.assertEqual(result.json['models'][0]['remote_model'], 'gemma4:31b')
            self.get('/api/ollama/tags')
            self.assertEqual(upstream.call_count, 1)
            self.assertEqual(upstream.call_args.args[:2], ('GET', 'https://ollama.com/api/tags'))
            self.assertEqual(upstream.call_args.kwargs['headers']['Authorization'], 'Bearer test-upstream-secret')
            self.assertFalse(upstream.call_args.kwargs['allow_redirects'])

    def test_stream_events_and_disconnect_release_slot(self):
        self.login()
        lines = [b'{"message":{"thinking":"working"}}', b'{"message":{"content":"hello"}}', b'{"done":true}']
        for number in range(6):
            response = Upstream(lines=lines)
            with patch('cloud.app.requests.request', return_value=response) as upstream:
                result = self.post('/api/ollama/chat', json={'model': 'gpt-oss:20b', 'messages': [{'role': 'user', 'content': 'Hi'}], 'think': 'low', 'url': 'https://evil.example', 'Authorization': 'bad'})
                self.assertEqual(result.status_code, 200)
                if number % 2:
                    self.assertEqual(result.data, b'\n'.join(lines) + b'\n')
                result.close()
                self.assertTrue(response.closed)
                payload = upstream.call_args.kwargs['json']
                self.assertEqual(payload['think'], 'low')
                self.assertNotIn('url', payload)
                self.assertNotIn('Authorization', payload)

    def test_chat_errors_are_sanitized_and_bounded(self):
        self.login()
        self.assertEqual(self.post('/api/ollama/chat', json={'model': 'x', 'messages': []}).status_code, 400)
        self.assertEqual(self.post('/api/ollama/chat', json={'model': 'x', 'messages': [{}] * 1001}).status_code, 400)
        for status in (401, 403, 404, 429, 500):
            with patch('cloud.app.requests.request', return_value=Upstream({'error': 'secret'}, status=status)):
                result = self.post('/api/ollama/chat', json={'model': 'x', 'messages': [{'role': 'user', 'content': 'Hi'}]})
                self.assertEqual(result.status_code, 429 if status == 429 else 502)
                self.assertEqual(result.json['retryable'], status >= 500)
                self.assertNotIn('secret', result.text)

    def test_web_uses_cloud_endpoints_and_filters_private_urls(self):
        self.login()
        self.assertEqual(self.post('/api/web/search', json={'query': 'weather'}).status_code, 403)
        with patch('cloud.app.requests.request', return_value=Upstream({'results': [{'url': 'https://example.com', 'title': 'Example', 'content': 'text'}, {'url': 'https://127.0.0.1', 'content': 'private'}]})) as upstream:
            result = self.post('/api/web/search', headers={'X-Orbit-Web': '1'}, json={'query': 'weather'})
            self.assertEqual(len(result.json['results']), 1)
            self.assertEqual(upstream.call_args.args[1], 'https://ollama.com/api/web_search')
        with patch('cloud.app.requests.request', return_value=Upstream({'url': 'https://example.com', 'content': 'background ' * 2000 + 'Late material qualification.' + ' tail' * 16000})):
            result = self.post('/api/web/fetch', headers={'X-Orbit-Web': '1'}, json={'url': 'https://example.com'})
            self.assertIn('Late material qualification.', result.json['content'])
            self.assertLessEqual(len(result.json['content']), 64000)
        self.assertEqual(self.post('/api/web/fetch', headers={'X-Orbit-Web': '1'}, json={'url': 'https://127.0.0.1'}).status_code, 400)
        with patch('cloud.app.requests.request', return_value=Upstream(status=403)), patch('cloud.app.public_web_fallback', return_value=None):
            result = self.post('/api/web/fetch', headers={'X-Orbit-Web': '1'}, json={'url': 'https://example.com'})
            self.assertEqual(result.json['code'], 'source_unavailable')

    def test_web_quota_uses_public_backup_and_skips_quota_on_followup(self):
        self.login()
        fallback={'provider':'public-search','engine':'DuckDuckGo','results':[{'url':'https://example.com/a','title':'Source','content':'Facts'}]}
        with patch('cloud.app.requests.request',return_value=Upstream(status=429)) as relay, patch('cloud.app.public_web_fallback',return_value=fallback) as backup:
            for _ in range(2):
                result=self.post('/api/web/search',headers={'X-Orbit-Web':'1'},json={'query':'public topic'})
                self.assertEqual(result.status_code,200);self.assertEqual(result.json['engine'],'DuckDuckGo')
            self.assertEqual(relay.call_count,1);self.assertEqual(backup.call_count,2)

    def test_web_malformed_and_empty_relay_responses_use_backup(self):
        self.login()
        fallback={'provider':'public-search','results':[{'url':'https://example.com/a','content':'Facts'}]}
        for data in [{'results':None},{'results':[]},{'results':[None,{'url':'https://localhost'}]}]:
            with patch('cloud.app.requests.request',return_value=Upstream(data)), patch('cloud.app.public_web_fallback',return_value=fallback):
                result=self.post('/api/web/search',headers={'X-Orbit-Web':'1'},json={'query':'topic'})
                self.assertEqual(result.status_code,200);self.assertEqual(result.json,fallback)
        with patch('cloud.app.requests.request',side_effect=__import__('requests').Timeout('timeout')), patch('cloud.app.public_web_fallback',return_value=fallback):
            self.assertEqual(self.post('/api/web/search',headers={'X-Orbit-Web':'1'},json={'query':'topic'}).status_code,200)


if __name__ == '__main__':
    unittest.main()
