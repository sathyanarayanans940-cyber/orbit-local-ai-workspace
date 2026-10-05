"""Local-only synthetic workspace integration. No forwarding or credentials."""
import http.server, json, time, io
from pathlib import Path
import importlib.util
spec=importlib.util.spec_from_file_location('usage_audit',Path(__file__).with_name('usage-audit-server.py'));helper=importlib.util.module_from_spec(spec);spec.loader.exec_module(helper)
Base,ROOT=helper.Handler,helper.ROOT
OUT=ROOT/'tests/output/workspace'
class Handler(Base):
    def do_GET(self):
        path=self.path.split('?',1)[0]
        if path=='/tests/browser-workspace-tools.html':
            page=(ROOT/'index.html').read_text().replace('<head>','<head><base href="/"><script src="/tests/whole-app-audit-prelude.js"></script>',1).replace('</body>','<script src="/tests/workspace-browser-audit.js"></script></body>')
            return self.reply(page.encode(),'text/html;charset=utf-8')
        if path.endswith('.mjs') and path.startswith('/vendor/readers/'):
            return http.server.SimpleHTTPRequestHandler.do_GET(self)
        return super().do_GET()
    def do_POST(self):
        size=int(self.headers.get('Content-Length',0))
        if size>4*1024*1024:return self.send_error(413)
        raw=self.rfile.read(size);body=json.loads(raw)
        path=self.path.split('?',1)[0]
        if path=='/api/workspace-audit/result':
            OUT.mkdir(parents=True,exist_ok=True);(OUT/('reload.json' if body.get('reload') else 'browser.json')).write_text(json.dumps(body,indent=2));return self.reply({'ok':True})
        if path=='/api/deepseek/chat':
            content='\n'.join(str(m.get('content','')) for m in body.get('messages',[]))
            if 'Create ' in content and 'study material' in content:
                mode='cards' if '"mode":"cards"' in content else 'quiz'
                text=json.dumps({'mode':mode,'items':[{'question':'What is the derivative of x²?','answer':'2x','explanation':'Apply the power rule.'},{'question':'What does a citation identify?','answer':'The supporting source page.'}]})
            elif body.get('response_format'):text='{"action":"none","checks":[]}'
            elif body.get('max_tokens')==256:text='Calculus Study Notes'
            else:text='A complete synthetic reply from '+str(body.get('model'))+'.\n\nThe derivative of x² is 2x.'
            if body.get('model')=='failed-model':
                self.send_response(429);self.send_header('Content-Type','application/json');self.end_headers();self.wfile.write(b'{"error":"Synthetic model unavailable"}');return
            self.send_response(200);self.send_header('Content-Type','text/event-stream');self.end_headers()
            try:
                for chunk in [text[:20],text[20:]]:
                    self.wfile.write(('data: '+json.dumps({'choices':[{'delta':{'content':chunk}}]})+'\n\n').encode());self.wfile.flush();time.sleep(.02)
                self.wfile.write(('data: '+json.dumps({'choices':[{'delta':{},'finish_reason':'stop'}],'usage':{'prompt_tokens':100,'completion_tokens':40,'total_tokens':140}})+'\n\ndata: [DONE]\n\n').encode());self.wfile.flush()
            except (BrokenPipeError,ConnectionResetError):pass
            return
        self.rfile=io.BytesIO(raw)
        return super().do_POST()
if __name__=='__main__':
    http.server.ThreadingHTTPServer(('127.0.0.1',8898),Handler).serve_forever()
