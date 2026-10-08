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


class RoutingTests(unittest.TestCase):
    caps = {'memory': True, 'web': True, 'analysis': True, 'files': True}
    def test_fixed_function_registration_auto_and_strict(self):
        with tempfile.TemporaryDirectory() as root:
            payload = oa.OpenAIGateway(root).payload({**RAW, 'orbit_tools': self.caps, 'tools':[{'type':'web_search'}]})
        self.assertEqual(payload['tool_choice'], 'auto')
        self.assertFalse(payload['parallel_tool_calls'])
        self.assertEqual(len(payload['tools']),1)
        tool=payload['tools'][0]
        self.assertEqual(tool['name'],'orbit_tools');self.assertTrue(tool['strict'])
        self.assertFalse(tool['parameters']['additionalProperties'])
        self.assertEqual(tool['parameters']['required'],['steps','inputs'])
        self.assertFalse(payload['store'])
        for bad in [None,[],{}, {**self.caps,'web':1},{**self.caps,'shell':True}]:
            with self.assertRaises(oa.OpenAIError):oa.routing_capabilities(bad)
        with tempfile.TemporaryDirectory() as root:
            g=oa.OpenAIGateway(root)
            self.assertNotIn('tools',g.payload({**RAW,'orbit_tools':dict.fromkeys(self.caps,False)}))
            with self.assertRaises(oa.OpenAIError):g.payload({**RAW,'orbit_tools':self.caps,'response_format':{'type':'json_object'}})

    def test_routes_validate_disabled_duplicates_unknown_empty_and_size(self):
        route={'steps':[['web','memory'],['analysis']],'files':True}
        self.assertEqual(oa.validate_route(json.dumps({'steps':route['steps']+[['files']]}),self.caps),route)
        for value in [None,[],{}, {'steps':[]},{'steps':[[]]},{'steps':[['web','web']]},{'steps':[['shell']]},{'steps':[['files'],['web']]},{'steps':[['web','files']]},{'steps':[['files'],['files']]},{'steps':[['analysis']],'files':1},{**route,'extra':1}]:
            with self.assertRaises(oa.OpenAIError):oa.validate_route(json.dumps(value),self.caps)
        with self.assertRaises(oa.OpenAIError):oa.validate_route(' '*65537,self.caps)
        with self.assertRaises(oa.OpenAIError):oa.validate_route(json.dumps({'steps':[['web']]}),{**self.caps,'web':False})

    def test_nonempty_schema_and_only_available_tools_for_every_capability_set(self):
        from itertools import product
        for flags in product((False, True), repeat=4):
            caps=dict(zip(self.caps,flags))
            if not any(flags):
                continue
            steps=oa.route_function(caps)['parameters']['properties']['steps']
            self.assertEqual(steps['minItems'],1)
            self.assertEqual(steps['items']['minItems'],1)
            self.assertEqual(set(steps['items']['items']['enum']),{k for k,v in caps.items() if v})
            for key,enabled in caps.items():
                args=json.dumps({'steps':[[key]]})
                if enabled:
                    self.assertEqual(oa.validate_route(args,caps),{'steps':[] if key=='files' else [[key]],'files':key=='files'})
                else:
                    with self.assertRaises(oa.OpenAIError):oa.validate_route(args,caps)
        with self.assertRaises(oa.OpenAIError):oa.validate_route('{"steps":[],"files":false}',self.caps)

    def test_direct_tool_inputs_survive_gateway_without_execution_and_reject_unselected(self):
        inputs={'analysis':{'action':'run','code':'print("hi")\n# '+ 'x'*8000,'complete':True},'web':None,'memory':None}
        result=oa.validate_route(json.dumps({'steps':[['analysis'],['files']],'inputs':inputs}),self.caps)
        self.assertEqual(result,{'steps':[['analysis']],'files':True,'inputs':{'analysis':inputs['analysis']}})
        for bad in [[],{'shell':{}},{'web':{}},{'analysis':'code'}]:
            with self.assertRaises(oa.OpenAIError):oa.validate_route(json.dumps({'steps':[['analysis']],'inputs':bad}),self.caps)
        wire=self.tool_events(json.dumps({'steps':[['analysis']],'inputs':inputs}))
        packets=[];parser=oa.ResponsesStream(self.caps)
        for at in range(0,len(wire),11):packets.extend(parser.feed(wire[at:at+11]))
        self.assertEqual(next(p['orbit_tool_route'] for p in packets if 'orbit_tool_route' in p)['inputs']['analysis'],inputs['analysis'])
        self.assertFalse(any(p.get('choices') and p['choices'][0].get('delta',{}).get('content') for p in packets))
        schema=oa.route_function(self.caps)['parameters']['properties']['inputs']
        self.assertEqual(schema['required'],['web','analysis','memory'])
        for branch in schema['properties'].values():
            self.assertFalse(branch['anyOf'][0]['additionalProperties'])
            self.assertIn({'type':'null'},branch['anyOf'])

    def tool_events(self, arguments, terminal='response.completed'):
        item={'type':'function_call','name':'orbit_tools','id':'fc_test','call_id':'call_test','arguments':arguments,'status':'completed'}
        return event('response.output_item.added',item={**item,'arguments':'','status':'in_progress'})+event('response.function_call_arguments.delta',delta=arguments)+event('response.function_call_arguments.done',arguments=arguments)+event('response.output_item.done',item=item)+final(terminal,output=[item],incomplete_details={'reason':'max_output_tokens'})

    def test_stream_single_route_only_after_completion_across_every_byte(self):
        route={'steps':[['web'],['analysis']],'files':False}
        wire=self.tool_events(json.dumps({'steps':route['steps']}))
        for size in [1,2,11,65536]:
            parser=oa.ResponsesStream(self.caps);packets=[]
            for at in range(0,len(wire),size):packets.extend(parser.feed(wire[at:at+size]))
            self.assertEqual([p['orbit_tool_route'] for p in packets if 'orbit_tool_route' in p],[route])
            self.assertEqual(sum(p.get('orbit_tool_pending',False) for p in packets),1)
            self.assertTrue(parser.finished)
            self.assertEqual(packets[-1]['choices'][0]['finish_reason'],'stop')
            self.assertEqual(next(p['usage'] for p in packets if 'usage' in p)['total_tokens'],140)
            self.assertNotIn('content',json.dumps(packets))

    def test_incomplete_unregistered_unknown_multiple_and_oversized_calls_fail_closed(self):
        args=json.dumps({'steps':[['web']]})
        item={'type':'function_call','name':'orbit_tools','arguments':args,'status':'completed'}
        wires=[self.tool_events(args,'response.incomplete'),self.tool_events('{'),event('response.output_item.added',item={**item,'name':'shell'}),event('response.output_item.added',item=item)*2,final(output=[item,item]),final(output=[{**item,'status':'in_progress'}]),event('response.output_item.added',item=item)+event('response.function_call_arguments.delta',delta='x'*65537)]
        for wire in wires:
            packets=[]
            with self.assertRaises(oa.OpenAIError):
                for packet in oa.ResponsesStream(self.caps).feed(wire):packets.append(packet)
            self.assertFalse(any('orbit_tool_route' in p for p in packets))
        with self.assertRaises(oa.OpenAIError):list(oa.ResponsesStream().feed(self.tool_events(args)))


class RoutingEndpointTests(EndpointFixture):
    def test_native_tool_gateway_dispatch_is_separate_from_answer_and_preserves_usage(self):
        self.gateway.save(FAKE_KEY)
        route={'steps':[['web']], 'files':False}
        item={'type':'function_call','name':'orbit_tools','arguments':json.dumps({'steps':route['steps']}),'status':'completed'}
        upstream=Mock();upstream.getheader.return_value='text/event-stream'
        upstream.read1.side_effect=[event('response.output_item.added',item={**item,'arguments':'','status':'in_progress'}),final(output=[item])]
        connection=Mock()
        with patch.object(self.gateway,'connect',return_value=(connection,upstream)) as connect:
            status,body,headers=self.request('POST','/api/openai/chat',{**RAW,'orbit_tools':RoutingTests.caps},include_headers=True)
        self.assertEqual(status,200);self.assertEqual(headers['X-Orbit-Tool-Routing'],'3')
        self.assertIn(b'"orbit_tool_route":',body);self.assertIn(b'"total_tokens": 140',body);self.assertIn(b'[DONE]',body)
        self.assertNotIn(b'"content":',body);self.assertNotIn(FAKE_KEY.encode(),body)
        self.assertEqual(connect.call_args.args[3]['tools'][0]['name'],'orbit_tools')
        self.assertEqual(connect.call_args.args[3]['tool_choice'],'auto')
        connection.close.assert_called_once()

if __name__=='__main__':unittest.main()
