"""Opt-in latency probe through the installed gateway; never reads an API key.

Input is an explicitly supplied messages JSON file. Reasoning text is counted,
never saved or printed. This does not execute generated code.
"""
import argparse
import http.client
import json
from pathlib import Path
import socket
import ssl
import time


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('messages')
    parser.add_argument('output')
    parser.add_argument('--provider', choices=['deepseek', 'aicredits'], default='deepseek')
    parser.add_argument('--json', action='store_true')
    parser.add_argument('--max-tokens', type=int, default=None)
    parser.add_argument('--seconds', type=int, default=300)
    args = parser.parse_args()
    messages = json.loads(Path(args.messages).read_text())
    payload = dict(model='deepseek-flash' if args.provider == 'deepseek' else 'deepseek/deepseek-v4.1-flash',
                   messages=messages, stream=True, reasoning_effort='high',
                   max_tokens=args.max_tokens or (16384 if args.json else 65536), stream_options={'include_usage': True})
    if args.provider == 'deepseek':
        payload['thinking'] = {'type': 'enabled'}
    if args.json:
        payload['response_format'] = {'type': 'json_object'}
    context = ssl.create_default_context(cafile='/Library/Application Support/Orbit/orbit.com.pem')
    connection = http.client.HTTPSConnection('orbit.com', timeout=110, context=context)
    connection._create_connection = lambda address, timeout=110, source_address=None, **kw: socket.create_connection(('127.0.0.1', 443), timeout)
    started = time.monotonic()
    elapsed = lambda: round(time.monotonic() - started, 3)
    result = {'provider': args.provider, 'model': payload['model'], 'effort': 'high',
              'inputCharacters': sum(len(str(m['content'])) for m in messages),
              'firstReasoningSeconds': None, 'firstTextSeconds': None, 'reasoningCharacters': 0}
    content, buffer, terminal = [], b'', False
    try:
        connection.request('POST', '/api/' + args.provider + '/chat', json.dumps(payload),
                           {'Content-Type': 'application/json', 'Origin': 'https://orbit.com',
                            'X-Orbit-' + ('DeepSeek' if args.provider == 'deepseek' else 'AICredits'): '1'})
        response = connection.getresponse()
        result.update(status=response.status, headersSeconds=elapsed(), serverTiming=response.getheader('Server-Timing'))
        print(json.dumps(result), flush=True)
        if response.status != 200:
            result['error'] = response.read(4096).decode(errors='replace')
            return
        while not terminal:
            if elapsed() > args.seconds:
                result['error'] = 'Probe deadline exceeded'
                break
            chunk = response.read1(65536)
            if not chunk:
                break
            buffer += chunk
            while b'\n' in buffer:
                line, buffer = buffer.split(b'\n', 1)
                if not line.startswith(b'data:'):
                    continue
                raw = line[5:].strip()
                if raw == b'[DONE]':
                    terminal = True
                    break
                event = json.loads(raw)
                if event.get('error'):
                    result['error'] = event['error']
                if event.get('usage'):
                    result['usage'] = event['usage']
                for choice in event.get('choices', []):
                    delta = choice.get('delta') or {}
                    reasoning = delta.get('reasoning_content') or delta.get('reasoning') or ''
                    if isinstance(reasoning, str) and reasoning:
                        result['reasoningCharacters'] += len(reasoning)
                        if result['firstReasoningSeconds'] is None:
                            result['firstReasoningSeconds'] = elapsed()
                            print(json.dumps({'firstReasoningSeconds': elapsed()}), flush=True)
                    text = delta.get('content')
                    if isinstance(text, str) and text:
                        if result['firstTextSeconds'] is None:
                            result['firstTextSeconds'] = elapsed()
                            print(json.dumps({'firstTextSeconds': elapsed()}), flush=True)
                        content.append(text)
                    if choice.get('finish_reason'):
                        result['finishReason'] = choice['finish_reason']
    except Exception as error:
        result['error'] = str(error)
    finally:
        connection.close()
        result.update(totalSeconds=elapsed(), completed=terminal, textCharacters=sum(map(len, content)))
        target = Path(args.output)
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(json.dumps(result, indent=2))
        target.with_suffix('.txt').write_text(''.join(content))
        print(json.dumps(result), flush=True)


if __name__ == '__main__':
    main()
