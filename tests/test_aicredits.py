"""No real credentials or inference calls: AICredits restriction/transport contract."""
import http.client
import json
from pathlib import Path
import stat
import tempfile
import unittest
from unittest.mock import Mock, patch
import aicredits
import server
from tests.test_deepseek import EndpointTests as DeepSeekEndpoints

KEY = 'sk-live-synthetic-not-a-real-credential'
MODEL = 'deepseek/deepseek-v4.1-flash'

class GatewayTests(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory(); self.addCleanup(directory.cleanup)
        self.gateway = aicredits.AICreditsGateway(directory.name)

    def test_exact_model_restriction_and_no_routing_overrides(self):
        raw = {'model':MODEL, 'messages':[{'role':'user','content':'Hello'}],
               'models':['openai/gpt-4o'], 'fallbacks':['deepseek/deepseek-v4-pro'],
               'provider':{'order':['openai']}, 'base_url':'https://evil.example',
               'tools':[], 'thinking':{'type':'enabled'}, 'reasoning_effort':'max',
               'no_cache':False, 'api_key':KEY}
        clean = self.gateway.payload(raw)
        self.assertEqual(set(clean), {'model','messages','stream','stream_options','no_cache','reasoning_effort'})
        self.assertEqual(clean['model'], MODEL); self.assertTrue(clean['no_cache'])
        for model in [None, [], '', 'deepseek-flash', 'deepseek/deepseek-v4-pro',
                      'deepseek/deepseek-v4-flash', 'deepseek/deepseek-v3.2',
                      'openai/gpt-4o', 'anthropic/claude-opus-4', MODEL+' ', MODEL.upper(),
                      MODEL+'\n', MODEL+':free']:
            with self.subTest(model=model), self.assertRaises(aicredits.AICreditsError):
                self.gateway.payload({**raw,'model':model})

    def test_separate_key_permissions_replace_clear_and_validation(self):
        g=self.gateway
        for key in ['', KEY, 'sk-'+'a'*64, KEY+'-replacement', '']:
            g.save(key); self.assertEqual(g.key(),key)
            self.assertEqual(stat.S_IMODE(g.path.stat().st_mode),0o600)
            self.assertEqual(g.path.name,'.orbit-aicredits.json')
        for invalid in [None,[], 'akm-'+'a'*64,'short','sk-live-abc\n','a'*600]:
            with self.assertRaises(aicredits.AICreditsError):g.save(invalid)

    def test_discovery_authenticates_without_paid_call_and_filters_catalog(self):
        g=self.gateway
        with patch.object(g,'connect') as connect:
            self.assertEqual(g.models(),[]);connect.assert_not_called()
        g.save(KEY)
        credits=Mock();credits.read.return_value=b'{"data":{"credits_inr":220}}'
        catalog=Mock();catalog.read.return_value=json.dumps({'data':[
            {'id':'openai/gpt-4o'},{'id':'deepseek/deepseek-v4-pro'},
            {'id':MODEL,'input_modalities':['text','image']},{'id':MODEL},None,{'id':[]}]}).encode()
        with patch.object(g,'connect',side_effect=[(Mock(),credits),(Mock(),catalog)]) as connect:
            result=g.models();self.assertEqual([m['id'] for m in result],[MODEL])
            self.assertIn('vision',result[0]['capabilities']);self.assertEqual(g.models(),result)
            self.assertEqual(connect.call_count,2)
            self.assertEqual(connect.call_args_list[0].args,('GET','/v1/credits',KEY))
            self.assertEqual(connect.call_args_list[1].args,('GET','/api/models',''))
            self.assertNotIn(KEY,json.dumps(result))

    def test_auth_failure_prevents_public_catalog_from_claiming_connection(self):
        g=self.gateway;g.save(KEY)
        with patch.object(g,'connect',side_effect=aicredits.AICreditsError(401,'Rejected')) as connect:
            for _ in range(2):
                with self.assertRaises(aicredits.AICreditsError):g.models()
            connect.assert_called_once()
            g.save(KEY)
            with self.assertRaises(aicredits.AICreditsError):g.models()
            self.assertEqual(connect.call_count,2)

    def test_missing_credit_endpoint_allows_catalog_without_claiming_key_verified(self):
        g=self.gateway;g.save(KEY)
        catalog=Mock();catalog.read.return_value=json.dumps({'data':[{'id':MODEL}]}).encode()
        with patch.object(g,'connect',side_effect=[aicredits.AICreditsError(404,'Not found'),(Mock(),catalog)]) as connect:
            self.assertEqual([m['id'] for m in g.models()],[MODEL])
            self.assertFalse(g.key_verified)
            self.assertEqual(connect.call_count,2)
        g.save(KEY)
        self.assertFalse(g.key_verified)

    def test_thinking_effort_is_validated_without_model_changes(self):
        raw={'model':MODEL,'messages':[{'role':'user','content':'Hello'}]}
        for effort in ['none','low','high','max']:
            payload=self.gateway.payload({**raw,'reasoning_effort':effort})
            self.assertEqual(payload['reasoning_effort'],effort)
            self.assertEqual(payload['model'],MODEL)
        for effort in [None,{},True,'medium','ultra','MAX']:
            with self.assertRaises(aicredits.AICreditsError):
                self.gateway.payload({**raw,'reasoning_effort':effort})

    def test_missing_flash_never_substitutes_pro(self):
        g=self.gateway;g.save(KEY)
        credits=Mock();credits.read.return_value=b'{}'
        catalog=Mock();catalog.read.return_value=b'{"data":[{"id":"deepseek/deepseek-v4-pro"}]}'
        with patch.object(g,'connect',side_effect=[(Mock(),credits),(Mock(),catalog)]):
            self.assertEqual(g.models(),[])

    def test_multiple_images_and_json_are_preserved(self):
        image={'type':'image_url','image_url':{'url':'data:image/png;base64,AAAA'}}
        raw={'model':MODEL,'messages':[{'role':'user','content':[{'type':'text','text':'Compare'},image,image]}],
             'response_format':{'type':'json_object'},'max_tokens':16384}
        payload=self.gateway.payload(raw)
        self.assertEqual(payload['messages'][-1]['content'],raw['messages'][0]['content'])
        self.assertEqual(payload['response_format'],{'type':'json_object'})
        self.assertIn('JSON',payload['messages'][0]['content'])
        for limit in [0,-1,True,393217]:
            with self.assertRaises(aicredits.AICreditsError):self.gateway.payload({**raw,'max_tokens':limit})

    def test_fixed_upstream_and_no_authorization_on_public_catalog(self):
        connection=Mock();connection.getresponse.return_value.status=200
        with patch('aicredits.http.client.HTTPSConnection',return_value=connection) as factory:
            self.gateway.connect('GET','/api/models','')
            factory.assert_called_with('api.aicredits.in',timeout=20)
            self.assertNotIn('Authorization',connection.request.call_args.kwargs['headers'])
            self.gateway.connect('GET','/v1/credits',KEY)
            self.assertEqual(connection.request.call_args.kwargs['headers']['Authorization'],'Bearer '+KEY)

# Reuse proven local HTTP boundary cases with this provider's separate endpoints.
class EndpointTests(DeepSeekEndpoints):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup)
        self.gateway=aicredits.AICreditsGateway(self.temp.name)
        patcher=patch.object(server,'AICREDITS',self.gateway);patcher.start();self.addCleanup(patcher.stop)
        # Parent cases use a synthetic non-prefixed key; normalize only that fixture.
        original_save=self.gateway.save
        self.gateway.save=lambda key: original_save(KEY if key and not key.startswith('sk-') else key)

    def request(self,method,endpoint,payload=None,headers=None):
        endpoint=endpoint.replace('deepseek','aicredits')
        headers={k.replace('DeepSeek','AICredits'):v for k,v in (headers or {}).items()}
        if isinstance(payload,dict):
            payload=dict(payload)
            if payload.get('model')=='deepseek-flash':payload['model']=MODEL
        c=http.client.HTTPConnection('127.0.0.1',self.http.server_port,timeout=5)
        c.request(method,endpoint,json.dumps(payload) if payload is not None else None,
                  {'X-Orbit-AICredits':'1','Content-Type':'application/json',**headers})
        response=c.getresponse();result=response.status,response.read();c.close();return result

    def test_unauthorized_models_rejected_before_any_upstream_call(self):
        self.gateway.save(KEY)
        for model in ['openai/gpt-4o','deepseek/deepseek-v4-pro','deepseek/deepseek-v3.2']:
            with patch.object(self.gateway,'connect') as connect:
                code,body=self.request('POST','/api/aicredits/chat',{'model':model,'messages':[{'role':'user','content':'Hello'}]})
                self.assertEqual(code,400);self.assertIn(b'restricted',body);connect.assert_not_called()

    def test_completed_stream_releases_slot_without_waiting_for_eof(self):
        self.gateway.save(KEY)
        for tail in [b'data: [DONE]\n\n', b'data: {"choices":[],"usage":{"total_tokens":12}}\n\n']:
            final = b'data: {"choices":[{"delta":{"content":"Complete"},"finish_reason":"stop"}]}\n\n'
            response = Mock(); response.getheader.return_value = 'text/event-stream'
            response.read1.side_effect = [final, tail[:9], tail[9:], AssertionError('Waited for socket EOF')]
            connection = Mock()
            with patch.object(self.gateway, 'connect', return_value=(connection,response)):
                self.assertEqual(self.request('POST','/api/aicredits/chat',{'model':MODEL,'messages':[{'role':'user','content':'Test'}]}), (200,final+tail))
            self.assertEqual(response.read1.call_count,3);connection.close.assert_called_once()
        for _ in range(3): self.assertTrue(self.gateway.slots.acquire(blocking=False))
        self.assertFalse(self.gateway.slots.acquire(blocking=False))

    def test_usage_timeout_after_finish_does_not_invent_usage_or_completion(self):
        self.gateway.save(KEY)
        final = b'data: {"choices":[{"delta":{"content":"Complete"},"finish_reason":"stop"}]}\n\n'
        response = Mock(); response.getheader.return_value = 'text/event-stream'
        response.read1.side_effect = [final, TimeoutError()]
        connection = Mock()
        with patch.object(self.gateway,'connect',return_value=(connection,response)):
            self.assertEqual(self.request('POST','/api/aicredits/chat',{'model':MODEL,'messages':[{'role':'user','content':'Test'}]}), (200,final))
        connection.sock.settimeout.assert_called_with(3)

# Do not run the imported base class a second time in unittest discovery.
del DeepSeekEndpoints
if __name__=='__main__':unittest.main()
