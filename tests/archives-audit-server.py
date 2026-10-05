"""Disposable ZIP/notebook integration: no forwarding or credentials."""
import http.server, importlib.util
from pathlib import Path
spec=importlib.util.spec_from_file_location('usage_audit',Path(__file__).with_name('usage-audit-server.py'))
helper=importlib.util.module_from_spec(spec);spec.loader.exec_module(helper)
class Handler(helper.Handler):
    def do_GET(self):
        path=self.path.split('?',1)[0]
        audits={'/tests/browser-archives.html':'archives-browser-audit.js','/tests/browser-notebooks.html':'notebooks-browser-audit.js'}
        if path in audits:
            page=(helper.ROOT/'index.html').read_text().replace('<head>','<head><base href="/"><script src="/tests/whole-app-audit-prelude.js"></script>',1).replace('</body>',f'<script src="/tests/{audits[path]}"></script></body>')
            return self.reply(page.encode(),'text/html;charset=utf-8')
        if path.endswith('.mjs') and path.startswith('/vendor/readers/'):
            return http.server.SimpleHTTPRequestHandler.do_GET(self)
        return super().do_GET()
if __name__=='__main__':http.server.ThreadingHTTPServer(('127.0.0.1',8899),Handler).serve_forever()
