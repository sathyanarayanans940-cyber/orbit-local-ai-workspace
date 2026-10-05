"""Full production UI with isolated, deterministic model endpoints. No credentials."""
import http.server
import json
from pathlib import Path
import time
ROOT=Path(__file__).resolve().parent.parent
requests=[]
class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self,*args,**kwargs):super().__init__(*args,directory=str(ROOT),**kwargs)
    def log_message(self,*args):pass
    def reply(self,value,kind='application/json'):
        if not isinstance(value,bytes):value=json.dumps(value).encode()
        self.send_response(200);self.send_header('Content-Type',kind);self.send_header('Content-Length',str(len(value)));self.send_header('Cache-Control','no-store');self.end_headers();self.wfile.write(value)
    def do_GET(self):
        path=self.path.split('?',1)[0]
        if path=='/tests/browser-whole-app.html':
            page=(ROOT/'index.html').read_text().replace('<head>','<head><base href="/"><script src="/tests/whole-app-audit-prelude.js"></script>',1).replace('</body>','<script src="/tests/whole-app-browser-audit.js"></script></body>')
            return self.reply(page.encode(),'text/html;charset=utf-8')
        if path=='/api/deepseek/models':return self.reply({'data':[{'id':'deepseek-flash','name':'DeepSeek synthetic audit','remote':True,'capabilities':['thinking','vision']}]})
        if path=='/api/audit/requests':return self.reply(requests)
        if path.startswith('/api/'):return self.reply({'configured':False,'models':[],'data':[]})
        allowed={'.js','.html','.css','.svg','.woff','.woff2','.ttf','.png','.webmanifest','.json','.wasm','.zip','.whl'}
        target=(ROOT/path.lstrip('/')).resolve()
        if not target.is_relative_to(ROOT) or target.suffix not in allowed or any(p.startswith('.') for p in Path(path).parts):return self.send_error(404)
        super().do_GET()
    def do_POST(self):
        body=json.loads(self.rfile.read(int(self.headers.get('Content-Length',0))))
        path=self.path.split('?',1)[0]
        if path=='/api/audit/result':
            out=ROOT/'tests/output/whole-app';out.mkdir(parents=True,exist_ok=True);(out/'browser-results.json').write_text(json.dumps(body,indent=2));return self.reply({'ok':True})
        if path!='/api/deepseek/chat':return self.send_error(405)
        requests.append({'model':body.get('model'),'thinking':body.get('thinking'),'max_tokens':body.get('max_tokens'),'json':bool(body.get('response_format'))})
        prompt=next((m['content'] for m in reversed(body['messages']) if m['role']=='user'),'')
        if body.get('max_tokens')==256:text='Tiny Algebra Walkthrough'
        elif body.get('response_format'):text='{"action":"none"}'
        else:text='# Tiny Algebra Walkthrough\n\n## 1. Given\n\nSolve \\(2x+4=10\\).\n\n## 2. Work\n\n\\[2x=10-4=6\\]\n\n\\[x=6/2=3\\]\n\n## 3. Check\n\n\\(2(3)+4=10\\).\n\n```python\nprint(2 * 3 + 4)\n```'
        if 'slow stream' in prompt and not body.get('response_format') and body.get('max_tokens')!=256:text+='\n\n'+'A short paragraph to test scrolling while generation continues.\n\n'*100
        self.send_response(200);self.send_header('Content-Type','text/event-stream');self.send_header('Cache-Control','no-store');self.end_headers()
        try:
            for start in range(0,len(text),35):
                event='data: '+json.dumps({'choices':[{'delta':{'content':text[start:start+35]},'finish_reason':None}]})+'\r\r';self.wfile.write(event.encode());self.wfile.flush()
                if len(text)>1000:time.sleep(.025)
            self.wfile.write(b'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\r\r');self.wfile.flush()
        except (BrokenPipeError,ConnectionResetError):pass
http.server.ThreadingHTTPServer(('127.0.0.1',8891),Handler).serve_forever()
