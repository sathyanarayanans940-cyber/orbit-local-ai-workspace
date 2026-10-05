"""Optional Gemini gateway for the installed, local Orbit server (stdlib only)."""
import http.client
import ipaddress
import json
import os
from pathlib import Path
import re
import ssl
import tempfile
import threading
import time
from urllib.parse import urlsplit

# Explicit free-tier-eligible text models, intersected with Google's live catalog.
# Billing/quota belongs to the user's Google project; never silently switch models.
FREE_MODELS = frozenset((
    'gemini-3.8-flash', 'gemini-3.7-flash', 'gemini-3.6-flash',
    'gemini-3.5-flash', 'gemini-3.5-flash-lite', 'gemini-3.1-flash-lite',
    'gemini-3-flash-preview', 'gemini-2.5-flash', 'gemini-2.5-flash-lite',
))
ERRORS = {
    400: 'Gemini could not accept this request. Check the model and attachments.',
    401: 'The Gemini key was rejected. Replace it in Settings → Models.',
    403: 'Gemini access was denied. Check the key, project permissions and supported region.',
    404: 'This Gemini model is no longer available. Choose another model.',
    429: 'Gemini’s free quota or rate limit was reached. Wait and try again, or select an Ollama model.',
}


class GeminiError(Exception):
    def __init__(self, status, message):
        self.status = status
        super().__init__(message)


class GeminiGateway:
    def __init__(self, root):
        if os.name == 'nt':
            # Windows' per-user AppData inherits the user's profile ACL. A
            # shared Program Files directory would expose a new key to users.
            root = Path(os.environ['LOCALAPPDATA']) / 'Orbit'
            root.mkdir(mode=0o700, parents=True, exist_ok=True)
        self.path = Path(root) / '.orbit-gemini.json'
        self.lock = threading.RLock()
        self.slots = threading.BoundedSemaphore(3)
        self.cache = None
        self.retry_after = 0

    def key(self):
        with self.lock:
            try:
                if self.path.is_symlink() or self.path.stat().st_size > 4096:
                    return ''
                value = json.loads(self.path.read_text()).get('key', '')
                return value if isinstance(value, str) else ''
            except (OSError, ValueError, AttributeError):
                return ''

    def save(self, key):
        if not isinstance(key, str) or (key and not re.fullmatch(r'[A-Za-z0-9_.-]{20,512}', key)):
            raise GeminiError(400, 'Paste the complete Gemini API key, without spaces.')
        with self.lock:
            # Restrictive permissions from creation; atomic replace prevents partial keys.
            fd, temporary = tempfile.mkstemp(prefix='.orbit-gemini-', dir=self.path.parent)
            try:
                with os.fdopen(fd, 'w') as output:
                    json.dump({'key': key}, output)
                os.replace(temporary, self.path)
            finally:
                if os.path.exists(temporary):
                    os.unlink(temporary)
            self.cache = None
            self.retry_after = 0

    def connect(self, method, path, key, payload=None, timeout=20):
        connection = http.client.HTTPSConnection('generativelanguage.googleapis.com', timeout=timeout)
        try:
            connection.request(method, path, body=json.dumps(payload) if payload is not None else None,
                               headers={'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json'})
            response = connection.getresponse()
            if response.status != 200:
                status = response.status
                connection.close()
                raise GeminiError(status if status in ERRORS else 502,
                                  ERRORS.get(status, 'Gemini is temporarily unavailable. Try again shortly.'))
            return connection, response
        except Exception:
            connection.close()
            raise

    def models(self):
        with self.lock:
            key = self.key()
            if not key:
                return []
            if self.cache and self.cache[0] > time.monotonic():
                return self.cache[1]
            if self.retry_after > time.monotonic():
                raise GeminiError(503, 'Gemini is unavailable. Check your connection or API key and retry shortly.')
            connection = None
            try:
                connection, response = self.connect('GET', '/v1beta/openai/models', key, timeout=8)
                data = response.read(1024 * 1024 + 1)
                if len(data) > 1024 * 1024:
                    raise ValueError('Oversized catalog')
                models = []
                for item in json.loads(data).get('data', [])[:500]:
                    name = str(item.get('id', '')).removeprefix('models/')
                    if name in FREE_MODELS and not any(model['id'] == name for model in models):
                        models.append({'id': name, 'name': name, 'remote': True, 'capabilities': ['vision', 'thinking']})
                self.cache = (time.monotonic() + 300, models)
                self.retry_after = 0
                return models
            except Exception:
                self.retry_after = time.monotonic() + 30
                raise
            finally:
                if connection:
                    connection.close()

    def payload(self, raw):
        if not isinstance(raw, dict) or not isinstance(raw.get('model'), str) or raw['model'] not in FREE_MODELS:
            raise GeminiError(400, 'Choose one of Orbit’s supported Gemini Flash models.')
        messages = raw.get('messages')
        if not isinstance(messages, list) or not 1 <= len(messages) <= 1000:
            raise GeminiError(400, 'Gemini needs a nonempty conversation.')
        clean = []
        for message in messages:
            if not isinstance(message, dict) or message.get('role') not in ('system', 'user', 'assistant'):
                raise GeminiError(400, 'Invalid Gemini message.')
            content = message.get('content')
            if isinstance(content, list):
                parts = []
                for part in content:
                    if not isinstance(part, dict):
                        raise GeminiError(400, 'Invalid Gemini attachment.')
                    if part.get('type') == 'text' and isinstance(part.get('text'), str):
                        parts.append({'type': 'text', 'text': part['text']})
                    elif part.get('type') == 'image_url' and isinstance(part.get('image_url'), dict):
                        url = part['image_url'].get('url', '')
                        if not isinstance(url, str) or not re.fullmatch(r'data:image/(?:png|jpeg|webp|gif);base64,[A-Za-z0-9+/=\r\n]+', url):
                            raise GeminiError(400, 'Use an uploaded PNG, JPEG, WebP or GIF image with Gemini.')
                        parts.append({'type': 'image_url', 'image_url': {'url': url}})
                    else:
                        raise GeminiError(400, 'Unsupported Gemini message content.')
                content = parts
            elif not isinstance(content, str):
                raise GeminiError(400, 'Invalid Gemini message text.')
            clean.append({'role': message['role'], 'content': content})
        payload = {'model': raw['model'], 'messages': clean, 'stream': True, 'stream_options': {'include_usage': True}}
        if raw.get('reasoning_effort') in ('none', 'minimal', 'low', 'medium', 'high'):
            if raw['reasoning_effort'] == 'none' and not raw['model'].startswith('gemini-2.5-'):
                raise GeminiError(400, 'Thinking cannot be disabled for this Gemini model.')
            payload['reasoning_effort'] = raw['reasoning_effort']
        if raw.get('response_format') == {'type': 'json_object'}:
            payload['response_format'] = {'type': 'json_object'}
        if type(raw.get('max_tokens')) is int and 1 <= raw['max_tokens'] <= 65536:
            payload['max_tokens'] = raw['max_tokens']
        return payload

    def handle(self, handler, path, method):
        paths = ('/api/gemini/settings', '/api/gemini/models', '/api/gemini/chat')
        if path not in paths:
            handler.web_json(404, {'error': 'Unknown Gemini endpoint.'})
            return
        peer = ipaddress.ip_address(handler.client_address[0])
        peer = peer.ipv4_mapped if isinstance(peer, ipaddress.IPv6Address) and peer.ipv4_mapped else peer
        expected = f"{'https' if isinstance(handler.connection, ssl.SSLSocket) else 'http'}://{handler.headers.get('Host', '')}"
        if (not peer.is_loopback or urlsplit(expected).hostname not in ('orbit.com', 'localhost', '127.0.0.1', '::1')
                or handler.headers.get('X-Orbit-Gemini') != '1'
                or handler.headers.get('Origin', expected) != expected
                or handler.headers.get('Sec-Fetch-Site') == 'cross-site'):
            handler.web_json(403, {'error': 'Gemini settings and requests are available only in the local Orbit app.'})
            return
        acquired, started, connection = False, False, None
        try:
            if method == 'GET':
                if path.endswith('/settings'):
                    handler.web_json(200, {'configured': bool(self.key())})
                elif path.endswith('/models'):
                    handler.web_json(200, {'data': self.models()})
                else:
                    handler.web_json(405, {'error': 'Use POST for generation.'})
                return
            if path.endswith('/models'):
                raise GeminiError(405, 'Use GET for model discovery.')
            try:
                length = int(handler.headers.get('Content-Length', '0'))
            except ValueError:
                raise GeminiError(400, 'Invalid Gemini request length.')
            limit = 4096 if path.endswith('/settings') else 32 * 1024 * 1024
            if (not 0 < length <= limit or handler.headers.get('Transfer-Encoding')
                    or handler.headers.get('Content-Type', '').split(';')[0] != 'application/json'):
                raise GeminiError(400, 'Invalid Gemini request size or content type.')
            try:
                raw = json.loads(handler.rfile.read(length))
            except (ValueError, UnicodeError):
                raise GeminiError(400, 'Invalid Gemini request JSON.')
            if path.endswith('/settings'):
                if not isinstance(raw, dict) or 'key' not in raw:
                    raise GeminiError(400, 'Expected an API key.')
                self.save(raw['key'])
                handler.web_json(200, {'configured': bool(raw['key'])})
                return
            key = self.key()
            if not key:
                raise GeminiError(401, 'Add your Gemini key in Settings → Models first.')
            payload = self.payload(raw)
            acquired = self.slots.acquire(blocking=False)
            if not acquired:
                raise GeminiError(429, 'Gemini is busy. Wait for the current requests to finish.')
            connection, response = self.connect('POST', '/v1beta/openai/chat/completions', key, payload, timeout=110)
            if 'text/event-stream' not in response.getheader('Content-Type', ''):
                raise GeminiError(502, 'Gemini returned an unexpected response. Please retry.')
            handler.send_response(200)
            handler.send_header('Content-Type', 'text/event-stream; charset=utf-8')
            handler.send_header('Cache-Control', 'no-store')
            handler.send_header('X-Content-Type-Options', 'nosniff')
            handler.end_headers()
            started = True
            while True:
                chunk = response.read1(65536)
                if not chunk:
                    break
                handler.wfile.write(chunk)
                handler.wfile.flush()
        except (GeminiError, OSError, ValueError, TypeError, AttributeError, http.client.HTTPException) as error:
            message = str(error) if isinstance(error, GeminiError) else 'Could not reach Gemini or save its settings. Check your internet connection and local installation.'
            if not started:
                handler.web_json(error.status if isinstance(error, GeminiError) else 502, {'error': message})
            else:
                try:
                    handler.wfile.write(('data: ' + json.dumps({'error': message}) + '\n\n').encode())
                except OSError:
                    pass
        finally:
            if connection:
                connection.close()
            if acquired:
                self.slots.release()
