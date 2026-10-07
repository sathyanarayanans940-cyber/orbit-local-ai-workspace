"""OpenAI contract tests: synthetic keys and native Responses events, no paid API calls."""
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
import openai_gateway as oa
import server

FAKE_KEY = 'synthetic-test-key-not-a-real-credential'
RAW = {'model': 'gpt-6-luna', 'messages': [{'role': 'user', 'content': 'Hello'}]}
USAGE = {'input_tokens': 100, 'output_tokens': 40, 'total_tokens': 140,
         'input_tokens_details': {'cached_tokens': 80}, 'output_tokens_details': {'reasoning_tokens': 30}}
def event(kind, **data):
    return ('event: '+kind+'\ndata: '+json.dumps({'type':kind, **data}, ensure_ascii=False)+'\n\n').encode()
def final(kind='response.completed', **response):
    return event(kind, response={'usage': USAGE, **response})

class GatewayTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.gateway = oa.OpenAIGateway(self.temp.name)

    def test_key_storage_permissions_replace_remove_and_invalid_inputs(self):
        g = self.gateway
        self.assertEqual(g.key(), '')
        for key in [None, [], 'short', 'x' * 513, 'a' * 20 + '\n']:
            with self.assertRaises(oa.OpenAIError):
                g.save(key)
        g.save(FAKE_KEY)
        self.assertEqual(g.key(), FAKE_KEY)
        self.assertEqual(stat.S_IMODE(g.path.stat().st_mode), 0o600)
        self.assertEqual(oa.OpenAIGateway(self.temp.name).key(), FAKE_KEY)
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
        response.read.return_value = json.dumps({'data': [{'id': i} for i in ['gpt-6-luna', 'gpt-6-luna', 'deepseek-chat', 'gpt-6-astra']]}).encode()
        with patch.object(g, 'connect', return_value=(connection, response)) as connect:
            result = g.models()
            self.assertEqual([m['id'] for m in result], ['gpt-6-luna', 'gpt-6-astra'])
            self.assertEqual(g.models(), result)
            connect.assert_called_once()
            self.assertNotIn(FAKE_KEY, json.dumps(result))
        connection.close.assert_called_once()

    def test_catalog_failures_back_off_and_replacing_key_allows_retry(self):
        g = self.gateway
        g.save(FAKE_KEY)
        with patch.object(g, 'connect', side_effect=oa.OpenAIError(403, 'Denied')) as connect:
            with self.assertRaises(oa.OpenAIError): g.models()
            with self.assertRaises(oa.OpenAIError): g.models()
            self.assertEqual(connect.call_count, 1)
            g.save(FAKE_KEY)
            with self.assertRaises(oa.OpenAIError): g.models()
            self.assertEqual(connect.call_count, 2)

    def test_slow_catalog_does_not_block_credentials_or_publish_a_replaced_key(self):
        g = self.gateway; g.save(FAKE_KEY)
        entered, release = threading.Event(), threading.Event()
        connection, response = Mock(), Mock()
        response.read.return_value = b'{"data":[{"id":"gpt-6-luna"}]}'
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
            raise oa.OpenAIError(401, 'Old key rejected')
        with patch.object(g, 'connect', side_effect=fail_late), ThreadPoolExecutor(2) as workers:
            pending = workers.submit(g.models)
            try:
                self.assertTrue(entered.wait(1))
                workers.submit(g.save, FAKE_KEY + '-replacement').result(timeout=1)
            finally: release.set()
            with self.assertRaises(oa.OpenAIError): pending.result(timeout=1)
        self.assertEqual(g.retry_after, 0)


    def test_native_payload_roles_images_and_json(self):
        raw={**RAW, 'messages':[{'role':'system','content':'Help'}, {'role':'assistant','content':[{'type':'text','text':'Earlier answer'}]}, {'role':'user','content':[{'type':'text','text':'Image question'}, {'type':'image_url','image_url':{'url':'data:image/png;base64,YQ=='}}]}], 'reasoning_effort':'none','response_format':{'type':'json_object'},'api_key':FAKE_KEY,'temperature':1,'tools':[{}],'store':True,'service_tier':'priority'}
        payload=self.gateway.payload(raw)
        self.assertEqual(payload['reasoning'], {'effort':'none'})
        self.assertEqual(payload['max_output_tokens'],65536)
        self.assertEqual(payload['text'],{'format':{'type':'json_object'}})
        self.assertFalse(payload['store']);self.assertEqual(payload['service_tier'],'default')
        self.assertEqual(payload['input'][0]['content'],'Return a valid JSON object.')
        self.assertEqual(payload['input'][2]['content'],'Earlier answer')
        self.assertEqual(payload['input'][-1]['content'][1],{'type':'input_image','image_url':'data:image/png;base64,YQ==','detail':'auto'})
        for key in ('messages','max_tokens','api_key','tools','temperature','response_format','stream_options'):
            self.assertNotIn(key,payload)
        self.assertNotIn(FAKE_KEY,json.dumps(payload))

    def test_each_model_accepts_only_documented_efforts(self):
        for model in oa.SUPPORTED_MODELS:
            for effort in oa.EFFORTS:
                with self.subTest(model=model,effort=effort):
                    if effort=='none' and model in oa.NO_OFF_MODELS:
                        with self.assertRaises(oa.OpenAIError):self.gateway.payload({**RAW,'model':model,'reasoning_effort':effort})
                    else:self.assertEqual(self.gateway.payload({**RAW,'model':model,'reasoning_effort':effort})['reasoning']['effort'],effort)

    def test_invalid_payloads_and_remote_image_urls_fail_closed(self):
        invalid=[None, [], {}, {**RAW,'model':'gpt-6-pro'}, {**RAW,'model':[]}, {**RAW,'messages':[]}, {**RAW,'messages':[{}]}, {**RAW,'messages':[{'role':'tool','content':'x'}]}, {**RAW,'messages':[{'role':'user','content':42}]}, {**RAW,'reasoning_effort':'minimal'}, {**RAW,'reasoning_effort':{}}, {**RAW,'max_tokens':True}, {**RAW,'max_tokens':128001}]
        for raw in invalid:
            with self.subTest(raw=raw),self.assertRaises(oa.OpenAIError):self.gateway.payload(raw)
        for url in ('https://localhost/private','file:///private/key','data:image/svg+xml;base64,YQ==','data:image/png;base64,???'):
            with self.assertRaises(oa.OpenAIError):self.gateway.payload({**RAW,'messages':[{'role':'user','content':[{'type':'image_url','image_url':{'url':url}}]}]})
        for role in ('system','assistant'):
            with self.assertRaises(oa.OpenAIError):self.gateway.payload({**RAW,'messages':[{'role':role,'content':[{'type':'image_url','image_url':{'url':'data:image/png;base64,YQ=='}}]}]})

    def test_fixed_host_auth_and_errors_never_forward_private_provider_messages(self):
        for status,code,match in [(401,'invalid_api_key','rejected'),(429,'insufficient_quota','billing'),(429,'rate_limit_exceeded','rate limit'),(400,'context_length_exceeded','context limit'),(500,None,'server error')]:
            connection=Mock();response=connection.getresponse.return_value;response.status=status
            response.read.return_value=json.dumps({'error':{'code':code,'message':FAKE_KEY}}).encode()
            with patch('openai_gateway.http.client.HTTPSConnection',return_value=connection) as factory:
                with self.assertRaisesRegex(oa.OpenAIError,match) as error:self.gateway.connect('POST','/v1/responses',FAKE_KEY,{'input':'test'})
                factory.assert_called_once_with('api.openai.com',timeout=20)
                self.assertEqual(connection.request.call_args.kwargs['headers']['Authorization'],'Bearer '+FAKE_KEY)
                self.assertNotIn(FAKE_KEY,str(error.exception));self.assertTrue(connection.close.called)

class StreamTests(unittest.TestCase):
    def test_every_byte_boundary_unicode_crlf_multiline_comments_and_no_duplicates(self):
        raw=b': heartbeat\r\n\r\n'+event('response.created',response={})+event('response.output_item.added',item={'type':'reasoning'})+event('response.output_text.delta',delta='Hi 🌍')+event('response.output_text.done',text='Hi 🌍')+final()
        for newline in (b'\n',b'\r\n',b'\r'):
            wire=raw.replace(b'\r\n',b'\n').replace(b'\n',newline)
            for size in (1,2,7,65536):
                parser=oa.ResponsesStream();packets=[]
                for start in range(0,len(wire),size):packets.extend(parser.feed(wire[start:start+size]))
                self.assertTrue(parser.finished,(newline,size))
                self.assertEqual(''.join(p.get('choices',[{}])[0].get('delta',{}).get('content','') for p in packets if p.get('choices')),'Hi 🌍')
                self.assertEqual(sum(p.get('orbit_thinking',False) for p in packets),1)
                usage=next(p['usage'] for p in packets if 'usage' in p)
                self.assertEqual(usage['total_tokens'],140);self.assertEqual(usage['completion_tokens'],40)
                self.assertEqual(usage['completion_tokens_details']['reasoning_tokens'],30)
        parser=oa.ResponsesStream()
        packets=list(parser.feed(b'data: {"type": "response.output_text.delta",\ndata: "delta": "Multiline"}\n\n'))
        self.assertEqual(packets[0]['choices'][0]['delta']['content'],'Multiline')
        self.assertFalse(parser.finished)

    def test_partial_text_survives_later_error_in_same_chunk(self):
        parser=oa.ResponsesStream();packets=[]
        with self.assertRaisesRegex(oa.OpenAIError,'billing'):
            for packet in parser.feed(event('response.output_text.delta',delta='Partial')+event('error',code='insufficient_quota',message=FAKE_KEY)):packets.append(packet)
        self.assertEqual(packets[0]['choices'][0]['delta']['content'],'Partial');self.assertFalse(parser.finished)

    def test_incomplete_keeps_usage_before_length_or_filter(self):
        for cause,reason in [('max_output_tokens','length'),('content_filter','content_filter')]:
            packets=list(oa.ResponsesStream().feed(final('response.incomplete',incomplete_details={'reason':cause})))
            self.assertEqual(packets[0]['usage']['total_tokens'],140)
            self.assertEqual(packets[-1]['choices'][0]['finish_reason'],reason)
        packets=[]
        with self.assertRaises(oa.OpenAIError):
            for packet in oa.ResponsesStream().feed(final('response.failed',error={'code':'rate_limit_exceeded','message':FAKE_KEY})):packets.append(packet)
        self.assertEqual(packets[0]['usage']['total_tokens'],140)

    def test_malformed_events_limits_and_absent_usage(self):
        for wire in [b'data: []\n\n',b'data: oops\n\n',event('response.completed',response=None),event('response.output_text.delta',delta={}),b'x'*(2*1024*1024+1)]:
            with self.assertRaises(oa.OpenAIError):list(oa.ResponsesStream().feed(wire))
        self.assertIsNone(oa.normalized_usage(None));self.assertIsNone(oa.normalized_usage({'total_tokens':True,'input_tokens':-3}))
        packets=list(oa.ResponsesStream().feed(event('response.completed',response={})))
        self.assertNotIn('usage',packets[0])


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
        self.gateway = oa.OpenAIGateway(self.temp.name)
        patcher = patch.object(server, 'OPENAI', self.gateway)
        patcher.start(); self.addCleanup(patcher.stop)

    def request(self, method, endpoint, payload=None, headers=None, include_headers=False):
        c = http.client.HTTPConnection('127.0.0.1', self.http.server_port, timeout=5)
        c.request(method, endpoint, json.dumps(payload) if payload is not None else None,
                  {'X-Orbit-OpenAI': '1', 'Content-Type': 'application/json', **(headers or {})})
        response = c.getresponse()
        result = (response.status, response.read(), dict(response.getheaders())) if include_headers else (response.status, response.read())
        c.close()
        return result



class EndpointTests(EndpointFixture):
    def test_settings_models_and_security(self):
        path='/api/openai/settings'
        for headers in [{'Origin':'https://evil.example'},{'Host':'evil.example'},{'Sec-Fetch-Site':'cross-site'},{'X-Orbit-OpenAI':''}]:
            self.assertEqual(self.request('POST',path,{'key':FAKE_KEY},headers)[0],403)
        self.assertEqual(self.request('POST',path,{'key':FAKE_KEY}),(200,b'{"configured": true}'))
        self.assertEqual(self.request('GET',path),(200,b'{"configured": true}'))
        with patch.object(self.gateway,'models',return_value=[{'id':'gpt-6-luna'}]):
            self.assertEqual(json.loads(self.request('GET','/api/openai/models')[1]),{'data':[{'id':'gpt-6-luna'}]})
        self.assertEqual(self.request('POST','/api/openai/models',{})[0],405)
        for method in ('GET','HEAD'):
            for path in ('/.orbit-openai.json','/%2Eorbit-openai.json'):
                self.assertEqual(self.request(method,path)[0],404)
        self.assertEqual(self.request('POST','/api/openai/settings',{'key':''})[0],200)
        self.assertEqual(self.request('POST','/api/openai/chat',RAW)[0],401)

    def test_native_stream_contract_incremental_delivery_usage_and_release(self):
        self.gateway.save(FAKE_KEY)
        response=Mock();response.getheader.return_value='text/event-stream'
        response.read1.side_effect=[event('response.output_text.delta',delta='Hello'),final(),AssertionError('Waited after completion')]
        connection=Mock();connection.orbit_timing={'connect':4,'headers':12}
        with patch.object(self.gateway,'connect',return_value=(connection,response)) as connect:
            status,body,headers=self.request('POST','/api/openai/chat',RAW,include_headers=True)
            self.assertEqual(status,200);self.assertIn(b'"content": "Hello"',body);self.assertIn(b'"total_tokens": 140',body);self.assertIn(b'[DONE]',body)
            self.assertEqual(connect.call_args.args[:2],('POST','/v1/responses'))
            self.assertNotIn('messages',connect.call_args.args[3])
            self.assertEqual(headers['Cache-Control'],'no-store')
        connection.close.assert_called_once()
        for _ in range(3):self.assertTrue(self.gateway.slots.acquire(blocking=False))
        self.assertFalse(self.gateway.slots.acquire(blocking=False))

    def test_truncated_stream_is_an_error_not_a_completed_answer(self):
        self.gateway.save(FAKE_KEY)
        for chunks in ([event('response.output_text.delta',delta='Partial'),b''],[b': heartbeat\n\n',OSError(FAKE_KEY)]):
            response=Mock();response.getheader.return_value='text/event-stream';response.read1.side_effect=chunks
            with patch.object(self.gateway,'connect',return_value=(Mock(),response)):
                status,body=self.request('POST','/api/openai/chat',RAW)
                self.assertEqual(status,200);self.assertIn(b'"error":',body);self.assertNotIn(b'[DONE]',body);self.assertNotIn(FAKE_KEY.encode(),body)
            for _ in range(3):self.assertTrue(self.gateway.slots.acquire(blocking=False))
            for _ in range(3):self.gateway.slots.release()

    def test_disconnect_closes_upstream_and_releases_slot(self):
        self.gateway.save(FAKE_KEY)
        response=Mock();response.getheader.return_value='text/event-stream';response.read1.return_value=event('response.output_text.delta',delta='Hi')
        connection=Mock();handler=Mock();handler.client_address=('127.0.0.1',1);handler.connection=None
        body=json.dumps(RAW).encode();handler.headers={'Host':'localhost','X-Orbit-OpenAI':'1','Content-Type':'application/json','Content-Length':str(len(body))};handler.rfile=io.BytesIO(body)
        handler.wfile.write.side_effect=BrokenPipeError()
        with patch.object(self.gateway,'connect',return_value=(connection,response)):
            self.gateway.handle(handler,'/api/openai/chat','POST')
        connection.close.assert_called_once()
        for _ in range(3):self.assertTrue(self.gateway.slots.acquire(blocking=False))

if __name__=='__main__':unittest.main()
