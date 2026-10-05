"""Isolated UI fixture: public app assets, synthetic chat, no model relay."""
import http.server
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def log_message(self, *args):
        pass

    def reply(self, value, content_type):
        self.send_response(200)
        self.send_header('Content-Type', content_type)
        self.send_header('Content-Length', str(len(value)))
        self.send_header('Cache-Control', 'no-store')
        self.end_headers()
        self.wfile.write(value)

    def do_GET(self):
        path = self.path.split('?', 1)[0]
        if path in {'/tests/browser-step-layout.html', '/tests/browser-print-chat.html', '/tests/browser-provider-contracts.html'}:
            page = (ROOT / 'index.html').read_text().replace('<head>', '<head><base href="/">', 1)
            script = 'provider-contracts-browser.js' if path.endswith('browser-provider-contracts.html') else 'print-chat-browser.js' if path.endswith('browser-print-chat.html') else 'step-layout-browser.js'
            page = page.replace('</body>', f'<script src="/tests/{script}"></script></body>')
            self.reply(page.encode(), 'text/html; charset=utf-8')
        elif path.startswith('/api/'):
            self.reply(json.dumps({'configured': False, 'models': [], 'data': []}).encode(), 'application/json')
        else:
            target = (ROOT / path.lstrip('/')).resolve()
            allowed = {'.js', '.html', '.css', '.svg', '.woff', '.woff2', '.ttf', '.png', '.webmanifest'}
            if not target.is_relative_to(ROOT) or target.suffix not in allowed or any(p.startswith('.') for p in Path(path).parts):
                self.send_error(403)
            else:
                super().do_GET()

    def do_POST(self):
        self.send_error(405, 'This preview never calls a model')

http.server.ThreadingHTTPServer(('127.0.0.1', 8892), Handler).serve_forever()
