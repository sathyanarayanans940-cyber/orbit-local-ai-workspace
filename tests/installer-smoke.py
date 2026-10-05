"""Exercise the shipped macOS installer without modifying system configuration.
Run after scripts/package-release.py. Add --serve for a local TLS smoke test.
"""
import os
from pathlib import Path
import plistlib
import socket
import ssl
import subprocess
import sys
import tempfile
import time
import zipfile

ROOT = Path(__file__).resolve().parents[1]
with tempfile.TemporaryDirectory(prefix='orbit install & update ') as temporary:
    work = Path(temporary)
    with zipfile.ZipFile(ROOT / 'release/Orbit.zip') as archive:
        assert archive.testzip() is None
        assert (archive.getinfo('Orbit/install-macos.command').external_attr >> 16) & 0o111
        assert not any(name.endswith(('.pem', '.log')) or '/node_modules/' in name or '/tests/' in name for name in archive.namelist())
        if sys.platform == 'darwin':
            # Exercise actual macOS ZIP extraction and the executable launcher.
            subprocess.run(['/usr/bin/ditto', '-x', '-k', str(ROOT / 'release/Orbit.zip'), str(work / 'extracted')], check=True)
        else:
            archive.extractall(work / 'extracted')
    package = work / 'extracted/Orbit'
    stage = work / 'staged install'
    stage.mkdir()
    (stage / 'hosts').write_text('127.0.0.1 localhost other.test orbit.com\n::1 localhost orbit.com\n')
    for attempt in range(2):
        launcher = [str(package / 'install-macos.command')] if sys.platform == 'darwin' else ['/bin/bash', str(package / 'install-macos.sh')]
        run = subprocess.run([*launcher, '--staging-dir', str(stage)], capture_output=True, text=True)
        assert run.returncode == 0, run.stdout + run.stderr
        install = stage / 'Orbit'
        assets = (package / 'install-macos.sh').read_text().split('ASSETS=(', 1)[1].split(')', 1)[0].split()
        assets += [str(p.relative_to(package)) for p in (package / 'vendor').rglob('*') if p.is_file()]
        for name in assets:
            assert (install / name).read_bytes() == (package / name).read_bytes(), name
        for path in (stage / 'LaunchDaemons').glob('*.plist'):
            plist = plistlib.loads(path.read_bytes())
            expected = 'orbit-dns.py' if plist['Label'] == 'com.orbit.local-dns' else 'server.py'
            assert str(install / expected) in plist['ProgramArguments']
        hosts = (stage / 'hosts').read_text()
        assert hosts.count('orbit.com') == 2 and 'other.test' in hosts and 'localhost' in hosts
        assert (install / 'orbit.com-key.pem').stat().st_mode & 0o777 == 0o600
    print('PASS: ZIP extraction, fresh install, reinstall, full asset parity, hosts, plist escaping, private-key permissions')
    conflict = work / 'resolver conflict'
    (conflict / 'resolver').mkdir(parents=True)
    (conflict / 'resolver/orbit.com').write_text('nameserver 192.0.2.1\n')
    (conflict / 'hosts').write_text('127.0.0.1 localhost\n')
    blocked = subprocess.run([*launcher, '--staging-dir', str(conflict)], capture_output=True, text=True)
    assert blocked.returncode != 0 and 'existing resolver' in blocked.stderr
    assert (conflict / 'hosts').read_text() == '127.0.0.1 localhost\n'
    assert not (conflict / 'Orbit').exists()
    memory = package / 'memories.js'
    memory.rename(package / 'memories.missing')
    try:
        missing = subprocess.run([*launcher, '--staging-dir', str(work / 'incomplete package')], capture_output=True, text=True)
        assert missing.returncode != 0 and 'Missing Orbit file: memories.js' in missing.stderr
        assert not (work / 'incomplete package/Orbit').exists()
    finally:
        (package / 'memories.missing').rename(memory)
    backup = install / '.orbit-cert-backup'
    backup.mkdir()
    (install / 'orbit.com.pem').rename(backup / 'orbit.com.pem')
    (install / 'orbit.com-key.pem').rename(backup / 'orbit.com-key.pem')
    recovered = subprocess.run([*launcher, '--staging-dir', str(stage)], capture_output=True, text=True)
    assert recovered.returncode == 0, recovered.stderr
    assert 'Recovering the previous Orbit certificate pair' in recovered.stdout
    assert not backup.exists()
    print('PASS: resolver conflict preserves existing config; missing asset fails early; interrupted certificate replacement recovers')
    if '--serve' in sys.argv:
        with socket.socket() as probe:
            probe.bind(('127.0.0.1', 0))
            port = probe.getsockname()[1]
        env = dict(os.environ, ORBIT_ROOT=str(install), ORBIT_PORT=str(port))
        with (work / 'server.log').open('w') as log:
            process = subprocess.Popen([sys.executable, str(install / 'server.py')], env=env, stdout=log, stderr=log)
            try:
                context = ssl.create_default_context(cafile=str(install / 'orbit.com.pem'))
                def get(address, path, hostname="orbit.com"):
                    with socket.create_connection((address, port), timeout=3) as raw:
                        with context.wrap_socket(raw, server_hostname=hostname) as tls:
                            tls.sendall(f'GET /{path} HTTP/1.0\r\nHost: {hostname}\r\n\r\n'.encode())
                            data = b''
                            while chunk := tls.recv(65536):
                                data += chunk
                            return data
                for attempt in range(40):
                    try:
                        response = get('127.0.0.1', 'index.html')
                        break
                    except OSError:
                        time.sleep(.1)
                else:
                    raise AssertionError('Staged server did not start')
                assert b'200 OK' in response.split(b'\r\n', 1)[0]
                for address in ['127.0.0.1', '::1']:
                    assert b'200 OK' in get(address, 'index.html', 'localhost').split(b'\r\n', 1)[0]
                    for name in assets:
                        if name.endswith(('.py', '.sh')):
                            continue
                        response = get(address, name)
                        header, body = response.split(b'\r\n\r\n', 1)
                        assert b'200 OK' in header.split(b'\r\n', 1)[0], (address, name)
                        assert body == (install / name).read_bytes(), name
                    response = get(address, 'orbit.com-key.pem')
                    assert b'200 OK' not in response.split(b'\r\n', 1)[0]
                print('PASS: installed HTTPS server, verified certificate, IPv4/IPv6 assets, private-key HTTP access denied')
            finally:
                process.terminate()
                process.wait(timeout=5)
