"""Opt-in localhost audit; relay only to the user's already configured Orbit.

Never reads or copies the API key. Only the locked Flash model may be requested.
Input images are exactly the two question-paper images supplied for this task.
"""
import http.client
import http.server
import json
from pathlib import Path
import socket
import ssl
import threading
import argparse

ROOT = Path(__file__).resolve().parent.parent
OUTPUT = ROOT / "tests/output/live-statistics"
OUTPUT.mkdir(parents=True, exist_ok=True)
IMAGES = {
    "/tests/live-assets/page-1.png": Path("/var/folders/pt/tql2804n37jggzss8pysd95m0000gn/T/codex-clipboard-89e8b77e-b8e9-4a2b-9330-7ff8446d37e5.png"),
    "/tests/live-assets/page-2.png": Path("/var/folders/pt/tql2804n37jggzss8pysd95m0000gn/T/codex-clipboard-f5a2ebbf-12f6-45b4-844b-c7540ac38176.png"),
}
CONTEXT = ssl.create_default_context(cafile="/Library/Application Support/Orbit/orbit.com.pem")
LOCK = threading.Lock()
REQUESTS = 0


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def log_message(self, fmt, *args):
        # No request payload, credential, response or unrelated access logging.
        pass

    def send_data(self, content, content_type, status=200):
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(content)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(content)

    def do_GET(self):
        path = self.path.split("?", 1)[0]
        if path == "/tests/browser-live-statistics.html":
            source = (ROOT / "index.html").read_text().replace("<head>", '<head><base href="/">', 1)
            source = source.replace("</body>", '<script src="/tests/live-statistics-browser.js"></script></body>')
            self.send_data(source.encode(), "text/html; charset=utf-8")
        elif path in IMAGES:
            self.send_data(IMAGES[path].read_bytes(), "image/png")
        elif path.startswith("/api/"):
            if path == "/api/aicredits/settings":
                self.relay(path)
            elif path == "/api/aicredits/models":
                # Exact installed model selection is checked by every relay POST.
                self.send_data(json.dumps({"data": [{"id": "deepseek/deepseek-v4.1-flash", "name": "DeepSeek V4.1 Flash", "remote": True, "capabilities": ["completion", "vision", "thinking"]}]}).encode(), "application/json")
            elif path.endswith("/settings"):
                self.send_data(b'{"configured":false}', "application/json")
            else:
                self.send_data(b'{"models":[],"data":[]}', "application/json")
        else:
            # Expose the same public app assets as the installed server; no secrets.
            target = (ROOT / path.lstrip("/")).resolve()
            if not target.is_relative_to(ROOT) or any(p.startswith(".") for p in Path(path).parts) or target.suffix.lower() in (".pem", ".key", ".py", ".toml"):
                self.send_error(403)
            else:
                super().do_GET()

    def do_POST(self):
        global REQUESTS
        path = self.path.split("?", 1)[0]
        size = int(self.headers.get("Content-Length", "0"))
        if not 0 < size <= 48 * 1024 * 1024:
            self.send_error(413)
            return
        body = self.rfile.read(size)
        if path == "/api/aicredits/chat":
            value = json.loads(body)
            if value.get("model") != "deepseek/deepseek-v4.1-flash":
                self.send_error(400, "Only DeepSeek Flash is allowed")
                return
            with LOCK:
                REQUESTS += 1
                count = REQUESTS
            if count > 32:
                self.send_error(429, "Audit request limit reached")
                return
            print(json.dumps({"request": count, "effort": value.get("reasoning_effort"), "json": bool(value.get("response_format"))}), flush=True)
            self.relay(path, body)
        elif path in {"/tests/live-results/" + kind + suffix for kind in ("docx", "pdf", "chat", "normal", "normal2", "normal-docx", "normal-pdf", "normal2-docx", "normal2-pdf", "replayed-docx", "replayed-pdf", "replayed-chat") for suffix in (".json", ".bin")}:
            name = path.rsplit("/", 1)[1]
            if name.endswith(".json"):
                json.loads(body)
            (OUTPUT / name).write_bytes(body)
            self.send_data(b'{"saved":true}', "application/json")
        else:
            self.send_error(404)

    def relay(self, path, body=None):
        connection = http.client.HTTPSConnection("orbit.com", timeout=130, context=CONTEXT)
        # Verify the real orbit.com certificate while connecting to loopback.
        connection._create_connection = lambda address, timeout=130, source_address=None, **kwargs: socket.create_connection(("127.0.0.1", 443), timeout)
        try:
            connection.request("POST" if body else "GET", path, body=body, headers={"Content-Type": "application/json", "X-Orbit-AICredits": "1", "Origin": "https://orbit.com"})
            response = connection.getresponse()
            self.send_response(response.status)
            self.send_header("Content-Type", response.getheader("Content-Type", "application/json"))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            while chunk := response.read1(65536):
                self.wfile.write(chunk)
                self.wfile.flush()
        finally:
            connection.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument('--prior-requests', type=int, default=0)
    REQUESTS = parser.parse_args().prior_requests
    print("Live audit at http://127.0.0.1:8891/tests/browser-live-statistics.html", flush=True)
    http.server.ThreadingHTTPServer(("127.0.0.1", 8891), Handler).serve_forever()
