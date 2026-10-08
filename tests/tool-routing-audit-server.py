"""Local-only routing integration: synthetic model; real Orbit UI and Analyze runtime."""
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
        if self.path.split("?")[0] == "/api/openai/models":
            return self.reply({"data": [{"id": "gpt-6-luna", "name": "GPT-6 Luna", "capabilities": ["thinking", "vision"]}]})
        if self.path.split('?')[0] == '/tests/browser-tool-routing.html':
            page = (helper.ROOT / 'index.html').read_text().replace('<head>', '<head><base href="/"><script src="/tests/whole-app-audit-prelude.js"></script>', 1).replace('</body>', '<script src="/tests/tool-routing-browser-audit.js"></script></body>')
            return self.reply(page.encode(), 'text/html;charset=utf-8')
        return super().do_GET()

    def do_POST(self):
        if self.path not in ('/api/openai/chat', '/api/tool-routing-audit/result', '/api/web/search', '/api/web/fetch'):
            return self.send_error(405)
        length = int(self.headers.get('Content-Length', 0))
        if not 0 < length < 1024 * 1024:
            return self.send_error(413)
        body = json.loads(self.rfile.read(length))
        if self.path == '/api/tool-routing-audit/result':
            out = helper.ROOT / 'tests/output/tool-routing'
            out.mkdir(parents=True, exist_ok=True)
            (out / 'browser.json').write_text(json.dumps(body, indent=2))
            return self.reply({'ok': True})
        if self.path == '/api/web/search':
            return self.reply({'results':[{'url':'https://www.python.org/','title':'Python','content':'Public Python documentation'}]})
        if self.path == '/api/web/fetch':
            return self.reply({'url':'https://www.python.org/','title':'Python','content':'Python supports lists and dictionaries.'})
        messages = body.get('messages', [])
        system = '\n'.join(m.get('content', '') for m in messages if m.get('role') == 'system')
        user = next((m.get('content', '') for m in reversed(messages) if m.get('role') == 'user'), '')
        route = None
        if body.get('max_tokens') == 256:
            text = 'Routing Test'
        elif 'computational verification stage' in system:
            text = json.dumps({'action': 'run', 'complete': True, 'purpose': 'Check multiplication', 'language': 'python', 'code': 'assert 17 * 2 == 34\nprint("Verified: 17 * 2 = 34")'})
        elif 'Decide which tools, if any' in system:
            if '17' in user:
                route={'steps':[['analysis']],'files':False,'inputs':{'analysis':{'action':'run','complete':True,'purpose':'Check multiplication','language':'python','code':'assert 17 * 2 == 34\nprint("Verified: 17 * 2 = 34")'}}}
            elif 'Search' in user:
                route={'steps':[['web']],'files':True,'inputs':{'web':{'action':'search','query':'Python documentation','url':''}}}
            text = '' if route else 'A stack stores items in last-in, first-out order.'
        elif 'Search' in user:
            text = 'Here is the Word document.\n```orbit-widget\n'+json.dumps({'kind':'docx','title':'Python research','blocks':[{'type':'paragraph','text':'Python supports lists and dictionaries.'},{'type':'paragraph','text':'Source: https://www.python.org/'}]})+'\n```'
        else:
            text = '17 × 2 = 34. Verified with Python.'
        self.send_response(200)
        self.send_header('Content-Type', 'text/event-stream')
        self.send_header('X-Orbit-Tool-Routing', '3')
        self.end_headers()
        def emit(packet):
            self.wfile.write(('data: ' + json.dumps(packet) + '\n\n').encode())
            self.wfile.flush()
        try:
            time.sleep(.1)
            if route and body.get('orbit_tools'):
                emit({'orbit_tool_pending': True, 'choices': []})
                emit({'orbit_tool_route': route, 'choices': []})
                text = ''
            for chunk in [text[:6], text[6:]]:
                emit({'choices': [{'delta': {'content': chunk}}]})
                time.sleep(.1)
            time.sleep(.35)
            emit({'choices': [{'delta': {}, 'finish_reason': 'stop'}]})
            self.wfile.write(b'data: [DONE]\n\n')
            self.wfile.flush()
        except (BrokenPipeError, ConnectionResetError):
            pass

if __name__ == '__main__':
    http.server.ThreadingHTTPServer(('127.0.0.1', 8898), Handler).serve_forever()
