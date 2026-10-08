"""Isolated greeting/UI latency regression. Synthetic responses, no credentials."""
import http.server
import importlib.util
import json
import time
from pathlib import Path

spec = importlib.util.spec_from_file_location('usage_audit', Path(__file__).with_name('usage-audit-server.py'))
helper = importlib.util.module_from_spec(spec)
spec.loader.exec_module(helper)


class Handler(helper.Handler):
    def do_GET(self):
        if self.path.split('?')[0] == '/tests/browser-social-latency.html':
            page = (helper.ROOT / 'index.html').read_text().replace('<head>', '<head><base href="/"><script src="/tests/whole-app-audit-prelude.js"></script>', 1).replace('</body>', '<script src="/tests/social-latency-browser-audit.js"></script></body>')
            return self.reply(page.encode(), 'text/html;charset=utf-8')
        return super().do_GET()

    def do_POST(self):
        if self.path not in ('/api/openai/chat', '/api/social-audit/result'):
            return self.send_error(405)
        length = int(self.headers.get('Content-Length', 0))
        if not 0 < length < 1024 * 1024:
            return self.send_error(413)
        body = json.loads(self.rfile.read(length))
        if self.path == '/api/social-audit/result':
            out = helper.ROOT / 'tests/output/openai-latency'
            out.mkdir(parents=True, exist_ok=True)
            (out / 'browser.json').write_text(json.dumps(body, indent=2))
            return self.reply({'ok': True})
        self.send_response(200)
        self.send_header('Content-Type', 'text/event-stream')
        self.end_headers()
        def emit(packet):
            self.wfile.write(('data: ' + json.dumps(packet) + '\n\n').encode())
            self.wfile.flush()
        try:
            text = '{"action":"none"}' if body.get('response_format') else 'Greeting Test' if body.get('max_tokens') == 256 else 'Hello! How can I help?'
            time.sleep(.15)
            emit({'choices': [{'delta': {'content': text}}]})
            time.sleep(.5)  # The UI must paint before this completion event.
            emit({'choices': [{'delta': {}, 'finish_reason': 'stop'}]})
            self.wfile.write(b'data: [DONE]\n\n')
            self.wfile.flush()
        except (BrokenPipeError, ConnectionResetError):
            pass


if __name__ == '__main__':
    http.server.ThreadingHTTPServer(('127.0.0.1', 8897), Handler).serve_forever()
