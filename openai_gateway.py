"""Optional OpenAI gateway for the installed, local Orbit server (stdlib only)."""
import codecs
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

# Only documented Responses models are offered; discovery intersects this list
# with the account's live catalog. No arbitrary model aliases or paid upgrades.
SUPPORTED_MODELS = {
    'gpt-6-luna': ('GPT-6 Luna', True),
    'gpt-6.1-sol': ('GPT-6.1 Sol', True),
    'gpt-6-astra': ('GPT-6 Astra', True),
    'gpt-6-sol': ('GPT-6 Sol', True),
}
EFFORTS = ('none', 'low', 'medium', 'high', 'xhigh', 'max')
NO_OFF_MODELS = {'gpt-6-astra', 'gpt-6.1-sol'}

ERRORS = {
    400: 'OpenAI could not accept this request. Check the model and attachments.',
    401: 'The OpenAI key was rejected. Replace it in Settings → Models.',
    402: 'Your OpenAI API balance is insufficient. Check your balance on platform.openai.com.',
    403: 'OpenAI access was denied. Check your account permissions and region.',
    404: 'This OpenAI model is unavailable. Refresh the model list and choose another model.',
    413: 'This OpenAI request is too large. Send fewer or smaller attachments.',
    422: 'OpenAI rejected the request parameters. Check your model and attachments.',
    429: 'OpenAI’s rate limit was reached. Wait for current requests to finish, then retry.',
    500: 'OpenAI encountered a server error. Retry shortly.',
    503: 'OpenAI is overloaded. Retry shortly.',
}


class OpenAIError(Exception):
    def __init__(self, status, message):
        self.status = status
        super().__init__(message)


def error_message(status=502, code=None):
    if code in ('insufficient_quota', 'billing_hard_limit_reached', 'billing_not_active'):
        return 'OpenAI API credits or spending limit are exhausted. Check API billing; a ChatGPT subscription does not include API usage.'
    if code in ('context_length_exceeded', 'max_tokens_exceeded'):
        return 'This conversation exceeds the OpenAI model’s context limit. Start a new chat or send fewer attachments.'
    if code in ('model_not_found', 'model_not_available'):
        return ERRORS[404]
    if code in ('invalid_api_key', 'authentication_error'):
        return ERRORS[401]
    if code in ('rate_limit_exceeded', 'rate_limit_error'):
        return ERRORS[429]
    return ERRORS.get(status, 'OpenAI could not complete this response. Partial text was kept; retry manually.')


def normalized_usage(usage):
    if not isinstance(usage, dict):
        return None  # Missing measurements must not become invented zeroes.
    def count(value):
        return value if type(value) is int and value >= 0 else None
    result = {}
    for source, target in (('input_tokens', 'prompt_tokens'), ('output_tokens', 'completion_tokens'), ('total_tokens', 'total_tokens')):
        value = count(usage.get(source))
        if value is not None:
            result[target] = value
    for source, target, field in (('input_tokens_details', 'prompt_tokens_details', 'cached_tokens'), ('output_tokens_details', 'completion_tokens_details', 'reasoning_tokens')):
        detail = usage.get(source)
        value = count(detail.get(field)) if isinstance(detail, dict) else None
        if value is not None:
            result[target] = {field: value}
    return result or None


class ResponsesStream:
    """Incremental native Responses SSE → Orbit's existing chat stream contract."""
    def __init__(self):
        self.decoder = codecs.getincrementaldecoder('utf-8')('strict')
        self.buffer = ''
        self.skip_lf = False
        self.finished = False

    def feed(self, chunk):
        if self.finished:
            return
        text = self.decoder.decode(chunk)
        if text:
            if self.skip_lf and text.startswith('\n'):
                text = text[1:]
            self.skip_lf = text.endswith('\r')
        self.buffer += text.replace('\r\n', '\n').replace('\r', '\n')
        while '\n\n' in self.buffer:
            event, self.buffer = self.buffer.split('\n\n', 1)
            if len(event) > 2 * 1024 * 1024:
                raise OpenAIError(502, 'OpenAI sent an oversized stream event.')
            lines = [line[5:].lstrip(' ') for line in event.split('\n') if line.startswith('data:')]
            if not lines:
                continue
            try:
                data = json.loads('\n'.join(lines))
                if not isinstance(data, dict):
                    raise ValueError()
            except ValueError:
                raise OpenAIError(502, 'OpenAI sent malformed stream data. Partial text was kept; retry manually.')
            kind = data.get('type')
            if kind in ('response.output_text.delta', 'response.refusal.delta'):
                delta = data.get('delta')
                if not isinstance(delta, str):
                    raise OpenAIError(502, 'OpenAI sent an invalid text event.')
                yield {'choices': [{'delta': {'content': delta}}]}
            elif kind == 'response.output_item.added' and isinstance(data.get('item'), dict) and data['item'].get('type') == 'reasoning':
                yield {'orbit_thinking': True, 'choices': []}
            elif kind in ('response.completed', 'response.incomplete', 'response.failed'):
                response = data.get('response')
                if not isinstance(response, dict):
                    raise OpenAIError(502, 'OpenAI sent an invalid completion event.')
                usage = normalized_usage(response.get('usage'))
                if usage is not None:
                    yield {'usage': usage, 'choices': []}
                if kind == 'response.failed':
                    error = response.get('error')
                    raise OpenAIError(502, error_message(code=error.get('code') if isinstance(error, dict) else None))
                reason = 'stop'
                if kind == 'response.incomplete':
                    detail = response.get('incomplete_details')
                    incomplete = detail.get('reason') if isinstance(detail, dict) else None
                    reason = {'max_output_tokens': 'length', 'content_filter': 'content_filter'}.get(incomplete)
                    if not reason:
                        raise OpenAIError(502, 'OpenAI returned an incomplete answer. Partial text was kept; retry manually.')
                self.finished = True
                yield {'choices': [{'delta': {}, 'finish_reason': reason}]}
                return
            elif kind == 'error':
                raise OpenAIError(502, error_message(code=data.get('code')))
            # Done/item events duplicate deltas. Never append them a second time.
        if len(self.buffer) > 2 * 1024 * 1024:
            raise OpenAIError(502, 'OpenAI sent an oversized stream event.')


class OpenAIGateway:
    def __init__(self, root):
        if os.name == 'nt':
            # Windows' per-user AppData inherits the user's profile ACL. A
            # shared Program Files directory would expose a new key to users.
            root = Path(os.environ['LOCALAPPDATA']) / 'Orbit'
            root.mkdir(mode=0o700, parents=True, exist_ok=True)
        self.path = Path(root) / '.orbit-openai.json'
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
            raise OpenAIError(400, 'Paste the complete OpenAI API key, without spaces.')
        with self.lock:
            # Restrictive permissions from creation; atomic replace prevents partial keys.
            fd, temporary = tempfile.mkstemp(prefix='.orbit-openai-', dir=self.path.parent)
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
        connection = http.client.HTTPSConnection('api.openai.com', timeout=timeout)
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
                try:
                    body = json.loads(response.read(65537))
                    error = body.get('error', {})
                    code = error.get('code') or error.get('type')
                except (ValueError, AttributeError, OSError):
                    code = None
                connection.close()
                raise OpenAIError(status if status in ERRORS else 502, error_message(status, code))
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
                    raise OpenAIError(503, 'OpenAI is unavailable. Check your connection or API key and retry shortly.')
                version = self.configuration_version
            connection = None
            try:
                connection, response = self.connect('GET', '/v1/models', key, timeout=8)
                data = response.read(1024 * 1024 + 1)
                if len(data) > 1024 * 1024:
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
                                   'capabilities': ['thinking'] + (['vision'] if vision else []),
                                   'reasoning_efforts': [e for e in EFFORTS if e != 'none' or name not in NO_OFF_MODELS]})
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
            raise OpenAIError(400, 'Choose an available OpenAI model from the model picker.')
        messages = raw.get('messages')
        if not isinstance(messages, list) or not 1 <= len(messages) <= 1000:
            raise OpenAIError(400, 'OpenAI needs a nonempty conversation.')
        clean, image_count = [], 0
        for message in messages:
            if not isinstance(message, dict) or message.get('role') not in ('system', 'user', 'assistant'):
                raise OpenAIError(400, 'Invalid OpenAI message.')
            content = message.get('content')
            if isinstance(content, list):
                parts = []
                for part in content:
                    if not isinstance(part, dict):
                        raise OpenAIError(400, 'Invalid OpenAI attachment.')
                    if part.get('type') == 'text' and isinstance(part.get('text'), str):
                        parts.append({'type': 'input_text', 'text': part['text']})
                    elif part.get('type') == 'image_url' and isinstance(part.get('image_url'), dict):
                        url = part['image_url'].get('url', '')
                        if message['role'] != 'user' or not isinstance(url, str) or not re.fullmatch(r'data:image/(?:png|jpeg|webp|gif);base64,[A-Za-z0-9+/=]+', url):
                            raise OpenAIError(400, 'Use an uploaded PNG, JPEG, WebP or GIF in a user message.')
                        image_count += 1
                        if image_count > 500 or len(url) > 28 * 1024 * 1024:
                            raise OpenAIError(413, 'Too many or oversized OpenAI image attachments.')
                        parts.append({'type': 'input_image', 'image_url': url, 'detail': 'auto'})
                    else:
                        raise OpenAIError(400, 'Unsupported OpenAI message content.')
                # Easy input messages accept a text string for any chat role.
                content = parts if message['role'] == 'user' else '\n'.join(p['text'] for p in parts)
            elif not isinstance(content, str):
                raise OpenAIError(400, 'Invalid OpenAI message text.')
            clean.append({'role': message['role'], 'content': content})
        effort = raw.get('reasoning_effort', 'medium')
        if effort not in EFFORTS or (effort == 'none' and raw['model'] in NO_OFF_MODELS):
            raise OpenAIError(400, 'That thinking level is not supported by the selected OpenAI model.')
        limit = raw.get('max_tokens', 65536)
        if type(limit) is not int or not 16 <= limit <= 128000:
            raise OpenAIError(400, 'OpenAI output limit must be between 16 and 128000 tokens.')
        payload = {'model': raw['model'], 'input': clean, 'stream': True,
                   'store': False, 'service_tier': 'default',
                   'reasoning': {'effort': effort}, 'max_output_tokens': limit}
        if raw.get('response_format') == {'type': 'json_object'}:
            payload['text'] = {'format': {'type': 'json_object'}}
            if not any('json' in str(m['content']).lower() for m in clean):
                clean.insert(0, {'role': 'system', 'content': 'Return a valid JSON object.'})
        # Never forward arbitrary tools, temperature, storage, URLs or credentials.
        # Orbit's existing Analyze, web and file workflows consume text/JSON.
        return payload

    def handle(self, handler, path, method):
        paths = ('/api/openai/settings', '/api/openai/models', '/api/openai/chat')
        if path not in paths:
            handler.web_json(404, {'error': 'Unknown OpenAI endpoint.'})
            return
        peer = ipaddress.ip_address(handler.client_address[0])
        peer = peer.ipv4_mapped if isinstance(peer, ipaddress.IPv6Address) and peer.ipv4_mapped else peer
        expected = f"{'https' if isinstance(handler.connection, ssl.SSLSocket) else 'http'}://{handler.headers.get('Host', '')}"
        if (not peer.is_loopback or urlsplit(expected).hostname not in ('orbit.com', 'localhost', '127.0.0.1', '::1')
                or handler.headers.get('X-Orbit-OpenAI') != '1'
                or handler.headers.get('Origin', expected) != expected
                or handler.headers.get('Sec-Fetch-Site') == 'cross-site'):
            handler.web_json(403, {'error': 'OpenAI settings and requests are available only in the local Orbit app.'})
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
                raise OpenAIError(405, 'Use GET for model discovery.')
            try:
                length = int(handler.headers.get('Content-Length', '0'))
            except ValueError:
                raise OpenAIError(400, 'Invalid OpenAI request length.')
            limit = 4096 if path.endswith('/settings') else 48 * 1024 * 1024
            if (not 0 < length <= limit or handler.headers.get('Transfer-Encoding')
                    or handler.headers.get('Content-Type', '').split(';')[0] != 'application/json'):
                raise OpenAIError(400, 'Invalid OpenAI request size or content type.')
            try:
                raw = json.loads(handler.rfile.read(length))
            except (ValueError, UnicodeError):
                raise OpenAIError(400, 'Invalid OpenAI request JSON.')
            if path.endswith('/settings'):
                if not isinstance(raw, dict) or 'key' not in raw:
                    raise OpenAIError(400, 'Expected an API key.')
                self.save(raw['key'])
                handler.web_json(200, {'configured': bool(raw['key'])})
                return
            key = self.key()
            if not key:
                raise OpenAIError(401, 'Add your OpenAI key in Settings → Models first.')
            payload = self.payload(raw)
            acquired = self.slots.acquire(blocking=False)
            if not acquired:
                raise OpenAIError(429, 'OpenAI is busy. Wait for the current requests to finish.')
            connection, response = self.connect('POST', '/v1/responses', key, payload, timeout=110)
            if 'text/event-stream' not in response.getheader('Content-Type', ''):
                raise OpenAIError(502, 'OpenAI returned an unexpected response. Please retry.')
            handler.send_response(200)
            handler.send_header('Content-Type', 'text/event-stream; charset=utf-8')
            handler.send_header('Cache-Control', 'no-store')
            handler.send_header('X-Content-Type-Options', 'nosniff')
            timing = getattr(connection, 'orbit_timing', None)
            if isinstance(timing, dict):
                handler.send_header('Server-Timing', ', '.join(
                    f'openai_{phase};dur={timing[phase]:.1f}'
                    for phase in ('connect', 'headers')
                    if isinstance(timing.get(phase), (int, float)) and timing[phase] >= 0))
            handler.end_headers()
            started = True
            stream = ResponsesStream()
            while not stream.finished:
                chunk = response.read1(65536)
                if not chunk:
                    raise OpenAIError(502, 'OpenAI ended the stream before completion. Partial text was kept; retry manually.')
                for packet in stream.feed(chunk):
                    handler.wfile.write(('data: ' + json.dumps(packet) + '\n\n').encode())
                    handler.wfile.flush()
                # Preserve liveness during provider heartbeats and non-text events.
                handler.wfile.write(b': activity\n\n')
                handler.wfile.flush()
            handler.wfile.write(b'data: [DONE]\n\n')
            handler.wfile.flush()
        except (OpenAIError, OSError, ValueError, TypeError, AttributeError, http.client.HTTPException) as error:
            message = str(error) if isinstance(error, OpenAIError) else 'Could not reach OpenAI or save its settings. Check your internet connection and local installation.'
            if not started:
                handler.web_json(error.status if isinstance(error, OpenAIError) else 502, {'error': message})
            else:
                try:
                    handler.wfile.write(('data: ' + json.dumps({'error': message, 'retryable': False}) + '\n\n').encode())
                except OSError:
                    pass
        finally:
            if connection:
                connection.close()
            if acquired:
                self.slots.release()
