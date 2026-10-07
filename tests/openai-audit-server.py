"""Disposable browser audit: native Responses events, synthetic key, no API calls."""
import http.server
import io
import json
from pathlib import Path
import sys
import tempfile
from unittest.mock import Mock
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import server
from openai_gateway import OpenAIGateway, SUPPORTED_MODELS

class Response(io.BytesIO):
    def getheader(self, name, default=''):
        return 'text/event-stream' if name == 'Content-Type' else default

def upstream(method,path,key,payload=None,timeout=20):
    if path=='/v1/models':
        return Mock(),Response(json.dumps({'data':[{'id':id} for id in SUPPORTED_MODELS]}).encode())
    assert path=='/v1/responses' and payload['store'] is False
    text='This is a synthetic OpenAI integration test. Streaming, thinking controls and usage reporting are connected.'
    if payload.get('text'):text='{"action":"none","checks":[]}'
    if payload['max_output_tokens']<=4096:text='OpenAI Connection Test'
    def event(kind,**extra):return 'data: '+json.dumps({'type':kind,**extra})+'\n\n'
    events=[]
    if payload['reasoning']['effort']!='none':events.append(event('response.output_item.added',item={'type':'reasoning'}))
    events.extend([event('response.output_text.delta',delta=text[:25]),event('response.output_text.delta',delta=text[25:]),event('response.completed',response={'status':'completed','usage':{'input_tokens':100,'output_tokens':40,'total_tokens':140,'output_tokens_details':{'reasoning_tokens':0 if payload['reasoning']['effort']=='none' else 30},'input_tokens_details':{'cached_tokens':80}}})])
    return Mock(),Response(''.join(events).encode())

with tempfile.TemporaryDirectory(prefix='orbit-openai-audit-') as root:
    server.OPENAI=OpenAIGateway(root);server.OPENAI.connect=upstream
    for name,module,cls in [('DEEPSEEK','deepseek','DeepSeekGateway'),('AICREDITS','aicredits','AICreditsGateway'),('GEMINI','gemini','GeminiGateway')]:
        setattr(server,name,getattr(__import__(module),cls)(root))
    class Handler(server.OrbitHandler):
        def do_GET(self):
            if self.path.startswith(('/ollama','/lmstudio','/api/ollama','/api/tags','/api/show')):
                self.web_json(200,{'models':[],'data':[]});return
            super().do_GET()
    http.server.ThreadingHTTPServer(('127.0.0.1',8893),Handler).serve_forever()
