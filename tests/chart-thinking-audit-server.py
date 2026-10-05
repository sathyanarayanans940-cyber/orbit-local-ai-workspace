"""Isolated, no-credential chart/thinking browser audit on localhost."""
import http.server
import json
from pathlib import Path
import time

ROOT=Path(__file__).resolve().parent.parent
OUT=ROOT/'tests/output/chart-thinking'
class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self,*args,**kwargs):super().__init__(*args,directory=str(ROOT),**kwargs)
    def log_message(self,*args):pass
    def reply(self,value,kind='application/json'):
        if not isinstance(value,bytes):value=json.dumps(value).encode()
        self.send_response(200);self.send_header('Content-Type',kind);self.send_header('Content-Length',str(len(value)));self.send_header('Cache-Control','no-store');self.end_headers();self.wfile.write(value)
    def do_GET(self):
        path=self.path.split('?',1)[0]
        if path in {'/tests/browser-chart-thinking.html','/tests/browser-chart-extreme.html'}:
            audit='chart-thinking-extreme-browser.js' if path.endswith('extreme.html') else 'chart-thinking-browser-audit.js'
            page=(ROOT/'index.html').read_text().replace('<head>','<head><base href="/"><script src="/tests/whole-app-audit-prelude.js"></script>',1).replace('</body>','<script src="/tests/chart-expansion-fixtures.js"></script><script src="/tests/'+audit+'"></script></body>')
            return self.reply(page.encode(),'text/html;charset=utf-8')
        if path=='/api/deepseek/models':return self.reply({'data':[{'id':'deepseek-flash','name':'DeepSeek local audit fixture','remote':True,'capabilities':['thinking']}]})
        if path.startswith('/api/'):return self.reply({'configured':False,'models':[],'data':[]})
        target=(ROOT/path.lstrip('/')).resolve()
        if not target.is_relative_to(ROOT) or target.suffix not in {'.js','.html','.css','.svg','.woff','.woff2','.ttf','.png','.webmanifest','.json','.wasm','.zip','.whl'} or any(p.startswith('.') for p in Path(path).parts):return self.send_error(404)
        super().do_GET()
    def do_POST(self):
        path=self.path.split('?',1)[0];body=self.rfile.read(int(self.headers.get('Content-Length',0)))
        if path=='/api/chart-thinking/result':
            OUT.mkdir(parents=True,exist_ok=True);(OUT/'browser-results.json').write_text(json.dumps(json.loads(body),indent=2));return self.reply({'ok':True})
        if path=='/api/chart-thinking/extreme-result':
            OUT.mkdir(parents=True,exist_ok=True);(OUT/'fresh-browser-results.json').write_text(json.dumps(json.loads(body),indent=2));return self.reply({'ok':True})
        if path=='/api/chart-thinking/extreme-file':
            kind=self.path.split('kind=')[-1]
            if kind not in {'docx','pdf','pptx'}:return self.send_error(400)
            OUT.mkdir(parents=True,exist_ok=True);(OUT/('fresh-extreme-charts.'+kind)).write_bytes(body);return self.reply({'ok':True})
        if path=='/api/chart-thinking/file':
            kind=self.path.split('kind=')[-1]
            if kind not in {'docx','pdf','pptx'}:return self.send_error(400)
            OUT.mkdir(parents=True,exist_ok=True);(OUT/('all-new-charts.'+kind)).write_bytes(body);return self.reply({'ok':True})
        if path!='/api/deepseek/chat':return self.send_error(405)
        request=json.loads(body);prompt=next((m['content'] for m in reversed(request['messages']) if m['role']=='user'),'')
        self.send_response(200);self.send_header('Content-Type','text/event-stream');self.send_header('Cache-Control','no-store');self.end_headers()
        def event(delta):self.wfile.write(('data: '+json.dumps({'choices':[{'delta':delta}]})+'\r\n\r\n').encode());self.wfile.flush()
        try:
            if request.get('max_tokens')==256:event({'content':'Regression and Project Scheduling'})
            elif request.get('response_format'):event({'content':'{"action":"none"}'})
            else:
                if 'hidden reasoning' not in prompt:event({'reasoning_content':'PRIVATE REASONING: review regression equations. '})
                time.sleep(5)
                if 'hidden reasoning' not in prompt:event({'reasoning_content':'Next, plan the project schedule and chart data.'})
                time.sleep(4)
                event({'content':'## Regression and project schedule\n\nThe project schedule is ready to discuss. This is a synthetic UI timing check, with no API usage.'})
            self.wfile.write(b'data: [DONE]\r\n\r\n');self.wfile.flush()
        except (BrokenPipeError,ConnectionResetError):pass

if __name__=='__main__':http.server.ThreadingHTTPServer(('127.0.0.1',8892),Handler).serve_forever()
