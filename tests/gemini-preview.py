"""Isolated manual UI fixture. Never contacts Google or reads a real key."""
import io
import json
from pathlib import Path
import sys
import tempfile
from unittest.mock import Mock
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import server
from gemini import GeminiGateway, GeminiError

class PreviewGemini(GeminiGateway):
    def connect(self, method, path, key, payload=None, timeout=20):
        if key != 'synthetic-test-key-not-a-real-credential':
            raise GeminiError(401, 'The test key was rejected. Replace it in Settings → Models.')
        connection = Mock()
        if method == 'GET':
            response = io.BytesIO(json.dumps({'data': [{'id': name} for name in ['gemini-3.8-flash', 'gemini-2.5-flash', 'gemini-pro']]}).encode())
        else:
            text = '{"action":"none"}' if payload.get('response_format') else 'Gemini preview stream works. **Formatting** and \\(x^2 + y^2\\) work too.'
            response = io.BytesIO(b''.join(('data: ' + json.dumps({'choices': [{'delta': {'content': chunk}}]}) + '\n\n').encode() for chunk in [text[:25], text[25:]]) + b'data: [DONE]\n\n')
            response.getheader = lambda *_: 'text/event-stream'
        return connection, response

class PreviewHandler(server.OrbitHandler):
    def do_GET(self):
        if self.path == '/api/ollama/tags':
            self.web_json(200, {'models': []}); return
        super().do_GET()
    def log_message(self, *_): pass

with tempfile.TemporaryDirectory(prefix='orbit-gemini-preview-') as temp:
    server.GEMINI = PreviewGemini(temp)
    http = server.IPv4ThreadingHTTPServer(('127.0.0.1', 8799), PreviewHandler)
    print('Gemini UI preview: http://localhost:8799 (synthetic upstream)', flush=True)
    try: http.serve_forever()
    finally: http.server_close()
