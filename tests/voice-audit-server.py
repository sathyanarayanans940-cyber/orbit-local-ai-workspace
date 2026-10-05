"""Isolated voice UI audit: fake microphone, fake inference, no personal data."""
import http.server
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'tests/output/voice'


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def log_message(self, *args):
        pass

    def reply(self, value, kind='application/json'):
        data = value if isinstance(value, bytes) else json.dumps(value).encode()
        self.send_response(200)
        self.send_header('Content-Type', kind)
        self.send_header('Content-Length', str(len(data)))
        self.send_header('Cache-Control', 'no-store')
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        path = self.path.split('?', 1)[0]
        if path == '/tests/browser-voice.html':
            page = (ROOT / 'index.html').read_text().replace('<head>', '<head><base href="/"><script src="/tests/whole-app-audit-prelude.js"></script><script src="/tests/voice-audit-prelude.js"></script>', 1).replace('</body>', '<script src="/tests/voice-browser-audit.js"></script></body>')
            return self.reply(page.encode(), 'text/html;charset=utf-8')
        if path.startswith('/api/'):
            return self.reply({'configured': False, 'models': [], 'data': []})
        target = (ROOT / path.lstrip('/')).resolve()
        if not target.is_relative_to(ROOT) or target.suffix not in {'.js', '.html', '.css', '.svg', '.woff', '.woff2', '.ttf', '.png', '.webmanifest', '.json', '.wasm', '.zip', '.whl'} or any(p.startswith('.') for p in Path(path).parts):
            return self.send_error(404)
        super().do_GET()

    def do_POST(self):
        path = self.path.split('?', 1)[0]
        size = int(self.headers.get('Content-Length', 0))
        if size > 1024 * 1024:
            return self.send_error(413)
        body = self.rfile.read(size)
        if path == '/api/voice-audit/result':
            OUT.mkdir(parents=True, exist_ok=True)
            (OUT / 'browser-results.json').write_text(json.dumps(json.loads(body), indent=2))
            return self.reply({'ok': True})
        if path == '/api/ollama/chat':
            return self.reply((json.dumps({'message': {'content': 'Synthetic local voice integration reply.'}, 'done': True}) + '\n').encode(), 'application/x-ndjson')
        return self.send_error(405)


if __name__ == '__main__':
    http.server.ThreadingHTTPServer(('127.0.0.1', 8893), Handler).serve_forever()
