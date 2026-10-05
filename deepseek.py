"""Optional DeepSeek gateway for the installed, local Orbit server (stdlib only)."""
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

# Canonical contracts verified against DeepSeek's docs on 2026-10-01.
# Discovery intersects these with the live catalog; retired aliases are not offered.
SUPPORTED_MODELS = {'deepseek-flash': ('DeepSeek V4.1 Flash', True),
                    'deepseek-v4-pro': ('DeepSeek V4 Pro', False)}
ERRORS = {
    400: 'DeepSeek could not accept this request. Check the model and attachments.',
    401: 'The DeepSeek key was rejected. Replace it in Settings → Models.',
    402: 'Your DeepSeek API balance is insufficient. Check your balance on platform.deepseek.com.',
    403: 'DeepSeek access was denied. Check your account permissions and region.',
    404: 'This DeepSeek model is unavailable. Refresh the model list and choose another model.',
    413: 'This DeepSeek request is too large. Send fewer or smaller attachments.',
    422: 'DeepSeek rejected the request parameters. Check your model and attachments.',
    429: 'DeepSeek’s rate limit was reached. Wait for current requests to finish, then retry.',
    500: 'DeepSeek encountered a server error. Retry shortly.',
    503: 'DeepSeek is overloaded. Retry shortly.',
}


class DeepSeekError(Exception):
    def __init__(self, status, message):
        self.status = status
        super().__init__(message)


class StreamCompletion:
    """Recognize SSE completion without buffering the answer or waiting for EOF."""
    def __init__(self, require_usage=False):
        self.buffer = b''
        self.data = []
        self.size = 0
        self.skip_lf = False
        self.require_usage = require_usage
        self.finished = False
        self.has_usage = False

    def feed(self, chunk):
        if chunk:
            if self.skip_lf and chunk.startswith(b'\n'):
                chunk = chunk[1:]
            self.skip_lf = chunk.endswith(b'\r')
        self.buffer += chunk
        lines = re.split(br'\r\n|\r|\n', self.buffer)
        self.buffer = lines.pop()
        if len(self.buffer) > 2 * 1024 * 1024:
            self.buffer = b''  # The browser reports malformed oversized events.
        for line in lines:
            if line.startswith(b'data:'):
                value = line[5:].lstrip()
                self.size += len(value)
                if self.size <= 2 * 1024 * 1024:
                    self.data.append(value)
            elif not line:
                event = b'\n'.join(self.data)
                self.data, self.size = [], 0
                if event == b'[DONE]':
                    return True
                try:
                    packet = json.loads(event)
                    choices = packet.get('choices') if isinstance(packet, dict) else None
                    usage = packet.get('usage') if isinstance(packet, dict) else None
                    if isinstance(usage, dict) and any(type(usage.get(k)) is int and usage[k] >= 0 for k in ('total_tokens', 'prompt_tokens', 'completion_tokens')):
                        self.has_usage = True
                    if isinstance(choices, list) and any(
                            isinstance(choice, dict) and choice.get('finish_reason') for choice in choices):
                        self.finished = True
                    if self.finished and (not self.require_usage or self.has_usage):
                        return True
                except (ValueError, TypeError):
                    pass  # Pass through; the existing browser validator handles errors.
        return False


class DeepSeekGateway:
    def __init__(self, root):
        if os.name == 'nt':
            # Windows' per-user AppData inherits the user's profile ACL. A
            # shared Program Files directory would expose a new key to users.
            root = Path(os.environ['LOCALAPPDATA']) / 'Orbit'
            root.mkdir(mode=0o700, parents=True, exist_ok=True)
        self.path = Path(root) / '.orbit-deepseek.json'
        self.lock = threading.RLock()
        self.catalog_lock = threading.Lock()
        self.configuration_version = 0
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
            raise DeepSeekError(400, 'Paste the complete DeepSeek API key, without spaces.')
        with self.lock:
            # Restrictive permissions from creation; atomic replace prevents partial keys.
            fd, temporary = tempfile.mkstemp(prefix='.orbit-deepseek-', dir=self.path.parent)
            try:
                with os.fdopen(fd, 'w') as output:
                    json.dump({'key': key}, output)
                os.replace(temporary, self.path)
            finally:
                if os.path.exists(temporary):
                    os.unlink(temporary)
            self.cache = None
            self.retry_after = 0
            self.configuration_version += 1

    def connect(self, method, path, key, payload=None, timeout=20):
        connection = http.client.HTTPSConnection('api.deepseek.com', timeout=timeout)
        try:
            started = time.perf_counter()
            connection.connect()
            connected = time.perf_counter()
            connection.request(method, path, body=json.dumps(payload) if payload is not None else None,
                               headers={'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json'})
            response = connection.getresponse()
            connection.orbit_timing = {'connect': (connected - started) * 1000,
                                       'headers': (time.perf_counter() - connected) * 1000}
            if response.status != 200:
                status = response.status
                connection.close()
                raise DeepSeekError(status if status in ERRORS else 502,
                                  ERRORS.get(status, 'DeepSeek is temporarily unavailable. Try again shortly.'))
            return connection, response
        except Exception:
            connection.close()
            raise

    def models(self):
        # Serialize catalog refreshes, but never hold the credential lock during
        # an upstream network wait: chat and settings must remain responsive.
        with self.catalog_lock:
            with self.lock:
                key = self.key()
                if not key:
                    return []
                if self.cache and self.cache[0] > time.monotonic():
                    return self.cache[1]
                if self.retry_after > time.monotonic():
                    raise DeepSeekError(503, 'DeepSeek is unavailable. Check your connection or API key and retry shortly.')
                version = self.configuration_version
            connection = None
            try:
                connection, response = self.connect('GET', '/models', key, timeout=8)
                data = response.read(1024 * 1024 + 1)
                if len(data) > 1024 * 1024:
                    raise ValueError('Oversized catalog')
                catalog = json.loads(data).get('data')
                if not isinstance(catalog, list):
                    raise ValueError('Invalid catalog')
                models = []
                for item in catalog[:500]:
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
                                   'capabilities': ['thinking'] + (['vision'] if vision else [])})
                with self.lock:
                    if version != self.configuration_version or key != self.key():
                        return []  # Do not publish a previous key's late catalog.
                    self.cache = (time.monotonic() + 300, models)
                    self.retry_after = 0
                return models
            except Exception:
                with self.lock:
                    if version == self.configuration_version:
                        self.retry_after = time.monotonic() + 30
                raise
            finally:
                if connection:
                    connection.close()

    def payload(self, raw):
        if not isinstance(raw, dict) or not isinstance(raw.get('model'), str) or raw['model'] not in SUPPORTED_MODELS:
            raise DeepSeekError(400, 'Choose one of Orbit’s available DeepSeek models.')
        messages = raw.get('messages')
        if not isinstance(messages, list) or not 1 <= len(messages) <= 1000:
            raise DeepSeekError(400, 'DeepSeek needs a nonempty conversation.')
        clean = []
        image_count = 0
        for message in messages:
            if not isinstance(message, dict) or message.get('role') not in ('system', 'user', 'assistant'):
                raise DeepSeekError(400, 'Invalid DeepSeek message.')
            content = message.get('content')
            if isinstance(content, list):
                parts = []
                for part in content:
                    if not isinstance(part, dict):
                        raise DeepSeekError(400, 'Invalid DeepSeek attachment.')
                    if part.get('type') == 'text' and isinstance(part.get('text'), str):
                        parts.append({'type': 'text', 'text': part['text']})
                    elif part.get('type') == 'image_url' and isinstance(part.get('image_url'), dict):
                        if message['role'] != 'user' or not SUPPORTED_MODELS[raw['model']][1]:
                            raise DeepSeekError(400, 'Images require DeepSeek Flash and must appear in user messages.')
                        url = part['image_url'].get('url', '')
                        if not isinstance(url, str) or not re.fullmatch(r'data:image/(?:png|jpeg|webp|gif);base64,[A-Za-z0-9+/=\r\n]+', url):
                            raise DeepSeekError(400, 'Use an uploaded PNG, JPEG, WebP or GIF image with DeepSeek.')
                        image_count += 1
                        if image_count > 600 or len(url.split(',', 1)[1]) > 44739244:
                            raise DeepSeekError(413, 'DeepSeek accepts at most 600 images, each up to 32 MiB.')
                        parts.append({'type': 'image_url', 'image_url': {'url': url}})
                    else:
                        raise DeepSeekError(400, 'Unsupported DeepSeek message content.')
                content = parts if message['role'] == 'user' else '\n'.join(part['text'] for part in parts)
            elif not isinstance(content, str):
                raise DeepSeekError(400, 'Invalid DeepSeek message text.')
            clean.append({'role': message['role'], 'content': content})
        payload = {'model': raw['model'], 'messages': clean, 'stream': True, 'stream_options': {'include_usage': True}}
        thinking = raw.get('thinking', {'type': 'enabled'})
        if thinking not in ({'type': 'enabled'}, {'type': 'disabled'}):
            raise DeepSeekError(400, 'Invalid DeepSeek thinking mode.')
        payload['thinking'] = thinking
        effort = raw.get('reasoning_effort', 'high')
        if effort not in ('low', 'high', 'max'):
            raise DeepSeekError(400, 'Choose Low, High or Max DeepSeek thinking effort.')
        if thinking['type'] == 'enabled':
            payload['reasoning_effort'] = effort
        if raw.get('response_format') == {'type': 'json_object'}:
            payload['response_format'] = {'type': 'json_object'}
            # JSON mode needs explicit instructions even for callers outside the UI.
            if not any('json' in str(m['content']).lower() for m in clean):
                clean.insert(0, {'role': 'system', 'content': 'Return a valid JSON object.'})
        if 'max_tokens' in raw:
            if type(raw['max_tokens']) is not int or not 1 <= raw['max_tokens'] <= 393216:
                raise DeepSeekError(400, 'DeepSeek max_tokens must be between 1 and 393216.')
            payload['max_tokens'] = raw['max_tokens']
        return payload

    def handle(self, handler, path, method):
        paths = ('/api/deepseek/settings', '/api/deepseek/models', '/api/deepseek/chat')
        if path not in paths:
            handler.web_json(404, {'error': 'Unknown DeepSeek endpoint.'})
            return
        peer = ipaddress.ip_address(handler.client_address[0])
        peer = peer.ipv4_mapped if isinstance(peer, ipaddress.IPv6Address) and peer.ipv4_mapped else peer
        expected = f"{'https' if isinstance(handler.connection, ssl.SSLSocket) else 'http'}://{handler.headers.get('Host', '')}"
        if (not peer.is_loopback or urlsplit(expected).hostname not in ('orbit.com', 'localhost', '127.0.0.1', '::1')
                or handler.headers.get('X-Orbit-DeepSeek') != '1'
                or handler.headers.get('Origin', expected) != expected
                or handler.headers.get('Sec-Fetch-Site') == 'cross-site'):
            handler.web_json(403, {'error': 'DeepSeek settings and requests are available only in the local Orbit app.'})
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
                raise DeepSeekError(405, 'Use GET for model discovery.')
            try:
                length = int(handler.headers.get('Content-Length', '0'))
            except ValueError:
                raise DeepSeekError(400, 'Invalid DeepSeek request length.')
            limit = 4096 if path.endswith('/settings') else 48 * 1024 * 1024
            if (not 0 < length <= limit or handler.headers.get('Transfer-Encoding')
                    or handler.headers.get('Content-Type', '').split(';')[0] != 'application/json'):
                raise DeepSeekError(400, 'Invalid DeepSeek request size or content type.')
            try:
                raw = json.loads(handler.rfile.read(length))
            except (ValueError, UnicodeError):
                raise DeepSeekError(400, 'Invalid DeepSeek request JSON.')
            if path.endswith('/settings'):
                if not isinstance(raw, dict) or 'key' not in raw:
                    raise DeepSeekError(400, 'Expected an API key.')
                self.save(raw['key'])
                handler.web_json(200, {'configured': bool(raw['key'])})
                return
            key = self.key()
            if not key:
                raise DeepSeekError(401, 'Add your DeepSeek key in Settings → Models first.')
            payload = self.payload(raw)
            acquired = self.slots.acquire(blocking=False)
            if not acquired:
                raise DeepSeekError(429, 'DeepSeek is busy. Wait for the current requests to finish.')
            connection, response = self.connect('POST', '/chat/completions', key, payload, timeout=110)
            if 'text/event-stream' not in response.getheader('Content-Type', ''):
                raise DeepSeekError(502, 'DeepSeek returned an unexpected response. Please retry.')
            handler.send_response(200)
            handler.send_header('Content-Type', 'text/event-stream; charset=utf-8')
            handler.send_header('Cache-Control', 'no-store')
            handler.send_header('X-Content-Type-Options', 'nosniff')
            timing = getattr(connection, 'orbit_timing', None)
            if isinstance(timing, dict):
                handler.send_header('Server-Timing', ', '.join(
                    f'deepseek_{phase};dur={timing[phase]:.1f}'
                    for phase in ('connect', 'headers')
                    if isinstance(timing.get(phase), (int, float)) and timing[phase] >= 0))
            handler.end_headers()
            started = True
            completion = StreamCompletion(require_usage=True)
            while True:
                try:
                    chunk = response.read1(65536)
                except TimeoutError:
                    if completion.finished:
                        break  # A completed answer can omit usage; never invent it.
                    raise
                if not chunk:
                    break
                handler.wfile.write(chunk)
                handler.wfile.flush()
                if completion.feed(chunk):
                    break
                if completion.finished and getattr(connection, 'sock', None):
                    connection.sock.settimeout(3)
        except (DeepSeekError, OSError, ValueError, TypeError, AttributeError, http.client.HTTPException) as error:
            message = str(error) if isinstance(error, DeepSeekError) else 'Could not reach DeepSeek or save its settings. Check your internet connection and local installation.'
            if not started:
                handler.web_json(error.status if isinstance(error, DeepSeekError) else 502, {'error': message})
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
