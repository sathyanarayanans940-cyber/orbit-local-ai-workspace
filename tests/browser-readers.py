"""Serve an isolated, synthetic reader round-trip audit. Open the printed URL.
CSP forbids external connections; no user settings or chats are accessed.
"""
from pathlib import Path
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
import argparse
ROOT = Path(__file__).resolve().parent.parent
app = (ROOT/'app.js').read_text()
extract = app[app.index('function limitExtractedText('):app.index('async function extractAttachmentText(')]
page = '''<!doctype html><html><head><meta charset="utf-8"><title>Orbit offline reader audit</title>
<meta http-equiv="Content-Security-Policy" content="default-src 'self' blob:; script-src 'self' 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self' blob:; worker-src 'self' blob:;">
<style>body{font:18px system-ui;margin:40px;background:#181818;color:#eee}li{margin:18px}iframe{width:95%;height:500px;border:0}</style></head><body><h1>Orbit offline reader audit</h1><p>External network requests are blocked. Synthetic files only.</p><ol id="results"></ol>
<script src="/vendor/widgets/engine.js"></script><script src="/vendor/readers/mammoth.browser.min.js"></script><script src="/vendor/readers/jszip.min.js"></script>
<script>const MAX_EXTRACTED_TEXT=100000;\n''' + extract + '''
(async()=>{
 const result=(name,text)=>{const li=document.createElement('li');li.textContent=name+': '+text;document.querySelector('#results').append(li)};
 const sentence='Orbit offline round trip 42';
 const specs=[{kind:'pdf',title:'Offline PDF',blocks:[{type:'paragraph',text:sentence}]},{kind:'docx',title:'Offline Word',blocks:[{type:'paragraph',text:sentence}]},{kind:'pptx',title:'Offline slides',slides:[{title:sentence,bullets:['Synthetic test content']}]}];
 for(const spec of specs){try{
  const blob=await OrbitWidgetEngine.generate(spec);
  const text=await ({pdf:extractPdfText,docx:extractDocxText,pptx:extractPptxText}[spec.kind])(blob);
  if(!text.includes(sentence))throw Error('Missing expected text: '+text);
  result(spec.kind,'PASS — '+text.replace(/\\s+/g,' ').slice(0,160));
  if(spec.kind==='pdf'){const frame=document.createElement('iframe');frame.src=URL.createObjectURL(blob)+'#navpanes=0';document.body.append(frame)}
 }catch(e){result(spec.kind,'FAIL — '+(e.stack || e.message))}}
 try{await extractPdfText(new Blob(['invalid pdf']));result('Corrupt PDF','FAIL — accepted')}catch(e){result('Corrupt PDF',/Invalid PDF/i.test(e.message)?'PASS — rejected cleanly':'FAIL — '+(e.stack || e.message))}
 result('Audit','Complete');
})();</script></body></html>'''
class Handler(SimpleHTTPRequestHandler):
    def __init__(self,*a,**kw):super().__init__(*a,directory=str(ROOT),**kw)
    def do_GET(self):
        if self.path=='/':
            data=page.encode();self.send_response(200);self.send_header('Content-Type','text/html; charset=utf-8');self.send_header('Content-Length',str(len(data)));self.end_headers();self.wfile.write(data)
        elif self.path.startswith('/vendor/'):
            super().do_GET()
        else:self.send_error(404)
if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--port',type=int,default=8799);args=parser.parse_args()
    print(f'Open http://127.0.0.1:{args.port}/',flush=True)
    ThreadingHTTPServer(('127.0.0.1',args.port),Handler).serve_forever()
