"""Isolated usage audit. Synthetic streams only, no credentials or external requests."""
import http.server
import json
from pathlib import Path
import time

ROOT=Path(__file__).resolve().parent.parent
OUT=ROOT/'tests/output/usage'


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self,*args,**kwargs):super().__init__(*args,directory=str(ROOT),**kwargs)
    def log_message(self,*args):pass
    def reply(self,value,kind='application/json'):
        data=value if isinstance(value,bytes) else json.dumps(value).encode()
        self.send_response(200);self.send_header('Content-Type',kind);self.send_header('Content-Length',str(len(data)));self.send_header('Cache-Control','no-store');self.end_headers();self.wfile.write(data)
    def do_GET(self):
        path=self.path.split('?',1)[0]
        if path=='/tests/browser-usage.html':
            page=(ROOT/'index.html').read_text().replace('<head>','<head><base href="/"><script src="/tests/whole-app-audit-prelude.js"></script>',1).replace('</body>','<script src="/tests/usage-browser-audit.js"></script></body>')
            return self.reply(page.encode(),'text/html;charset=utf-8')
        if path.startswith('/api/') :return self.reply({'configured':False,'models':[],'data':[]})
        target=(ROOT/path.lstrip('/')).resolve()
        if not target.is_relative_to(ROOT) or target.suffix not in {'.js','.html','.css','.svg','.woff','.woff2','.ttf','.png','.webmanifest','.json','.wasm','.zip','.whl'} or any(p.startswith('.') for p in Path(path).parts):return self.send_error(404)
        super().do_GET()
    def do_POST(self):
        length=int(self.headers.get('Content-Length',0))
        if length>1024*1024:return self.send_error(413)
        body=json.loads(self.rfile.read(length));path=self.path.split('?',1)[0]
        if path=='/api/usage-audit/result':
            OUT.mkdir(parents=True,exist_ok=True)
            filename='reload-results.json' if any(c.startswith('Reload preserves') for c in body.get('checks',[])) else 'browser-results.json'
            (OUT/filename).write_text(json.dumps(body,indent=2));return self.reply({'ok':True})
        if path=='/api/web/search':return self.reply({'engine':'Bing','results':[{'title':'Synthetic source','url':'https://example.org','content':'Synthetic public excerpt'}]})
        if path=='/api/web/fetch':return self.reply({'engine':'Direct page reader','url':body['url'],'title':'Synthetic source','content':'Synthetic page content.'})
        if path not in ('/api/deepseek/chat','/api/ollama/chat'):return self.send_error(405)
        if body.get('model')=='failed-model':
            self.send_response(429);self.send_header('Content-Type','application/json');self.end_headers();self.wfile.write(b'{"error":"Synthetic limit"}');return
        if path=='/api/ollama/chat':return self.reply((json.dumps({'message':{'content':'Synthetic Ollama reply'},'done':True,'prompt_eval_count':30,'eval_count':20})+'\n').encode(),'application/x-ndjson')
        text='Synthetic Usage Audit' if body.get('max_tokens')==256 else '{"action":"none"}' if body.get('response_format') else 'A synthetic answer for usage integration.'
        prompt=next((m['content'] for m in reversed(body['messages']) if m['role']=='user'),'')
        self.send_response(200);self.send_header('Content-Type','text/event-stream');self.send_header('Cache-Control','no-store');self.end_headers()
        def emit(packet):self.wfile.write(('data: '+json.dumps(packet)+'\n\n').encode());self.wfile.flush()
        try:
            if body.get('thinking',{}).get('type')=='enabled':emit({'choices':[{'delta':{'reasoning_content':'Synthetic reasoning'}}]})
            if prompt=='cancel-stream':
                emit({'choices':[{'delta':{'content':'Partial'}}]});time.sleep(2);return
            emit({'choices':[{'delta':{'content':text},'finish_reason':'stop'}]})
            time.sleep(.03)
            if prompt!='no-usage':emit({'choices':[],'usage':{'prompt_tokens':100,'completion_tokens':50,'total_tokens':150,'completion_tokens_details':{'reasoning_tokens':30},'prompt_cache_hit_tokens':20}})
            self.wfile.write(b'data: [DONE]\n\n');self.wfile.flush()
        except (BrokenPipeError,ConnectionResetError):pass


if __name__=='__main__':
    import argparse
    parser=argparse.ArgumentParser();parser.add_argument('--port',type=int,default=8894)
    http.server.ThreadingHTTPServer(('127.0.0.1',parser.parse_args().port),Handler).serve_forever()
