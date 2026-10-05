"""Disposable local UI audit. Synthetic key and upstream; never contacts AICredits."""
import http.server
import io
import json
from pathlib import Path
import sys
import tempfile
from unittest.mock import Mock
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import server
from aicredits import AICreditsGateway

class Response(io.BytesIO):
    def getheader(self, name, default=''):
        return 'text/event-stream' if name == 'Content-Type' else default

def upstream(method, path, key, payload=None, timeout=20):
    if path == '/v1/credits':
        return Mock(), Response(b'{"data":{"credits_inr":220}}')
    if path == '/api/models':
        return Mock(), Response(json.dumps({'data': [
            {'id':'deepseek/deepseek-v4.1-flash','input_modalities':['text','image']},
            {'id':'deepseek/deepseek-v4-pro'}, {'id':'openai/gpt-4o'}]}).encode())
    assert payload['model'] == 'deepseek/deepseek-v4.1-flash'
    text = '# AICredits connection test\n\nThis is a synthetic audit response, not a live AICredits answer.\n\n## Streaming works\n\nText and reasoning use separate channels.'
    if payload.get('response_format'):
        text = '{"action":"none"}'
    events = [': keep-alive\n\n', 'data: '+json.dumps({'choices':[{'delta':{'reasoning_content':'Synthetic reasoning'}}]})+'\n\n']
    for chunk in [text[:30],text[30:]]:
        events.append('data: '+json.dumps({'choices':[{'delta':{'content':chunk}}]})+'\n\n')
    events.append('data: '+json.dumps({'choices':[{'delta':{},'finish_reason':'stop'}]})+'\n\ndata: [DONE]\n\n')
    return Mock(), Response(''.join(events).encode())

with tempfile.TemporaryDirectory(prefix='orbit-aicredits-audit-') as root:
    server.AICREDITS = AICreditsGateway(root)
    server.AICREDITS.connect = upstream
    if '--seed' in sys.argv:
        server.AICREDITS.save('sk-live-synthetic-not-a-real-credential')
    # Avoid contacting another configured provider or user's Ollama for this audit.
    server.DEEPSEEK = __import__('deepseek').DeepSeekGateway(root)
    server.GEMINI = __import__('gemini').GeminiGateway(root)
    class Handler(server.OrbitHandler):
        def do_GET(self):
            if self.path.startswith(('/api/ollama/', '/ollama/', '/api/tags', '/api/show')):
                self.web_json(200, {'models': []}); return
            super().do_GET()
    http.server.ThreadingHTTPServer(('127.0.0.1',8889 if '--seed' in sys.argv else 8888), Handler).serve_forever()
