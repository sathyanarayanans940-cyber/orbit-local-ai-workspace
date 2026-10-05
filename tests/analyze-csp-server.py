"""Local browser harness: production cloud CSP + local Orbit transport, no real login secrets."""
import http.server
import re
import sys
from pathlib import Path
ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
from cloud.app import create_app
from server import OrbitHandler
app = create_app(dict(TESTING=True, SECRET_KEY='isolated-local-csp-test-' * 3,
    ORBIT_PASSWORD='local-test-only', OLLAMA_API_KEY='not-used',
    PUBLIC_ORIGIN='https://127.0.0.1:8879', PUBLIC_DIR=str(ROOT)))
client = app.test_client()
base = 'https://127.0.0.1:8879'
page = client.get('/login', base_url=base)
csrf = re.search(r'name="csrf" value="([^"]+)"', page.text)[1]
client.post('/login', base_url=base, headers={'Origin': base}, data={'csrf':csrf,'password':'local-test-only'})
policies = {path:client.get(path, base_url=base).headers for path in ['/', '/analyze-sandbox.html']}
class Handler(OrbitHandler):
    def end_headers(self):
        headers = policies['/analyze-sandbox.html' if self.path.split('?')[0]=='/analyze-sandbox.html' else '/']
        for key in ['Content-Security-Policy', 'X-Frame-Options']:
            if key in headers: self.send_header(key, headers[key])
        super().end_headers()
http.server.ThreadingHTTPServer(('127.0.0.1', 8879), Handler).serve_forever()
