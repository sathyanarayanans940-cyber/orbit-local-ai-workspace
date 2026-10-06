"""Optional AICredits gateway for the installed, local Orbit server (stdlib only)."""
import http.client
from deepseek import StreamCompletion
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

# Intentionally exact, not a provider-prefix filter: Pro/other models cannot spend this key.
SUPPORTED_MODELS = {'deepseek/deepseek-v4.1-flash': ('DeepSeek V4.1 Flash', True)}
ERRORS = {
    400: 'AICredits could not accept this request. Check the model and attachments.',
    401: 'The AICredits key was rejected. Replace it in Settings → Models.',
    402: 'Your AICredits wallet is too low or this key has reached its budget. Check aicredits.in.',
    403: 'AICredits access was denied. Check your account permissions and region.',
    404: 'DeepSeek V4.1 Flash is unavailable on AICredits. No other model was requested.',
    413: 'This AICredits request is too large. Send fewer or smaller attachments.',
    422: 'AICredits rejected the request parameters. Check your model and attachments.',
    429: 'AICredits’s rate limit was reached. Wait for current requests to finish, then retry.',
    500: 'AICredits encountered a server error. Retry shortly.',
    503: 'AICredits is overloaded. Retry shortly.',
}


class AICreditsError(Exception):
    def __init__(self, status, message):
        self.status = status
        super().__init__(message)


class AICreditsGateway:
    def __init__(self, root):
        if os.name == 'nt':
            # Windows' per-user AppData inherits the user's profile ACL. A
            # shared Program Files directory would expose a new key to users.
            root = Path(os.environ['LOCALAPPDATA']) / 'Orbit'
            root.mkdir(mode=0o700, parents=True, exist_ok=True)
        self.path = Path(root) / '.orbit-aicredits.json'
        self.key_verified = False
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
        if not isinstance(key, str) or (key and not re.fullmatch(r'sk-(?:live-)?[A-Za-z0-9_.-]{16,500}', key)):
            raise AICreditsError(400, 'Paste the complete AICredits API key, without spaces.')
        with self.lock:
            # Restrictive permissions from creation; atomic replace prevents partial keys.
            fd, temporary = tempfile.mkstemp(prefix='.orbit-aicredits-', dir=self.path.parent)
            try:
                with os.fdopen(fd, 'w') as output:
                    json.dump({'key': key}, output)
                os.replace(temporary, self.path)
            finally:
                if os.path.exists(temporary):
                    os.unlink(temporary)
            self.cache = None
            self.key_verified = False
            self.retry_after = 0

    def connect(self, method, path, key, payload=None, timeout=20):
        connection = http.client.HTTPSConnection('api.aicredits.in', timeout=timeout)
        try:
            connection.request(method, path, body=json.dumps(payload) if payload is not None else None,
                               headers={'Content-Type': 'application/json', **({'Authorization': 'Bearer ' + key} if key else {})})
            response = connection.getresponse()
            if response.status != 200:
                status = response.status
                connection.close()
                raise AICreditsError(status if status in ERRORS else 502,
                                  (f'AICredits returned 404 for {path}. Its service endpoint is unavailable.' if status == 404 and path != '/v1/chat/completions' else ERRORS.get(status, 'AICredits is temporarily unavailable. Try again shortly.')))
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
                raise AICreditsError(503, 'AICredits is unavailable. Check your connection or API key and retry shortly.')
            connection = None
            try:
                # The public catalog cannot authenticate a key. Check the free wallet
                # endpoint first; checking settings must never generate paid tokens.
                self.key_verified = False
                try:
                    connection, response = self.connect('GET', '/v1/credits', key, timeout=5)
                except AICreditsError as error:
                    # This documented endpoint currently returns 404 on the live
                    # service. Catalog availability is still useful, but must not
                    # be presented as proof that the stored key is valid.
                    if error.status != 404:
                        raise
                else:
                    credit_data = response.read(65537)
                    if len(credit_data) > 65536 or not isinstance(json.loads(credit_data), dict):
                        raise ValueError('Invalid credit response')
                    self.key_verified = True
                    connection.close()
                connection, response = self.connect('GET', '/api/models', '', timeout=8)
                data = response.read(4 * 1024 * 1024 + 1)
                if len(data) > 4 * 1024 * 1024:
                    raise ValueError('Oversized catalog')
                catalog = json.loads(data).get('data')
                if not isinstance(catalog, list):
                    raise ValueError('Invalid catalog')
                models = []
                for item in catalog[:5000]:
                    if not isinstance(item, dict):
                        continue
                    name = item.get('id')
                    if not isinstance(name, str) or name not in SUPPORTED_MODELS or any(m['id'] == name for m in models):
                        continue
                    label, vision = SUPPORTED_MODELS[name]
                    # Trust advertised modalities when present, including explicit text-only.
                    modalities = item.get('input_modalities')
                    if isinstance(modalities, list):
                        vision = 'image' in modalities
                    models.append({'id': name, 'name': label, 'remote': True,
                                   'capabilities': ['completion', 'thinking'] + (['vision'] if vision else [])})
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
        if not isinstance(raw, dict) or not isinstance(raw.get('model'), str) or raw['model'] not in SUPPORTED_MODELS:
            raise AICreditsError(400, 'This AICredits connection is restricted to DeepSeek V4.1 Flash. No other model is allowed.')
        messages = raw.get('messages')
        if not isinstance(messages, list) or not 1 <= len(messages) <= 1000:
            raise AICreditsError(400, 'AICredits needs a nonempty conversation.')
        clean = []
        image_count = 0
        for message in messages:
            if not isinstance(message, dict) or message.get('role') not in ('system', 'user', 'assistant'):
                raise AICreditsError(400, 'Invalid AICredits message.')
            content = message.get('content')
            if isinstance(content, list):
                parts = []
                for part in content:
                    if not isinstance(part, dict):
                        raise AICreditsError(400, 'Invalid AICredits attachment.')
                    if part.get('type') == 'text' and isinstance(part.get('text'), str):
                        parts.append({'type': 'text', 'text': part['text']})
                    elif part.get('type') == 'image_url' and isinstance(part.get('image_url'), dict):
                        if message['role'] != 'user' or not SUPPORTED_MODELS[raw['model']][1]:
                            raise AICreditsError(400, 'Images must appear in user messages.')
                        url = part['image_url'].get('url', '')
                        if not isinstance(url, str) or not re.fullmatch(r'data:image/(?:png|jpeg|webp|gif);base64,[A-Za-z0-9+/=\r\n]+', url):
                            raise AICreditsError(400, 'Use an uploaded PNG, JPEG, WebP or GIF image with AICredits.')
                        image_count += 1
                        if image_count > 600 or len(url.split(',', 1)[1]) > 44739244:
                            raise AICreditsError(413, 'AICredits accepts at most 600 images, each up to 32 MiB.')
                        parts.append({'type': 'image_url', 'image_url': {'url': url}})
                    else:
                        raise AICreditsError(400, 'Unsupported AICredits message content.')
                content = parts if message['role'] == 'user' else '\n'.join(part['text'] for part in parts)
            elif not isinstance(content, str):
                raise AICreditsError(400, 'Invalid AICredits message text.')
            clean.append({'role': message['role'], 'content': content})
        payload = {'model': raw['model'], 'messages': clean, 'stream': True, 'stream_options': {'include_usage': True}}
        # Use the documented reasoning_effort field, not a native thinking
        # object. Relay acceptance/forwarding still needs live verification.
        if 'reasoning_effort' in raw:
            effort = raw['reasoning_effort']
            if not isinstance(effort, str) or effort not in ('none', 'low', 'high', 'max'):
                raise AICreditsError(400, 'Choose Off, Low, High or Max thinking effort.')
            payload['reasoning_effort'] = effort
        # Avoid semantic cache returning another prompt's near-match answer.
        payload['no_cache'] = True
        if raw.get('response_format') == {'type': 'json_object'}:
            payload['response_format'] = {'type': 'json_object'}
            # JSON mode needs explicit instructions even for callers outside the UI.
            if not any('json' in str(m['content']).lower() for m in clean):
                clean.insert(0, {'role': 'system', 'content': 'Return a valid JSON object.'})
        if 'max_tokens' in raw:
            if type(raw['max_tokens']) is not int or not 1 <= raw['max_tokens'] <= 393216:
                raise AICreditsError(400, 'AICredits max_tokens must be between 1 and 393216.')
            payload['max_tokens'] = raw['max_tokens']
        return payload

    def handle(self, handler, path, method):
        paths = ('/api/aicredits/settings', '/api/aicredits/models', '/api/aicredits/chat')
        if path not in paths:
            handler.web_json(404, {'error': 'Unknown AICredits endpoint.'})
            return
        peer = ipaddress.ip_address(handler.client_address[0])
        peer = peer.ipv4_mapped if isinstance(peer, ipaddress.IPv6Address) and peer.ipv4_mapped else peer
        expected = f"{'https' if isinstance(handler.connection, ssl.SSLSocket) else 'http'}://{handler.headers.get('Host', '')}"
        if (not peer.is_loopback or urlsplit(expected).hostname not in ('orbit.com', 'localhost', '127.0.0.1', '::1')
                or handler.headers.get('X-Orbit-AICredits') != '1'
                or handler.headers.get('Origin', expected) != expected
                or handler.headers.get('Sec-Fetch-Site') == 'cross-site'):
            handler.web_json(403, {'error': 'AICredits settings and requests are available only in the local Orbit app.'})
            return
        acquired, started, connection = False, False, None
        try:
            if method == 'GET':
                if path.endswith('/settings'):
                    handler.web_json(200, {'configured': bool(self.key())})
                elif path.endswith('/models'):
                    models = self.models()
                    handler.web_json(200, {'data': models, 'key_verified': self.key_verified})
                else:
                    handler.web_json(405, {'error': 'Use POST for generation.'})
                return
            if path.endswith('/models'):
                raise AICreditsError(405, 'Use GET for model discovery.')
            try:
                length = int(handler.headers.get('Content-Length', '0'))
            except ValueError:
                raise AICreditsError(400, 'Invalid AICredits request length.')
            limit = 4096 if path.endswith('/settings') else 48 * 4 * 1024 * 1024
            if (not 0 < length <= limit or handler.headers.get('Transfer-Encoding')
                    or handler.headers.get('Content-Type', '').split(';')[0] != 'application/json'):
                raise AICreditsError(400, 'Invalid AICredits request size or content type.')
            try:
                raw = json.loads(handler.rfile.read(length))
            except (ValueError, UnicodeError):
                raise AICreditsError(400, 'Invalid AICredits request JSON.')
            if path.endswith('/settings'):
                if not isinstance(raw, dict) or 'key' not in raw:
                    raise AICreditsError(400, 'Expected an API key.')
                self.save(raw['key'])
                handler.web_json(200, {'configured': bool(raw['key'])})
                return
            key = self.key()
            if not key:
                raise AICreditsError(401, 'Add your AICredits key in Settings → Models first.')
            payload = self.payload(raw)
            acquired = self.slots.acquire(blocking=False)
            if not acquired:
                raise AICreditsError(429, 'AICredits is busy. Wait for the current requests to finish.')
            connection, response = self.connect('POST', '/v1/chat/completions', key, payload, timeout=110)
            if 'text/event-stream' not in response.getheader('Content-Type', ''):
                raise AICreditsError(502, 'AICredits returned an unexpected response. Please retry.')
            handler.send_response(200)
            handler.send_header('Content-Type', 'text/event-stream; charset=utf-8')
            handler.send_header('Cache-Control', 'no-store')
            handler.send_header('X-Content-Type-Options', 'nosniff')
            handler.end_headers()
            started = True
            completion = StreamCompletion(require_usage=True)
            while True:
                try:
                    chunk = response.read1(65536)
                except TimeoutError:
                    if completion.finished:
                        break
                    raise
                if not chunk:
                    break
                handler.wfile.write(chunk)
                handler.wfile.flush()
                if completion.feed(chunk):
                    break
                if completion.finished and getattr(connection, 'sock', None):
                    connection.sock.settimeout(3)
        except (AICreditsError, OSError, ValueError, TypeError, AttributeError, http.client.HTTPException) as error:
            message = str(error) if isinstance(error, AICreditsError) else 'Could not reach AICredits or save its settings. Check your internet connection and local installation.'
            if not started:
                handler.web_json(error.status if isinstance(error, AICreditsError) else 502, {'error': message})
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
