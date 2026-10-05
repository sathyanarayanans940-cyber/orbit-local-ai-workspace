"""Bundle a pinned official Pyodide distribution and offline scientific packages."""
import hashlib
import json
from pathlib import Path
import urllib.request

VERSION = '0.28.3'
BASE = f'https://cdn.jsdelivr.net/pyodide/v{VERSION}/full/'
ROOT = Path(__file__).resolve().parents[1]
TARGET = ROOT / 'vendor' / 'analyze'
CORE_HASHES = {'pyodide.js': '24a458425dcb4ea9836eb5ce26701d18cb769374e2b79247602ba605bf093278', 'pyodide.asm.js': 'b22e5831eade9ff10e6fe2c811c68688cd91f10154377b4f80debcf5bafa1e56', 'pyodide.asm.wasm': '5effb6a1a6cc4a1a85bec4622701aa797c031e1de923cbbaf2ad47abdc4ab325', 'python_stdlib.zip': '71fee17f88a6260ec8c9c7c063533ee59c021fdc88a1ce76247378d3c4a35f4c'}

def main():
    TARGET.mkdir(parents=True, exist_ok=True)
    manifest_path = TARGET / 'manifest.json'
    license_path = TARGET / 'LICENSE'
    if not license_path.exists():
        with urllib.request.urlopen('https://raw.githubusercontent.com/pyodide/pyodide/0.28.3/LICENSE', timeout=60) as response:
            license_data = response.read()
        if hashlib.sha256(license_data).hexdigest() != '1f256ecad192880510e84ad60474eab7589218784b9a50bc7ceee34c2b91f1d5':
            raise RuntimeError('Analyze license checksum mismatch')
        license_path.write_bytes(license_data)
    if manifest_path.exists():
        manifest = json.loads(manifest_path.read_text())
        if manifest.get('version') == VERSION and all((TARGET / f['name']).is_file() and hashlib.sha256((TARGET / f['name']).read_bytes()).hexdigest() == f['sha256'] for f in manifest['files']):
            print('Offline Analyze runtime is ready.')
            return
    def download(name, expected=None):
        path = TARGET / name
        if expected and path.exists() and hashlib.sha256(path.read_bytes()).hexdigest() == expected:
            return path.read_bytes()
        print('Downloading Analyze:', name, flush=True)
        with urllib.request.urlopen(BASE + name, timeout=180) as response:
            data = response.read()
        if expected and hashlib.sha256(data).hexdigest() != expected:
            raise RuntimeError('Checksum mismatch: ' + name)
        temp = path.with_suffix(path.suffix + '.partial')
        temp.write_bytes(data)
        temp.replace(path)
        return data
    lock = json.loads(download('pyodide-lock.json'))
    names = ['pyodide.js', 'pyodide.asm.js', 'pyodide.asm.wasm', 'python_stdlib.zip', 'pyodide-lock.json']
    packages = set()
    def include(name):
        if name in packages:
            return
        packages.add(name)
        for dep in lock['packages'][name]['depends']:
            include(dep)
    for name in ['numpy', 'scipy', 'sympy', 'mpmath']:
        include(name)
    for name in sorted(packages):
        info = lock['packages'][name]
        download(info['file_name'], info['sha256'])
        names.append(info['file_name'])
    for name in names[:4]:
        download(name, CORE_HASHES[name])
    # Keep only installed packages; analysis must not fetch arbitrary packages.
    lock['packages'] = {k:v for k,v in lock['packages'].items() if k in packages}
    (TARGET / 'pyodide-lock.json').write_text(json.dumps(lock))
    manifest = {'version':VERSION,'packages':sorted(packages),'files':[{'name':n,'sha256':hashlib.sha256((TARGET/n).read_bytes()).hexdigest()} for n in names]}
    manifest_path.write_text(json.dumps(manifest, indent=2)+'\n')
    print('Offline Analyze runtime is ready.')

if __name__ == '__main__':
    main()
