import importlib.util
import json
import threading
import unittest
import http.client
from pathlib import Path
from unittest.mock import patch, Mock

spec = importlib.util.spec_from_file_location('orbit_server', Path(__file__).resolve().parents[1] / 'server.py')
orbit = importlib.util.module_from_spec(spec)
spec.loader.exec_module(orbit)


class WebValidationTests(unittest.TestCase):
    def test_static_handler_never_opens_secret_or_outside_paths(self):
        # No real key is read, and no live server or socket is involved.
        handler = object.__new__(orbit.OrbitHandler)
        handler.path = '/sentinel'
        handler.send_error = Mock()
        for relative in ['.orbit-gemini.json', 'orbit.com-key.pem', 'OTHER.PEM', '.env', '.git/config', '../outside.txt']:
            handler.translate_path = Mock(return_value=str(orbit.ROOT / relative))
            handler.send_error.reset_mock()
            self.assertIsNone(handler.send_head())
            handler.send_error.assert_called_once_with(404)
        handler.send_error.reset_mock()
        self.assertIsNone(handler.list_directory(str(orbit.ROOT)))
        handler.send_error.assert_called_once_with(404)

    def test_stream_timeout_never_appends_html_after_headers(self):
        import io
        handler = object.__new__(orbit.OrbitHandler)
        handler.headers = {}
        handler.wfile = io.BytesIO()
        handler.send_response = Mock()
        handler.send_header = Mock()
        handler.end_headers = Mock()
        handler.send_error = Mock()
        response = Mock(status=200, reason='OK')
        response.getheader.return_value = 'application/x-ndjson'
        response.read1.side_effect = [b'{"message":{"content":"partial"}}\n', TimeoutError('idle')]
        connection = Mock()
        connection.getresponse.return_value = response
        with patch.object(orbit.http.client, 'HTTPConnection', return_value=connection):
            handler.proxy_to_ollama('GET', '/api/chat')
        handler.send_error.assert_not_called()
        self.assertTrue(handler.close_connection)
        self.assertEqual(handler.wfile.getvalue(), b'{"message":{"content":"partial"}}\n')
        connection.close.assert_called_once()

    def test_private_and_credential_urls_rejected(self):
        for url in ['http://example.com', 'https://127.0.0.1', 'https://10.0.0.1', 'https://169.254.169.254', 'https://[::1]', 'https://localhost', 'https://foo.local', 'https://2130706433', 'https://user:pass@example.com', 'https://example.com:11434', 'https://example.com/?api_key=secret', 'https://orbit.com', 'https://example.com\\@localhost']:
            with self.subTest(url=url), self.assertRaises(ValueError):
                orbit.public_web_url(url)
        self.assertEqual(orbit.public_web_url('https://example.com/page#section'), 'https://example.com/page')

    def test_long_article_parser_retains_late_qualifications_with_a_fixed_cap(self):
        parser = orbit._PublicPageParser()
        parser.feed('<p>' + 'background ' * 2000 + '</p><p>Late material qualification.</p><p>' + 'tail ' * 16000 + '</p>')
        parser.close()
        _, content = parser.result()
        self.assertIn('Late material qualification.', content)
        self.assertLessEqual(len(content), 64000)

    def test_payload_is_strict_and_drops_untrusted_fields(self):
        self.assertEqual(orbit.web_payload('search', {'query': '  Public topic ', 'max_results': 999, 'url': 'http://localhost'}), {'query': 'Public topic', 'max_results': 5})
        for raw in [None, [], {'query': ''}, {'query': 'x' * 401}, {'query': 'a\nb'}]:
            with self.assertRaises(ValueError):
                orbit.web_payload('search', raw)


class WebEndpointTests(unittest.TestCase):
    def setUp(self):
        # Deterministic failure tests must never call live backup engines.
        for name in ('bing_rss_search', 'duckduckgo_web_search'):
            stub = patch.object(orbit, name, return_value=[])
            stub.start()
            self.addCleanup(stub.stop)
        stub = patch.object(orbit, 'WEB_RELAY_BACKOFF', orbit.WebRelayBackoff())
        stub.start()
        self.addCleanup(stub.stop)

    @classmethod
    def setUpClass(cls):
        cls.server = orbit.IPv4ThreadingHTTPServer(('127.0.0.1', 0), orbit.OrbitHandler)
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join()

    def post(self, path, payload, extra=None):
        connection = http.client.HTTPConnection('127.0.0.1', self.server.server_port, timeout=5)
        headers = {'Content-Type': 'application/json', 'X-Orbit-Web': '1'}
        headers.update(extra or {})
        connection.request('POST', path, json.dumps(payload), headers)
        response = connection.getresponse()
        result = response.status, json.loads(response.read())
        connection.close()
        return result

    def test_cross_origin_and_simple_requests_are_blocked(self):
        self.assertEqual(self.post('/api/web/search', {'query': 'test'}, {'Origin': 'https://evil.example'})[0], 403)
        self.assertEqual(self.post('/api/web/search', {'query': 'test'}, {'X-Orbit-Web': ''})[0], 403)
        self.assertEqual(self.post('/api/web/search', {'query': 'test'}, {'Host': 'evil.example'})[0], 403)

    def test_bad_url_rejected_before_runtime_call(self):
        self.assertEqual(self.post('/api/web/fetch', {'url': 'https://127.0.0.1'})[0], 400)

    def test_missing_source_is_not_reported_as_an_ollama_upgrade(self):
        class Upstream(orbit.http.server.BaseHTTPRequestHandler):
            def do_POST(self):
                self.rfile.read(int(self.headers['Content-Length']))
                self.send_response(404); self.end_headers()
                self.wfile.write(b'{"error":"page not found"}')
            def log_message(self, *_):
                pass
        upstream = orbit.http.server.ThreadingHTTPServer(('127.0.0.1', 0), Upstream)
        thread = threading.Thread(target=upstream.serve_forever, daemon=True); thread.start()
        try:
            with patch.object(orbit, 'OLLAMA_PORT', upstream.server_port), patch.object(orbit, 'public_web_fetch', side_effect=ValueError('offline')):
                status, result = self.post('/api/web/fetch', {'url': 'https://example.com/missing'})
                self.assertEqual(status, 502)
                self.assertEqual(result['code'], 'source_unavailable')
                self.assertNotIn('Update Ollama', result['error'])
                with patch.object(orbit, 'bing_web_search', return_value=[]):
                    _, search = self.post('/api/web/search', {'query': 'public topic'})
                self.assertIn('Update Ollama', search['error'])
                self.assertFalse(search['retryable'])
        finally:
            upstream.shutdown(); upstream.server_close(); thread.join()

    def test_public_search_fallback_is_used_when_ollama_relay_fails(self):
        class Upstream(orbit.http.server.BaseHTTPRequestHandler):
            def do_POST(self):
                self.rfile.read(int(self.headers['Content-Length']))
                self.send_response(502); self.end_headers()
            def log_message(self, *_):
                pass
        upstream = orbit.http.server.ThreadingHTTPServer(('127.0.0.1', 0), Upstream)
        thread = threading.Thread(target=upstream.serve_forever, daemon=True); thread.start()
        try:
            fallback = [{'url': 'https://example.com/story', 'title': 'Story', 'content': 'A short excerpt.'}]
            with patch.object(orbit, 'OLLAMA_PORT', upstream.server_port), patch.object(orbit, 'bing_web_search', return_value=fallback):
                status, result = self.post('/api/web/search', {'query': 'public topic'})
            self.assertEqual(status, 200)
            self.assertEqual(result['provider'], 'public-search')
            self.assertEqual(result['results'], fallback)
        finally:
            upstream.shutdown(); upstream.server_close(); thread.join()

    def test_public_page_fallback_is_used_when_ollama_reader_fails(self):
        class Upstream(orbit.http.server.BaseHTTPRequestHandler):
            def do_POST(self):
                self.rfile.read(int(self.headers['Content-Length']))
                self.send_response(502); self.end_headers()
            def log_message(self, *_):
                pass
        upstream = orbit.http.server.ThreadingHTTPServer(('127.0.0.1', 0), Upstream)
        thread = threading.Thread(target=upstream.serve_forever, daemon=True); thread.start()
        try:
            fallback = {'url': 'https://example.com/story', 'title': 'Story', 'content': 'Full readable page text.'}
            with patch.object(orbit, 'OLLAMA_PORT', upstream.server_port), patch.object(orbit, 'public_web_fetch', return_value=fallback):
                status, result = self.post('/api/web/fetch', {'url': 'https://example.com/story'})
            self.assertEqual(status, 200)
            self.assertEqual(result['provider'], 'public-page')
            self.assertEqual(result['content'], fallback['content'])
            self.assertIn('read directly', result['notice'])
        finally:
            upstream.shutdown(); upstream.server_close(); thread.join()

    def test_bing_result_parser_keeps_only_result_cards(self):
        parser = orbit._BingResultParser()
        parser.feed('''<li class="b_algo"><h2><a href="https://example.com/a"><strong>Example</strong> result</a></h2><div class="b_caption"><p class="b_lineclamp2">An excerpt.</p></div></li><li class="other"><h2>Ignore</h2></li>''')
        parser.close()
        self.assertEqual(parser.results, [{'url': 'https://example.com/a', 'title': 'Example result', 'content': 'An excerpt.'}])

    def test_public_page_parser_omits_scripts_and_keeps_readable_text(self):
        parser = orbit._PublicPageParser()
        parser.feed('<html><head><title>Example</title><script>ignore()</script></head><body><h1>Heading</h1><p>First&nbsp;paragraph.</p><nav>Menu</nav><p>Second paragraph.</p></body></html>')
        parser.close()
        title, content = parser.result()
        self.assertEqual(title, 'Example')
        self.assertIn('Heading', content)
        self.assertIn('First paragraph.', content)
        self.assertIn('Second paragraph.', content)
        self.assertNotIn('ignore', content)

    def test_success_is_bounded_and_only_expected_fields_are_returned(self):
        # Fake the upstream port rather than the client HTTP implementation.
        class Upstream(orbit.http.server.BaseHTTPRequestHandler):
            def do_POST(self):
                body = json.loads(self.rfile.read(int(self.headers['Content-Length'])))
                self.server.last = self.path, body
                self.send_response(200); self.end_headers()
                self.wfile.write(json.dumps({'results': [{'url': 'https://example.com', 'title': 'Example', 'content': 'x' * 10000, 'secret': 'never-forward'}, {'url': 'https://localhost', 'title': 'local', 'content': 'no'}]}).encode())
            def log_message(self, *_):
                pass
        upstream = orbit.http.server.ThreadingHTTPServer(('127.0.0.1', 0), Upstream)
        thread = threading.Thread(target=upstream.serve_forever, daemon=True); thread.start()
        try:
            with patch.object(orbit, 'OLLAMA_PORT', upstream.server_port):
                status, result = self.post('/api/web/search', {'query': 'public topic'})
            self.assertEqual(status, 200)
            self.assertEqual(upstream.last, ('/api/experimental/web_search', {'query': 'public topic', 'max_results': 5}))
            self.assertEqual(len(result['results']), 1)
            self.assertEqual(len(result['results'][0]['content']), 8000)
            self.assertNotIn('secret', result['results'][0])
        finally:
            upstream.shutdown(); upstream.server_close(); thread.join()

class PublicSearchRobustnessTests(unittest.TestCase):
    def test_bing_caption_variants_unicode_and_tracking_destinations(self):
        target = 'https://docs.example.com/caf%C3%A9?x=1&y=2'
        encoded = 'a1' + orbit.base64.urlsafe_b64encode(target.encode()).decode().rstrip('=')
        document = '<li class="extra b_algo"><h2><a href="https://www.bing.com/ck/a?u=' + encoded + '">Café <strong>research</strong></a></h2><div class="b_caption"><p>Complete <span>search</span> excerpt &amp; detail.</p></div></li>'
        with patch.object(orbit, '_public_search_body', return_value=document):
            result = orbit.bing_web_search('café research')
        self.assertEqual(result[0]['url'], target)
        self.assertEqual(result[0]['title'], 'Café research')
        self.assertIn('excerpt & detail', result[0]['content'])
        spoof = 'https://evilbing.com/ck/a?u=' + encoded
        self.assertEqual(orbit._unwrap_bing_url(spoof), spoof)

    def test_rss_structured_results_filter_private_duplicates_and_unsafe_xml(self):
        body = '<rss><channel><item><title>Primary source</title><link>https://example.com/a</link><description>Public facts.</description></item><item><link>https://localhost/x</link></item><item><link>https://example.com/a</link></item></channel></rss>'
        with patch.object(orbit, '_public_search_body', return_value=body):
            self.assertEqual(orbit.bing_rss_search('topic'), [{'url':'https://example.com/a','title':'Primary source','content':'Public facts.'}])
        for body in ['<rss>broken', '<!DOCTYPE rss [<!ENTITY x "expansion">]><rss/>', '<!ENTITY x SYSTEM "file:///private">']:
            with patch.object(orbit, '_public_search_body', return_value=body), self.assertRaises((ValueError, orbit.ElementTree.ParseError)):
                orbit.bing_rss_search('topic')

    def test_duckduckgo_real_result_shapes_unwrap_only_trusted_redirects(self):
        body = '''<a class="result__a" href="http://[broken">Bad</a>
        <a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fa">Primary <b>article</b></a><a class="result__snippet">An actual excerpt.</a>
        <a class="result__a" href="https://example.com/a">Duplicate</a>
        <a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2F127.0.0.1%2F">Private</a>
        <a class="result__a" href="https://other.example.com/b">Other</a><div class="result__snippet">Second excerpt.</div>'''
        with patch.object(orbit, '_public_search_body', return_value=body):
            results = orbit.duckduckgo_web_search('topic')
        self.assertEqual([x['url'] for x in results], ['https://example.com/a', 'https://other.example.com/b'])
        self.assertEqual(results[0]['content'], 'An actual excerpt.')
        self.assertEqual(results[1]['content'], 'Second excerpt.')
        with patch.object(orbit, '_public_search_body', return_value='<form>Verify you are a human. Captcha.</form>'):
            self.assertEqual(orbit.duckduckgo_web_search('topic'), [])

    def test_chain_recovers_from_empty_timeout_captcha_and_malformed_rss(self):
        expected = [{'url':'https://example.com/a','title':'Primary source','content':'Facts'}]
        for bing in [[], OSError('timeout'), ValueError('too large')]:
            with patch.object(orbit,'bing_web_search',side_effect=bing if isinstance(bing,Exception) else None,return_value=bing), patch.object(orbit,'bing_rss_search',side_effect=orbit.ElementTree.ParseError('malformed')), patch.object(orbit,'duckduckgo_web_search',return_value=expected):
                result = orbit.public_web_fallback('search',{'query':'topic'})
            self.assertEqual(result['engine'],'DuckDuckGo')
            self.assertEqual(result['results'],expected)
        with patch.object(orbit,'bing_web_search',return_value=expected), patch.object(orbit,'bing_rss_search') as rss, patch.object(orbit,'duckduckgo_web_search') as ddg:
            self.assertEqual(orbit.public_web_fallback('search',{'query':'topic'})['engine'],'Bing')
            rss.assert_not_called(); ddg.assert_not_called()
        with patch.object(orbit,'bing_web_search',return_value=[]), patch.object(orbit,'bing_rss_search',return_value=expected), patch.object(orbit,'duckduckgo_web_search') as ddg:
            self.assertEqual(orbit.public_web_fallback('search',{'query':'topic'})['engine'],'Bing RSS')
            ddg.assert_not_called()
        with patch.object(orbit,'bing_web_search',return_value=[]), patch.object(orbit,'bing_rss_search',return_value=[]), patch.object(orbit,'duckduckgo_web_search',return_value=[]):
            self.assertIsNone(orbit.public_web_fallback('search',{'query':'topic'}))

    def test_untrusted_result_shapes_are_deduplicated_and_bounded(self):
        for raw in [None, 'results', {'url':'https://example.com'}, 5]:
            self.assertEqual(orbit.clean_web_results(raw),[])
        items = [None, [], {'url':'https://user:pass@example.com'}, {'url':'https://example.com:bad'}, {'url':'https://example.com/?api_key=secret'}]
        items += [{'url':'https://example.com/a#one','title':'t'*1000,'content':'v'*20000}, {'url':'https://example.com/a#two'}]
        items += [{'url':'https://example.com/'+str(i)} for i in range(1000)]
        result=orbit.clean_web_results(items)
        self.assertEqual(len(result),5)
        self.assertEqual(len(result[0]['title']),240)
        self.assertEqual(len(result[0]['content']),8000)
        self.assertEqual(len({x['url'] for x in result}),5)

    def test_search_transport_caps_body_and_checks_redirects(self):
        response=Mock(spec=['read','__enter__','__exit__']);response.__enter__=Mock(return_value=response);response.__exit__=Mock(return_value=False)
        response.read.return_value=b'x'*512001
        opener=Mock();opener.open.return_value=response
        with patch.object(orbit.urllib.request,'build_opener',return_value=opener), self.assertRaisesRegex(ValueError,'too large'):
            orbit._public_search_body('https://www.bing.com/search?q=test')
        response.read.assert_called_once_with(16384)
        self.assertEqual(opener.open.call_args.kwargs['timeout'],6)
        handler=orbit._PublicRedirectHandler()
        original=orbit.urllib.request.Request('https://example.com/old')
        redirected=handler.redirect_request(original,Mock(),302,'redirect',{},'https://example.com/new')
        self.assertEqual(redirected.full_url,'https://example.com/new')
        with self.assertRaises(ValueError):
            handler.redirect_request(Mock(),Mock(),302,'redirect',{},'https://127.0.0.1/private')

    def test_backoff_expires_and_ignores_source_not_found_or_server_errors(self):
        backoff=orbit.WebRelayBackoff()
        with patch.object(orbit.time,'monotonic',return_value=100):
            for status in [404,410,500,503]:
                backoff.failure(status);self.assertFalse(backoff.active())
            backoff.failure(429);self.assertTrue(backoff.active())
        with patch.object(orbit.time,'monotonic',return_value=401):
            self.assertFalse(backoff.active())
            backoff.failure(401);self.assertTrue(backoff.active())
        with patch.object(orbit.time,'monotonic',return_value=462):
            self.assertFalse(backoff.active())


class WebRelayFailureCases(unittest.TestCase):
    setUp = WebEndpointTests.setUp
    setUpClass = classmethod(WebEndpointTests.setUpClass.__func__)
    tearDownClass = classmethod(WebEndpointTests.tearDownClass.__func__)
    post = WebEndpointTests.post
    def test_quota_search_and_page_read_bypass_exhausted_ollama_on_followup(self):
        class Upstream(orbit.http.server.BaseHTTPRequestHandler):
            def do_POST(self):
                self.rfile.read(int(self.headers['Content-Length']))
                self.server.hits+=1;self.send_response(429);self.end_headers()
            def log_message(self,*_): pass
        upstream=orbit.http.server.ThreadingHTTPServer(('127.0.0.1',0),Upstream);upstream.hits=0
        thread=threading.Thread(target=upstream.serve_forever,daemon=True);thread.start()
        expected=[{'url':'https://example.com/a','title':'Source','content':'Facts'}]
        try:
            with patch.object(orbit,'OLLAMA_PORT',upstream.server_port), patch.object(orbit,'bing_web_search',side_effect=OSError('Bing unavailable')), patch.object(orbit,'bing_rss_search',return_value=[]), patch.object(orbit,'duckduckgo_web_search',return_value=expected), patch.object(orbit,'public_web_fetch',return_value={'url':'https://example.com/a','content':'Article'}):
                for _ in range(2):
                    status,result=self.post('/api/web/search',{'query':'topic'})
                    self.assertEqual(status,200);self.assertEqual(result['engine'],'DuckDuckGo')
                status,page=self.post('/api/web/fetch',{'url':'https://example.com/a'})
                self.assertEqual(status,200);self.assertEqual(page['content'],'Article')
            self.assertEqual(upstream.hits,1)
        finally:
            upstream.shutdown();upstream.server_close();thread.join()

    def test_invalid_empty_and_truncated_success_responses_fall_back_and_release_slots(self):
        class Upstream(orbit.http.server.BaseHTTPRequestHandler):
            def do_POST(self):
                self.rfile.read(int(self.headers['Content-Length']))
                self.send_response(200);self.end_headers();self.wfile.write(self.server.body)
            def log_message(self,*_): pass
        upstream=orbit.http.server.ThreadingHTTPServer(('127.0.0.1',0),Upstream)
        thread=threading.Thread(target=upstream.serve_forever,daemon=True);thread.start()
        expected=[{'url':'https://example.com/a','title':'Source','content':'Facts'}]
        try:
            with patch.object(orbit,'OLLAMA_PORT',upstream.server_port), patch.object(orbit,'bing_web_search',return_value=expected):
                for body in [b'[]',b'{',b'null',b'{"results":null}',b'{"results":{}}',b'{"results":[]}',b'{"results":[null,5,{"url":"https://localhost"}]}',b'x'*512001]:
                    upstream.body=body
                    status,result=self.post('/api/web/search',{'query':'topic'})
                    self.assertEqual(status,200);self.assertEqual(result['results'],expected)
        finally:
            upstream.shutdown();upstream.server_close();thread.join()


class PublicSearchBackupCases(unittest.TestCase):
    def test_lite_search_recovers_from_html_challenge(self):
        challenge='<form>Human verification challenge</form>'
        lite='<a class="result-link" href="https://docs.python.org/3/library/math.html">Python math</a><td class="result-snippet">sqrt returns the square root.</td>'
        with patch.object(orbit,'_public_search_body',side_effect=[challenge,lite]) as fetch:
            result=orbit.duckduckgo_web_search('Python math sqrt documentation')
        self.assertEqual(result[0]['content'],'sqrt returns the square root.')
        self.assertIn('html.duckduckgo.com',fetch.call_args_list[0].args[0])
        self.assertIn('lite.duckduckgo.com',fetch.call_args_list[1].args[0])

    def test_site_restrictions_continue_to_backup_instead_of_accepting_irrelevant_results(self):
        wrong=[{'url':'https://docs.example.org.evil.com/a','content':'Unrelated'}]
        right=[{'url':'https://docs.example.org/a','content':'Primary source'}]
        with patch.object(orbit,'bing_web_search',return_value=wrong),patch.object(orbit,'bing_rss_search',return_value=wrong),patch.object(orbit,'duckduckgo_web_search',return_value=right):
            result=orbit.public_web_fallback('search',{'query':'site:docs.example.org public topic'})
        self.assertEqual(result['engine'],'DuckDuckGo')
        self.assertEqual(result['results'],orbit.clean_web_results(right))


class WebDeadlineCases(unittest.TestCase):
    def test_slow_drip_stops_at_wall_deadline_without_growing_forever(self):
        response=Mock(spec=['read1']);response.read1.return_value=b'x'
        with patch.object(orbit.time,'monotonic',side_effect=[1,2,3]),self.assertRaisesRegex(TimeoutError,'timed out'):
            orbit._bounded_web_body(response,3)
        self.assertEqual(response.read1.call_count,2)

    def test_incremental_unicode_bytes_and_exact_cap_survive(self):
        import io
        raw=('Café 🧪 '*100).encode()
        with patch.object(orbit.time,'monotonic',return_value=1):
            self.assertEqual(orbit._bounded_web_body(io.BytesIO(raw),2),raw)
            self.assertEqual(len(orbit._bounded_web_body(io.BytesIO(b'x'*512000),2)),512000)
            with self.assertRaisesRegex(ValueError,'too large'):
                orbit._bounded_web_body(io.BytesIO(b'x'*512001),2)


if __name__ == '__main__':
    unittest.main()
