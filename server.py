"""Serve Orbit over HTTPS and proxy local Ollama requests same-origin.

The browser cannot reliably call Ollama directly from an HTTPS custom domain:
the request crosses origins and can also be blocked as mixed content. Orbit
therefore sends Ollama requests to this server, which forwards them to the
local Ollama daemon on 127.0.0.1:11434.
"""

import http.client
import http.server
import os
import socket
import ssl
import threading
import time
import json
import ipaddress
import re
import base64
import binascii
import html
from html.parser import HTMLParser
import urllib.error
import urllib.request
from urllib.parse import urlsplit, parse_qsl, urlencode
from pathlib import Path
from xml.etree import ElementTree
from gemini import GeminiGateway
from openai_gateway import OpenAIGateway
from deepseek import DeepSeekGateway
from aicredits import AICreditsGateway


HOST = os.environ.get("ORBIT_HOST", "0.0.0.0")
IPV6_HOST = "::"
PORT = int(os.environ.get("ORBIT_PORT", "443"))
OLLAMA_HOST = "127.0.0.1"
OLLAMA_PORT = 11434
OLLAMA_PATHS = {
    "/api/ollama/tags": "/api/tags",
    "/api/ollama/chat": "/api/chat",
    # Compatibility aliases for the previous client path. This lets an old
    # cached Comet tab recover while the new app shell is being installed.
    "/api/ollama/api/tags": "/api/tags",
    "/api/ollama/api/chat": "/api/chat",
}
ROOT = Path(os.environ.get("ORBIT_ROOT", Path(__file__).resolve().parent)).resolve()
CERT_FILE = Path(os.environ.get("ORBIT_CERT_FILE", ROOT / "orbit.com.pem")).resolve()
KEY_FILE = Path(os.environ.get("ORBIT_KEY_FILE", ROOT / "orbit.com-key.pem")).resolve()
WEB_SLOTS = threading.BoundedSemaphore(3)
WEB_SEARCH_TIMEOUT = 8
WEB_FETCH_TIMEOUT = 20


class VoiceInternetProbe:
    """A fixed, credential-free HTTPS connectivity check, shared across tabs.

    A LAN connection or this localhost server alone does not prove internet
    access. Redirects/captive-portal pages never count as a successful probe.
    """
    def __init__(self, connect=http.client.HTTPSConnection, clock=time.monotonic):
        self.connect, self.clock = connect, clock
        self.lock = threading.Lock()
        self.checked_at, self.online = -float('inf'), False

    def check(self):
        if self.clock() - self.checked_at < 10:
            return self.online
        if not self.lock.acquire(blocking=False):
            return False
        connection = None
        try:
            if self.clock() - self.checked_at < 10:
                return self.online
            self.online = False
            connection = self.connect('www.gstatic.com', 443, timeout=2.5)
            connection.request('GET', '/generate_204', headers={'User-Agent': 'Orbit connectivity check', 'Accept': '*/*'})
            response = connection.getresponse()
            self.online = response.status == 204 and response.read(1) == b''
        except (OSError, http.client.HTTPException):
            self.online = False
        finally:
            if connection is not None:
                try:
                    connection.close()
                except OSError:
                    pass
            self.checked_at = self.clock()
            self.lock.release()
        return self.online


VOICE_INTERNET = VoiceInternetProbe()


class WebRelayBackoff:
    """Remember quota/auth failures briefly, without caching queries or keys."""
    def __init__(self):
        self.until = 0
        self.lock = threading.Lock()

    def active(self):
        with self.lock:
            return time.monotonic() < self.until

    def failure(self, status):
        if status in (401, 403, 429):
            with self.lock:
                self.until = time.monotonic() + (300 if status == 429 else 60)


WEB_RELAY_BACKOFF = WebRelayBackoff()
GEMINI = GeminiGateway(ROOT)
OPENAI = OpenAIGateway(ROOT)
DEEPSEEK = DeepSeekGateway(ROOT)
AICREDITS = AICreditsGateway(ROOT)


def public_web_url(value):
    """Only public HTTPS references, never credentials or local services."""
    if not isinstance(value, str) or len(value) > 2048 or re.search(r"[\s\x00-\x1f\\]", value):
        raise ValueError("Use a public HTTPS page URL.")
    parsed = urlsplit(value)
    host = (parsed.hostname or "").rstrip(".").lower()
    if parsed.scheme != "https" or parsed.username or parsed.password or parsed.port not in (None, 443):
        raise ValueError("Only public HTTPS pages without credentials are supported.")
    if not host or "." not in host or host == "orbit.com" or host.endswith((".local", ".localhost", ".internal", ".lan", ".home", ".test", ".invalid")):
        raise ValueError("Private and local pages cannot be read by web search.")
    try:
        address = ipaddress.ip_address(host)
    except ValueError:
        # Reject numeric/encoded loopback aliases and malformed DNS names too.
        if not re.fullmatch(r"[a-z0-9-]+(?:\.[a-z0-9-]+)+", host) or not re.search(r"[a-z]", host.rsplit(".", 1)[-1]):
            raise ValueError("Use a public website hostname.")
    else:
        if not address.is_global:
            raise ValueError("Private and local pages cannot be read by web search.")
    if any(re.search(r"token|password|secret|api.?key|signature|authorization|session", key, re.I) for key, _ in parse_qsl(parsed.query)):
        raise ValueError("URLs containing credentials cannot be sent to web search.")
    return parsed._replace(fragment="").geturl()


def web_payload(action, raw):
    if not isinstance(raw, dict):
        raise ValueError("Expected a JSON object.")
    if action == "search":
        query = raw.get("query")
        if not isinstance(query, str) or not 1 <= len(query.strip()) <= 400 or re.search(r"[\x00-\x1f]", query):
            raise ValueError("Search queries must be 1–400 characters.")
        return {"query": query.strip(), "max_results": 5}
    return {"url": public_web_url(raw.get("url"))}


class _BingResultParser(HTMLParser):
    """Extract only result cards from Bing's public HTML response."""

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.results = []
        self.current = None
        self.in_title = False
        self.in_caption = False
        self.title_parts = []
        self.caption_parts = []

    @staticmethod
    def _classes(attrs):
        return set((dict(attrs).get("class") or "").split())

    def _finish(self):
        if not self.current:
            return
        title = re.sub(r"\s+", " ", " ".join(self.title_parts)).strip()
        content = re.sub(r"\s+", " ", " ".join(self.caption_parts)).strip()
        if title and self.current.get("url"):
            self.current["title"] = html.unescape(title)[:240]
            self.current["content"] = html.unescape(content)[:8000]
            self.results.append(self.current)
        self.current = None
        self.in_title = self.in_caption = False
        self.title_parts = []
        self.caption_parts = []

    def handle_starttag(self, tag, attrs):
        classes = self._classes(attrs)
        if tag == "li" and "b_algo" in classes:
            self._finish()
            self.current = {"url": ""}
            return
        if not self.current:
            return
        if tag == "h2":
            self.in_title = True
            self.title_parts = []
        elif tag == "a" and self.in_title:
            self.current["url"] = dict(attrs).get("href") or ""
        elif tag == "p":
            self.in_caption = True
            self.caption_parts = []

    def handle_endtag(self, tag):
        if tag == "h2":
            self.in_title = False
        elif tag == "p" and self.in_caption:
            self.in_caption = False
        elif tag == "li":
            self._finish()

    def handle_data(self, data):
        if self.in_title:
            self.title_parts.append(data)
        elif self.in_caption:
            self.caption_parts.append(data)

    def close(self):
        super().close()
        self._finish()


class _PublicPageParser(HTMLParser):
    """Turn a public HTML page into bounded, readable text."""

    BLOCK_TAGS = {
        "address", "article", "aside", "blockquote", "br", "dd", "div",
        "dl", "dt", "fieldset", "figcaption", "figure", "footer", "form",
        "h1", "h2", "h3", "h4", "h5", "h6", "header", "hr", "li", "main",
        "nav", "ol", "p", "pre", "section", "table", "td", "th", "tr", "ul",
    }
    SKIP_TAGS = {"canvas", "iframe", "noscript", "object", "script", "style", "svg", "template"}

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.title_parts = []
        self.text_parts = []
        self.in_title = False
        self.skip_depth = 0

    def handle_starttag(self, tag, attrs):
        tag = tag.lower()
        if tag in self.SKIP_TAGS:
            self.skip_depth += 1
            return
        if self.skip_depth:
            return
        if tag == "title":
            self.in_title = True
        elif tag in self.BLOCK_TAGS:
            self.text_parts.append("\n")

    def handle_startendtag(self, tag, attrs):
        if tag.lower() in self.BLOCK_TAGS:
            self.text_parts.append("\n")

    def handle_endtag(self, tag):
        tag = tag.lower()
        if tag in self.SKIP_TAGS:
            self.skip_depth = max(0, self.skip_depth - 1)
            return
        if self.skip_depth:
            return
        if tag == "title":
            self.in_title = False
        elif tag in self.BLOCK_TAGS:
            self.text_parts.append("\n")

    def handle_data(self, data):
        if self.skip_depth:
            return
        if self.in_title:
            self.title_parts.append(data)
        else:
            self.text_parts.append(data)

    @staticmethod
    def _clean(parts):
        lines = []
        for line in "".join(parts).splitlines():
            line = re.sub(r"\s+", " ", line).strip()
            if line and (not lines or line != lines[-1]):
                lines.append(line)
        return "\n".join(lines)

    def result(self):
        title = self._clean(self.title_parts)[:240]
        content = self._clean(self.text_parts)[:64000]
        return title, content


class _PublicRedirectHandler(urllib.request.HTTPRedirectHandler):
    """Allow only redirects that remain public HTTPS URLs."""

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        safe_url = public_web_url(newurl)
        return super().redirect_request(req, fp, code, msg, headers, safe_url)


def _unwrap_bing_url(value):
    """Turn Bing's click-tracking URL into the destination URL when possible."""
    if not isinstance(value, str):
        return ""
    try:
        parsed = urlsplit(html.unescape(value))
        host = (parsed.hostname or "").lower()
        if (host == "bing.com" or host.endswith(".bing.com")) and parsed.path.startswith("/ck/a"):
            encoded = dict(parse_qsl(parsed.query)).get("u", "")
            if encoded.startswith("a1"):
                decoded = base64.urlsafe_b64decode(encoded[2:] + "===").decode("utf-8", "strict")
                if decoded.startswith(("https://", "http://")):
                    return decoded
    except (ValueError, UnicodeError, binascii.Error):
        pass
    return html.unescape(value)


def clean_web_results(items):
    """Normalize untrusted search data once for every search provider."""
    if not isinstance(items, list):
        return []
    results, seen = [], set()
    for item in items[:50]:
        if not isinstance(item, dict):
            continue
        try:
            url = public_web_url(item.get("url"))
        except (ValueError, AttributeError, TypeError):
            continue
        if url in seen:
            continue
        seen.add(url)
        results.append({"url": url, "title": str(item.get("title") or url)[:240],
                        "content": str(item.get("content") or "")[:8000]})
        if len(results) == 5:
            break
    return results


def _public_search_body(url):
    request = urllib.request.Request(url, headers={
        "Accept": "text/html,application/xhtml+xml,application/rss+xml,application/xml",
        "User-Agent": "Mozilla/5.0 (compatible; Orbit/1.0; public web search)",
    })
    opener = urllib.request.build_opener(_PublicRedirectHandler,
        urllib.request.HTTPSHandler(context=ssl.create_default_context()))
    deadline = time.monotonic() + 6
    with opener.open(request, timeout=6) as response:
        body = _bounded_web_body(response, deadline)
    return body.decode("utf-8", "replace")


def _bounded_web_body(response, deadline):
    """A slow trickle must not hold a web slot forever or bypass the size cap."""
    chunks, size = [], 0
    reader = getattr(response, "read1", None) or response.read
    while True:
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            raise TimeoutError("Public web response timed out")
        sock = getattr(getattr(getattr(response, "fp", None), "raw", None), "_sock", None)
        if sock is not None:
            sock.settimeout(remaining)
        chunk = reader(min(16384, 512001 - size))
        if not isinstance(chunk, bytes):
            raise ValueError("Invalid web response body")
        if not chunk:
            return b"".join(chunks)
        size += len(chunk)
        if size > 512000:
            raise ValueError("Web response too large")
        chunks.append(chunk)


def bing_web_search(query):
    """Read Bing result cards; the fallback chain handles empty/challenge pages."""
    search_url = "https://www.bing.com/search?" + urlencode({
        "q": query,
        "count": 5,
        "setlang": "en-US",
        "form": "QBLH",
    })
    parser = _BingResultParser()
    parser.feed(_public_search_body(search_url))
    parser.close()
    return clean_web_results([{**item, "url": _unwrap_bing_url(item.get("url"))} for item in parser.results])


def bing_rss_search(query):
    body = _public_search_body("https://www.bing.com/search?" + urlencode({"q": query, "format": "rss"}))
    if re.search(r"<!\s*(?:DOCTYPE|ENTITY)\b", body, re.I):
        raise ValueError("Unsupported search XML")
    document = ElementTree.fromstring(body)
    return clean_web_results([{"url": item.findtext("link"), "title": item.findtext("title"),
                               "content": item.findtext("description")} for item in document.findall("./channel/item")])


class _DuckDuckGoResultParser(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.results, self.current, self.parts = [], None, []
        self.capture = None
        self.capture_tag = None

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        classes = set((attrs.get("class") or "").split())
        if tag == "a" and classes.intersection({"result__a", "result-link"}):
            if self.current:
                self.results.append(self.current)
            self.current = {"url": attrs.get("href", ""), "title": "", "content": ""}
            self.capture, self.parts = "title", []
            self.capture_tag = tag
        elif self.current and classes.intersection({"result__snippet", "result-snippet"}):
            self.capture, self.parts = "content", []
            self.capture_tag = tag

    def handle_data(self, data):
        if self.capture:
            self.parts.append(data)

    def handle_endtag(self, tag):
        if self.capture and tag == self.capture_tag:
            self.current[self.capture] = re.sub(r"\s+", " ", "".join(self.parts)).strip()
            self.capture = None

    def close(self):
        super().close()
        if self.current:
            self.results.append(self.current)
            self.current = None


def _duckduckgo_search(query, endpoint):
    parser = _DuckDuckGoResultParser()
    parser.feed(_public_search_body(endpoint + "?" + urlencode({"q": query})))
    parser.close()
    results = []
    for item in parser.results:
        value = item["url"]
        try:
            parsed = urlsplit("https:" + value if value.startswith("//") else value)
        except ValueError:
            continue
        host = (parsed.hostname or "").lower()
        if (host == "duckduckgo.com" or host.endswith(".duckduckgo.com")) and parsed.path == "/l/":
            value = dict(parse_qsl(parsed.query)).get("uddg", "")
        results.append({**item, "url": value})
    return clean_web_results(results)


def duckduckgo_web_search(query):
    # The documented Lite interface can remain available when HTML search
    # presents a challenge. Never attempt to solve or bypass a challenge.
    for endpoint in ["https://html.duckduckgo.com/html/", "https://lite.duckduckgo.com/lite/"]:
        try:
            results = _duckduckgo_search(query, endpoint)
        except (OSError, ValueError, TypeError, AttributeError):
            continue
        if results:
            return results
    return []


def public_web_fetch(url):
    """Read a public HTML page when the Ollama page reader is unavailable."""
    safe_url = public_web_url(url)
    opener = urllib.request.build_opener(
        _PublicRedirectHandler,
        urllib.request.HTTPSHandler(context=ssl.create_default_context()),
    )
    request = urllib.request.Request(safe_url, headers={
        "Accept": "text/html,application/xhtml+xml,text/plain",
        "User-Agent": "Orbit/1.0 (public web reader)",
    })
    deadline = time.monotonic() + WEB_FETCH_TIMEOUT
    with opener.open(request, timeout=WEB_FETCH_TIMEOUT) as response:
        final_url = public_web_url(response.geturl())
        headers = getattr(response, "headers", None)
        if headers is not None and hasattr(headers, "get_content_type"):
            content_type = headers.get_content_type()
            charset = headers.get_content_charset() or "utf-8"
        else:
            content_type = str(headers.get("Content-Type", "")).split(";", 1)[0].strip().lower() if headers else ""
            charset = "utf-8"
        if content_type and content_type not in {"text/html", "application/xhtml+xml", "text/plain"}:
            raise ValueError("This source is not a readable HTML page.")
        body = _bounded_web_body(response, deadline)
    try:
        document = body.decode(charset, "replace")
    except LookupError:
        document = body.decode("utf-8", "replace")
    parser = _PublicPageParser()
    parser.feed(document)
    parser.close()
    title, content = parser.result()
    if not content:
        raise ValueError("This page returned no readable content.")
    return {"url": final_url, "title": title or final_url, "content": content}


def public_web_fallback(action, payload):
    """Run the no-key public fallback for one bounded web operation."""
    if action == "search":
        domains = re.findall(r"(?:^|\s)site:([a-z\d.-]+\.[a-z]{2,})(?=[:/\s]|$)", payload["query"], re.I)
        for search, name in [(bing_web_search, "Bing"), (bing_rss_search, "Bing RSS"), (duckduckgo_web_search, "DuckDuckGo")]:
            try:
                results = clean_web_results(search(payload["query"]))
                if domains:
                    results = [item for item in results if any(
                        urlsplit(item["url"]).hostname == domain.lower() or
                        urlsplit(item["url"]).hostname.endswith("." + domain.lower()) for domain in domains)]
            except (OSError, ValueError, TypeError, AttributeError, ElementTree.ParseError):
                continue
            if results:
                return {"results": results, "provider": "public-search", "engine": name,
                        "notice": f"Ollama web search was unavailable; {name} public search results were used."}
        return None
    try:
        page = public_web_fetch(payload["url"])
    except (OSError, ValueError, TypeError, AttributeError):
        return None
    return {
        **page,
        "provider": "public-page",
        "engine": "Direct page reader",
        "notice": "Ollama's page reader was unavailable; the public HTTPS page was read directly.",
    }


class OrbitHandler(http.server.SimpleHTTPRequestHandler):
    protocol_version = "HTTP/1.0"

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def log_message(self, format, *args):  # noqa: A002 - inherited API name
        # pythonw.exe may not provide a normal stderr stream. The base
        # handler would raise while logging a request, closing the TLS socket
        # before it sends the response. Logging must never break the request.
        try:
            super().log_message(format, *args)
        except (AttributeError, OSError):
            pass

    def do_GET(self):  # noqa: N802 - required by BaseHTTPRequestHandler
        path = self.path.split("?", 1)[0]
        if path == '/api/voice/connectivity':
            if self.headers.get('X-Orbit-Voice') != '1':
                self.web_json(403, {'online': False})
                return
            self.web_json(200, {'online': VOICE_INTERNET.check()})
            return
        if path.startswith('/api/aicredits/'):
            AICREDITS.handle(self, path, 'GET')
            return
        if path.startswith('/api/openai/'):
            OPENAI.handle(self, path, 'GET')
            return
        if path.startswith('/api/deepseek/'):
            DEEPSEEK.handle(self, path, 'GET')
            return
        if path.startswith('/api/gemini/'):
            GEMINI.handle(self, path, 'GET')
            return
        ollama_path = OLLAMA_PATHS.get(self.path.split("?", 1)[0])
        if ollama_path:
            self.proxy_to_ollama("GET", ollama_path)
            return
        super().do_GET()

    def send_head(self):
        # Certificates live beside the app, but are never public web assets.
        # Resolve symlinks before checking; this also covers HEAD requests.
        target = Path(self.translate_path(self.path)).resolve()
        try:
            relative = target.relative_to(ROOT)
        except ValueError:
            self.send_error(404)
            return None
        if (target in (CERT_FILE, KEY_FILE)
                or target.suffix.lower() in ('.pem', '.key', '.p12', '.pfx')
                or any(part.startswith('.') for part in relative.parts)):
            self.send_error(404)
            return None
        return super().send_head()

    def list_directory(self, path):
        self.send_error(404)
        return None

    def do_POST(self):  # noqa: N802 - required by BaseHTTPRequestHandler
        web_path = self.path.split("?", 1)[0]
        if web_path.startswith('/api/aicredits/'):
            AICREDITS.handle(self, web_path, 'POST')
            return
        if web_path.startswith('/api/openai/'):
            OPENAI.handle(self, web_path, 'POST')
            return
        if web_path.startswith('/api/deepseek/'):
            DEEPSEEK.handle(self, web_path, 'POST')
            return
        if web_path.startswith('/api/gemini/'):
            GEMINI.handle(self, web_path, 'POST')
            return
        if web_path in ("/api/web/search", "/api/web/fetch"):
            self.proxy_web(web_path.rsplit("/", 1)[-1])
            return
        ollama_path = OLLAMA_PATHS.get(self.path.split("?", 1)[0])
        if ollama_path:
            self.proxy_to_ollama("POST", ollama_path)
            return
        self.send_error(405, "POST is only supported for the Ollama proxy")

    def web_json(self, status, payload):
        data = json.dumps(payload, ensure_ascii=True).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("X-Content-Type-Options", "nosniff")
        self.end_headers()
        self.wfile.write(data)

    def proxy_web(self, action):
        # Do not expose the user's signed-in search account to LAN clients or
        # cross-origin websites. Custom header also prevents simple-form CSRF.
        try:
            peer = ipaddress.ip_address(self.client_address[0])
            peer = peer.ipv4_mapped if isinstance(peer, ipaddress.IPv6Address) and peer.ipv4_mapped else peer
            origin = self.headers.get("Origin")
            expected = f"{'https' if isinstance(self.connection, ssl.SSLSocket) else 'http'}://{self.headers.get('Host', '')}"
            host = urlsplit(expected).hostname
            if not peer.is_loopback or host not in ("orbit.com", "localhost", "127.0.0.1", "::1") or self.headers.get("X-Orbit-Web") != "1" or (origin and origin != expected) or self.headers.get("Sec-Fetch-Site") == "cross-site":
                self.web_json(403, {"error": "Web tools are available only to the local Orbit app."})
                return
            if self.headers.get("Content-Type", "").split(";")[0] != "application/json":
                raise ValueError("Expected application/json.")
            length = int(self.headers.get("Content-Length", "0"))
            if not 0 < length <= 8192 or self.headers.get("Transfer-Encoding"):
                raise ValueError("Invalid web request size.")
            payload = web_payload(action, json.loads(self.rfile.read(length)))
        except (ValueError, TypeError):
            self.web_json(400, {"error": "Invalid web request. Use a short query or a public HTTPS URL without credentials."})
            return
        if not WEB_SLOTS.acquire(blocking=False):
            self.web_json(429, {"error": "Web search is busy. Try again shortly.", "retryable": True})
            return
        connection = http.client.HTTPConnection(
            OLLAMA_HOST,
            OLLAMA_PORT,
            timeout=WEB_SEARCH_TIMEOUT if action == "search" else WEB_FETCH_TIMEOUT,
        )
        try:
            if WEB_RELAY_BACKOFF.active():
                fallback = public_web_fallback(action, payload)
                if fallback:
                    self.web_json(200, fallback)
                else:
                    self.web_json(502, {"error": "Public search providers are temporarily unavailable. Try again shortly.", "retryable": True})
                return
            connection.request("POST", f"/api/experimental/web_{action}", body=json.dumps(payload), headers={"Content-Type": "application/json"})
            response = connection.getresponse()
            if response.status != 200:
                WEB_RELAY_BACKOFF.failure(response.status)
                connection.close()
                try:
                    fallback = public_web_fallback(action, payload)
                except (OSError, urllib.error.URLError, ValueError, TypeError, AttributeError):
                    fallback = None
                if fallback:
                    self.web_json(200, fallback)
                    return
                messages = {401: "Sign in to Ollama to use web search.", 403: "Ollama web access is unavailable for this account or disabled in the runtime.", 404: "Update Ollama to a version with web search support.", 429: "Ollama's web search limit was reached. Try again later."}
                if action == "fetch" and response.status in (403, 404, 410, 422):
                    self.web_json(502, {"error": "This source page is unavailable to the web reader. Other sources can still be used.", "code": "source_unavailable"})
                else:
                    self.web_json(502, {"error": messages.get(response.status, "Web search is unavailable. Check your internet connection and Ollama sign-in."), "retryable": response.status == 408 or response.status >= 500})
                return
            data = response.read(512000 + 1)
            if len(data) > 512000:
                raise ValueError("Web response too large")
            raw = json.loads(data)
            if not isinstance(raw, dict):
                raise ValueError("Invalid web response")
            if action == "search":
                results = clean_web_results(raw.get("results"))
                if not results:
                    fallback = public_web_fallback(action, payload)
                    if fallback:
                        self.web_json(200, fallback)
                        return
                self.web_json(200, {"results": results, "engine": "Ollama"})
            else:
                content = str(raw.get("content") or "")[:64000]
                if not content:
                    try:
                        fallback = public_web_fallback(action, payload)
                    except (OSError, urllib.error.URLError, ValueError, TypeError, AttributeError):
                        fallback = None
                    if fallback:
                        self.web_json(200, fallback)
                        return
                self.web_json(200, {"url": payload["url"], "title": str(raw.get("title") or payload["url"])[:240], "content": content, "engine": "Ollama"})
        except (OSError, urllib.error.URLError, ValueError, TypeError, AttributeError):
            try:
                fallback = public_web_fallback(action, payload)
            except (OSError, urllib.error.URLError, ValueError, TypeError, AttributeError):
                fallback = None
            if fallback:
                self.web_json(200, fallback)
                return
            self.web_json(502, {"error": "Web access failed. Check your internet connection and that Ollama is running and signed in."})
        finally:
            connection.close()
            WEB_SLOTS.release()

    def proxy_to_ollama(self, method, path):
        body = None
        if method == "POST":
            try:
                length = int(self.headers.get("Content-Length", "0"))
            except ValueError:
                self.send_error(400, "Invalid request length")
                return
            body = self.rfile.read(length)

        headers = {}
        if body is not None:
            headers["Content-Type"] = self.headers.get("Content-Type", "application/json")
            headers["Content-Length"] = str(len(body))

        # Model discovery is a health check and must fail quickly when Ollama
        # is stopped or a firewall silently drops the loopback connection.
        # Chat requests need a longer window because generation can stream for
        # several minutes before the first response is complete.
        timeout = 5 if method == "GET" and path == "/api/tags" else 130
        connection = http.client.HTTPConnection(OLLAMA_HOST, OLLAMA_PORT, timeout=timeout)
        headers_sent = False
        try:
            connection.request(method, path, body=body, headers=headers)
            response = connection.getresponse()
            self.send_response(response.status, response.reason)
            content_type = response.getheader("Content-Type")
            if content_type:
                self.send_header("Content-Type", content_type)
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            headers_sent = True
            while True:
                chunk = response.read1(64 * 1024)
                if not chunk:
                    break
                self.wfile.write(chunk)
                self.wfile.flush()
        except (ConnectionRefusedError, TimeoutError, OSError) as error:
            if headers_sent:
                # Never append an HTTP/HTML error document inside an NDJSON stream.
                # Closing an incomplete stream lets the client resume its draft.
                self.close_connection = True
            else:
                self.send_error(502, f"Ollama is unavailable: {error}")
        finally:
            connection.close()


class TLSAwareThreadingHTTPServer(http.server.ThreadingHTTPServer):
    allow_reuse_address = True
    daemon_threads = True

    def shutdown_request(self, request):
        # socketserver.TCPServer normally calls socket.shutdown(SHUT_WR) for
        # every request. On an SSLSocket that can send a raw TCP half-close
        # without TLS close_notify, which modern Windows Schannel rejects as
        # curl error 56. Complete the TLS shutdown first, then close safely.
        try:
            if isinstance(request, ssl.SSLSocket):
                request.settimeout(1.0)
                request.unwrap()
            else:
                request.shutdown(socket.SHUT_WR)
        except (OSError, ssl.SSLError):
            pass
        finally:
            self.close_request(request)


class IPv4ThreadingHTTPServer(TLSAwareThreadingHTTPServer):
    pass


class DualStackThreadingHTTPServer(TLSAwareThreadingHTTPServer):
    address_family = socket.AF_INET6

    def server_bind(self):
        # One IPv6 wildcard listener can accept both ::1 and IPv4-mapped
        # connections, avoiding two processes/listeners competing for :443.
        self.socket.setsockopt(socket.IPPROTO_IPV6, socket.IPV6_V6ONLY, 0)
        super().server_bind()


class IPv6ThreadingHTTPServer(TLSAwareThreadingHTTPServer):
    address_family = socket.AF_INET6


def create_server(address, context, server_class=IPv4ThreadingHTTPServer):
    server = server_class((address, PORT), OrbitHandler)
    server.socket = context.wrap_socket(server.socket, server_side=True)
    return server


def main():
    context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    context.load_cert_chain(
        certfile=str(CERT_FILE),
        keyfile=str(KEY_FILE),
    )
    servers = []
    try:
        servers.append(create_server("::", context, DualStackThreadingHTTPServer))
        print("Serving Orbit on https://orbit.com (IPv4 + IPv6 loopback)")
    except OSError as error:
        print(f"Dual-stack listener unavailable; trying separate IPv4 and IPv6 listeners: {error}")
        servers.append(create_server(HOST, context))
        try:
            servers.append(create_server(IPV6_HOST, context, IPv6ThreadingHTTPServer))
            print("Serving Orbit with separate IPv4 and IPv6 listeners")
        except OSError as ipv6_error:
            print(f"IPv6 listener unavailable; serving IPv4 only: {ipv6_error}")
    threads = [threading.Thread(target=server.serve_forever, name=f"orbit-server-{index}", daemon=True) for index, server in enumerate(servers)]
    for thread in threads:
        thread.start()
    print("Ollama proxy: https://orbit.com/api/ollama/* -> http://127.0.0.1:11434/api/*")
    try:
        for thread in threads:
            thread.join()
    except KeyboardInterrupt:
        print("\nOrbit server stopped")
    finally:
        for server in servers:
            server.shutdown()
            server.server_close()


if __name__ == "__main__":
    main()
