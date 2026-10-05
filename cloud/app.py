"""Single-owner Orbit Cloud gateway. Run behind a hosting provider's HTTPS proxy."""
from collections import deque
from datetime import timedelta
from pathlib import Path
import hashlib
import hmac
import json
import os
import secrets
import threading
import time
from urllib.parse import urlsplit

from flask import Flask, Response, abort, jsonify, redirect, render_template, request, send_from_directory, session
import requests
from werkzeug.exceptions import HTTPException
from werkzeug.security import check_password_hash, generate_password_hash
from server import public_web_url, web_payload, clean_web_results, public_web_fallback, WebRelayBackoff, VoiceInternetProbe, WEB_SEARCH_TIMEOUT, WEB_FETCH_TIMEOUT


def create_app(config=None):
    app = Flask(__name__, static_folder=None)
    app.config.update(
        SECRET_KEY=os.environ.get('ORBIT_SESSION_SECRET', ''),
        ORBIT_PASSWORD=os.environ.get('ORBIT_PASSWORD', ''),
        OLLAMA_API_KEY=os.environ.get('OLLAMA_API_KEY', ''),
        PUBLIC_ORIGIN=os.environ.get('ORBIT_PUBLIC_ORIGIN') or
            ('https://' + os.environ['RENDER_EXTERNAL_HOSTNAME'] if os.environ.get('RENDER_EXTERNAL_HOSTNAME') else ''),
        PUBLIC_DIR=str(Path(__file__).resolve().parent.parent / 'public'),
        SESSION_COOKIE_NAME='__Host-orbit', SESSION_COOKIE_SECURE=True,
        SESSION_COOKIE_HTTPONLY=True, SESSION_COOKIE_SAMESITE='Strict',
        PERMANENT_SESSION_LIFETIME=timedelta(days=7), SESSION_REFRESH_EACH_REQUEST=False,
        MAX_CONTENT_LENGTH=32 * 1024 * 1024, MAX_FORM_MEMORY_SIZE=8192,
    )
    if config:
        app.config.update(config)
    if len(app.config['SECRET_KEY']) < 32 or not 8 <= len(app.config['ORBIT_PASSWORD']) <= 1024 or not app.config['OLLAMA_API_KEY'].strip():
        raise RuntimeError('Set OLLAMA_API_KEY, ORBIT_PASSWORD (8+ characters), and ORBIT_SESSION_SECRET (32+ characters) in the hosting secret settings.')
    origin = app.config['PUBLIC_ORIGIN'].rstrip('/')
    parsed = urlsplit(origin)
    if parsed.scheme != 'https' or not parsed.hostname or parsed.path or parsed.query or parsed.fragment or parsed.username or parsed.password:
        raise RuntimeError('Set ORBIT_PUBLIC_ORIGIN to the exact HTTPS site origin, without a path.')
    password_hash = generate_password_hash(app.config['ORBIT_PASSWORD'])
    auth_version = hmac.new(app.config['SECRET_KEY'].encode(), app.config['ORBIT_PASSWORD'].encode(), hashlib.sha256).hexdigest()
    app.config.pop('ORBIT_PASSWORD')
    public = Path(app.config['PUBLIC_DIR']).resolve()
    attempts, attempt_lock = deque(), threading.Lock()
    chat_slots, web_slots = threading.BoundedSemaphore(4), threading.BoundedSemaphore(3)
    web_backoff = WebRelayBackoff()
    model_cache, cache_lock = {'at': 0, 'data': None}, threading.Lock()

    def authenticated():
        return hmac.compare_digest(str(session.get('auth', '')), auth_version)

    @app.before_request
    def guard():
        if request.path == '/healthz' and request.method in ('GET', 'HEAD'):
            return None
        # Trust a configured origin, never user-supplied forwarding/Host headers.
        if request.host.lower() != parsed.netloc.lower():
            abort(400)
        if request.method not in ('GET', 'HEAD', 'OPTIONS'):
            if request.headers.get('Origin') != origin or request.headers.get('Sec-Fetch-Site') == 'cross-site':
                abort(403)
        if request.path not in ('/login', '/login.css', '/icon.svg') and not authenticated():
            if request.path.startswith('/api/'):
                return jsonify(error='Your session expired. Sign in again.', code='login_required'), 401
            return redirect('/login', code=303)

    @app.after_request
    def headers(response):
        response.headers['Cache-Control'] = 'no-store'
        response.headers['X-Content-Type-Options'] = 'nosniff'
        response.headers['X-Frame-Options'] = 'DENY'
        response.headers['Referrer-Policy'] = 'same-origin'
        response.headers['Strict-Transport-Security'] = 'max-age=31536000'
        # Widget previews use blob frames and inline styles; connections only to this gateway.
        response.headers['Content-Security-Policy'] = "default-src 'self'; script-src 'self' https://cdnjs.cloudflare.com 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self' https://cdnjs.cloudflare.com blob: data:; frame-src 'self' blob:; worker-src 'self' blob:; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'"
        if request.path == '/analyze-sandbox.html' and response.status_code in (200, 304):
            # Separate opaque-origin document. The app itself retains its strict CSP.
            response.headers.pop('X-Frame-Options', None)
            response.headers['Content-Security-Policy'] = "sandbox allow-scripts; default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval' blob:; worker-src blob:; connect-src 'none'; frame-src 'none'; form-action 'none'; base-uri 'none'; frame-ancestors 'self'"
        return response

    @app.errorhandler(HTTPException)
    def http_error(error):
        if request.path.startswith('/api/'):
            return jsonify(error=error.description), error.code
        return error

    @app.get('/healthz')
    def health():
        return jsonify(status='ok')

    voice_internet = VoiceInternetProbe()

    @app.get('/api/voice/connectivity')
    def voice_connectivity():
        if request.headers.get('X-Orbit-Voice') != '1':
            abort(403)
        return jsonify(online=voice_internet.check())

    @app.route('/login', methods=['GET', 'POST'])
    def login():
        error = ''
        status = 200
        if request.method == 'POST':
            if not session.get('csrf') or not hmac.compare_digest(str(session['csrf']).encode(), request.form.get('csrf', '').encode()):
                abort(403)
            with attempt_lock:
                now = time.monotonic()
                while attempts and now - attempts[0] > 300:
                    attempts.popleft()
                limited = len(attempts) >= 20
                if not limited:
                    attempts.append(now)
            if limited:
                error, status = 'Too many attempts. Wait five minutes and try again.', 429
            elif check_password_hash(password_hash, request.form.get('password', '')[:1024]):
                session.clear()
                session.update(auth=auth_version, csrf=secrets.token_urlsafe(32))
                session.permanent = True
                return redirect('/', code=303)
            else:
                error, status = 'That password did not match. Try again.', 401
        session.setdefault('csrf', secrets.token_urlsafe(32))
        return render_template('login.html', error=error, csrf=session['csrf']), status

    @app.post('/logout')
    def logout():
        if not hmac.compare_digest(str(session.get('csrf', '')).encode(), request.form.get('csrf', '').encode()):
            abort(403)
        session.clear()
        return redirect('/login', code=303)

    @app.get('/login.css')
    def login_css():
        return send_from_directory(Path(__file__).parent, 'login.css')

    @app.get('/cloud-config.js')
    def cloud_config():
        # Deliberately no API key or password in browser config.
        return Response('window.ORBIT_CLOUD = true;', mimetype='application/javascript')

    @app.get('/cloud-ui.js')
    def cloud_ui():
        return send_from_directory(Path(__file__).parent, 'ui.js')

    @app.get('/')
    @app.get('/index.html')
    def index():
        html = (public / 'index.html').read_text()
        html = html.replace('</head>', '<script src="/cloud-config.js"></script></head>')
        html = html.replace('</body>', '<script src="/cloud-ui.js"></script></body>')
        html = html.replace('A private local AI workspace for Ollama and LM Studio.', 'Your personal Orbit workspace with Ollama Cloud.')
        html = html.replace('Orbit — Local AI workspace', 'Orbit — Cloud workspace')
        html = html.replace('Message your local model', 'Message your cloud model')
        html = html.replace('Local models run on your machine. Responses may still be inaccurate.', 'Models run on Ollama Cloud. Responses may still be inaccurate.')
        # Token originates from our session, never from a model or document.
        form = '<form action="/logout" method="post"><input type="hidden" name="csrf" value="' + session['csrf'] + '"><button class="account-menu-item" type="submit" role="menuitem">Sign out</button></form>'
        html = html.replace('<div class="account-menu-title"', form + '<div class="account-menu-title"', 1)
        return Response(html, mimetype='text/html')

    @app.get('/manifest.webmanifest')
    def manifest():
        data = json.loads((public / 'manifest.webmanifest').read_text())
        data.update(name='Orbit', description='Your personal Orbit cloud workspace')
        return jsonify(data)

    @app.get('/<path:asset>')
    def assets(asset):
        target = (public / asset).resolve()
        analyze_data = asset.startswith('vendor/analyze/') and target.suffix.lower() in {'.json', '.zip', '.whl'}
        if not target.is_relative_to(public) or any(part.startswith('.') for part in Path(asset).parts) or (target.suffix.lower() not in {'.js', '.mjs', '.css', '.svg', '.woff2', '.ttf', '.otf', '.pfb', '.bcmap', '.wasm'} and not analyze_data and asset != 'analyze-sandbox.html') or asset == 'service-worker.js':
            abort(404)
        return send_from_directory(public, asset)

    def upstream(path, *, payload=None, timeout=130):
        # Fixed upstream: clients cannot choose URLs or override authorization.
        return requests.request('GET' if payload is None else 'POST', 'https://ollama.com/api/' + path,
            headers={'Authorization': 'Bearer ' + app.config['OLLAMA_API_KEY'], 'Content-Type': 'application/json'},
            json=payload, stream=True, timeout=(10, timeout), allow_redirects=False)

    def upstream_error(status):
        messages = {401: 'The hosting server’s Ollama API key was rejected. Update it in the hosting settings.',
            403: 'This Ollama account does not have access to this feature.',
            404: 'This model or feature is unavailable. Refresh the model list and try again.',
            429: 'Ollama’s usage limit was reached. Try again later.'}
        return jsonify(error=messages.get(status, 'Ollama Cloud could not complete the request. Try again shortly.'), retryable=status == 408 or status >= 500), 429 if status == 429 else 502

    def bounded_json(response):
        chunks, size = [], 0
        for chunk in response.iter_content(16384):
            size += len(chunk)
            if size > 1024 * 1024:
                raise ValueError('Response too large')
            chunks.append(chunk)
        return json.loads(b''.join(chunks))

    @app.get('/api/ollama/tags')
    def models():
        with cache_lock:
            if model_cache['data'] is not None and time.monotonic() - model_cache['at'] < 60:
                return jsonify(model_cache['data'])
            try:
                with upstream('tags', timeout=15) as response:
                    if response.status_code != 200:
                        return upstream_error(response.status_code)
                    raw = bounded_json(response)
                data = {'models': [{**item, 'remote_model': item['name']} for item in raw['models'][:200]
                    if isinstance(item, dict) and isinstance(item.get('name'), str)]}
                model_cache.update(data=data, at=time.monotonic())
                return jsonify(data)
            except (requests.RequestException, ValueError, KeyError, TypeError):
                return jsonify(error='Could not load Ollama Cloud models. Try again shortly.'), 502

    @app.post('/api/ollama/chat')
    def chat():
        raw = request.get_json()
        if not isinstance(raw, dict) or not isinstance(raw.get('model'), str) or not 1 <= len(raw['model']) <= 160 or not isinstance(raw.get('messages'), list) or not 1 <= len(raw['messages']) <= 1000:
            abort(400, 'Choose a model and include between 1 and 1,000 messages.')
        payload = {key: raw[key] for key in ('model', 'messages', 'think', 'options', 'format') if key in raw}
        payload['stream'] = True
        if not chat_slots.acquire(blocking=False):
            return jsonify(error='Four replies are already running. Wait or stop one before trying again.'), 429
        try:
            response = upstream('chat', payload=payload)
        except requests.RequestException:
            chat_slots.release()
            return jsonify(error='Could not reach Ollama Cloud. Try again shortly.'), 502
        if response.status_code != 200:
            response.close()
            chat_slots.release()
            return upstream_error(response.status_code)
        released = False

        def cleanup():
            nonlocal released
            if not released:
                released = True
                response.close()
                chat_slots.release()

        def tokens():
            try:
                # Preserve every NDJSON event, including thinking and completion.
                for line in response.iter_lines(chunk_size=1):
                    if line:
                        yield line + b'\n'
            except requests.RequestException:
                yield b'{"error":"The cloud connection was interrupted. Retry the reply.","retryable":true}\n'
            finally:
                cleanup()
        result = Response(tokens(), mimetype='application/x-ndjson', headers={'X-Accel-Buffering': 'no'})
        result.call_on_close(cleanup)
        return result

    @app.post('/api/web/<action>')
    def web(action):
        if action not in ('search', 'fetch'):
            abort(404)
        if request.headers.get('X-Orbit-Web') != '1':
            abort(403)
        if (request.content_length or 0) > 8192:
            abort(413)
        try:
            payload = web_payload(action, request.get_json())
        except (ValueError, TypeError):
            abort(400, 'Use a short query or a public HTTPS URL.')
        if not web_slots.acquire(blocking=False):
            return jsonify(error='Web search is busy. Try again shortly.', retryable=True), 429
        try:
            if web_backoff.active():
                fallback = public_web_fallback(action, payload)
                if fallback:
                    return jsonify(fallback)
                return jsonify(error='Public search providers are temporarily unavailable.', retryable=True), 502
            with upstream('web_' + action, payload=payload, timeout=WEB_SEARCH_TIMEOUT if action=='search' else WEB_FETCH_TIMEOUT) as response:
                if response.status_code != 200:
                    web_backoff.failure(response.status_code)
                    response.close()
                    fallback = public_web_fallback(action, payload)
                    if fallback:
                        return jsonify(fallback)
                    if action == 'fetch' and response.status_code in (403, 404, 410, 422):
                        return jsonify(error='This source page is unavailable. Other sources can still be used.', code='source_unavailable'), 502
                    return upstream_error(response.status_code)
                raw = bounded_json(response)
            if not isinstance(raw, dict):
                raise ValueError('Invalid web response')
            if action == 'search':
                results = clean_web_results(raw.get('results'))
                if not results:
                    fallback = public_web_fallback(action, payload)
                    if fallback:
                        return jsonify(fallback)
                return jsonify(results=results, engine='Ollama')
            if not str(raw.get('content') or '').strip():
                fallback = public_web_fallback(action, payload)
                if fallback:
                    return jsonify(fallback)
            return jsonify(url=payload['url'], title=str(raw.get('title') or payload['url'])[:240], content=str(raw.get('content') or '')[:64000], engine='Ollama')
        except (requests.RequestException, OSError, ValueError, TypeError, AttributeError):
            try:
                fallback = public_web_fallback(action, payload)
                if fallback:
                    return jsonify(fallback)
            except (OSError, ValueError, TypeError, AttributeError):
                pass
            return jsonify(error='Web access failed. Try again shortly.'), 502
        finally:
            web_slots.release()

    return app
