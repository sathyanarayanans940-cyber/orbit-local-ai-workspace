"""Disposable document QA server; writes only named synthetic test artifacts."""
import http.server
from pathlib import Path
import re
import sys
import os
ROOT=Path(__file__).resolve().parent.parent
sys.path.insert(0,str(ROOT))
from server import OrbitHandler
class Handler(OrbitHandler):
    def do_POST(self):
        if self.path.startswith('/audit-save/'):
            name=self.path.split('/')[-1]
            if not re.fullmatch(r'[a-z0-9-]+\.(?:pdf|docx|pptx|xlsx|png|json)',name):self.send_error(400);return
            size=int(self.headers.get('Content-Length','0'))
            if size>30000000:self.send_error(413);return
            (ROOT/'tests/output/document-vision'/name).write_bytes(self.rfile.read(size))
            self.send_response(204);self.end_headers()
        else:super().do_POST()
http.server.ThreadingHTTPServer(('127.0.0.1',int(os.environ.get('ORBIT_AUDIT_PORT','8880'))),Handler).serve_forever()
