"""Runtime recovery tests; launchd integration uses only an isolated test job/port."""
import errno
import importlib.util
import json
import os
from pathlib import Path
import plistlib
import socket
import ssl
import subprocess
import sys
import tempfile
import time
import unittest
import urllib.request
import uuid
from unittest.mock import Mock, patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
spec = importlib.util.spec_from_file_location('orbit_recovery_server', ROOT / 'server.py')
server = importlib.util.module_from_spec(spec)
spec.loader.exec_module(server)

class RecoveryTests(unittest.TestCase):
    def test_updater_migrates_service_without_changing_existing_environment(self):
        text = (ROOT / 'scripts/update-installed-macos.command').read_text()
        migration = text.split('python3 - "$PLIST" "$NEXT_PLIST" <<\'PY\'\n', 1)[1].split('\nPY\n', 1)[0]
        with tempfile.TemporaryDirectory() as folder:
            old, new = Path(folder) / 'old.plist', Path(folder) / 'new.plist'
            data = {'Label': 'com.sathya.orbit.server', 'ProgramArguments': ['python3', '/installed/server.py'], 'EnvironmentVariables': {'SSL_CERT_FILE': '/installed/system-ca.pem'}}
            old.write_bytes(plistlib.dumps(data))
            subprocess.run([sys.executable, '-', str(old), str(new)], input=migration, text=True, check=True)
            result = plistlib.loads(new.read_bytes())
            self.assertEqual(result['ProgramArguments'], data['ProgramArguments'])
            self.assertEqual(result['EnvironmentVariables']['SSL_CERT_FILE'], '/installed/system-ca.pem')
            self.assertEqual(result['EnvironmentVariables']['ORBIT_LAUNCHD_SOCKETS'], '1')
            self.assertTrue(result['KeepAlive'])
            self.assertEqual([s['SockNodeName'] for s in result['Sockets']['HTTPS']], ['127.0.0.1', '::1'])
            self.assertEqual(plistlib.loads(old.read_bytes()), data)

    def test_development_copy_cannot_take_installed_port(self):
        with tempfile.TemporaryDirectory() as folder:
            installed = Path(folder) / 'installed'
            installed.mkdir()
            (installed / 'server.py').touch()
            with self.assertRaisesRegex(RuntimeError, 'Installed Orbit owns'):
                server.guard_installed_runtime(ROOT, 443, 'darwin', installed)
            server.guard_installed_runtime(installed, 443, 'darwin', installed)
            server.guard_installed_runtime(ROOT, 5173, 'darwin', installed)
            server.guard_installed_runtime(ROOT, 443, 'win32', installed)

    def test_watchdog_resets_after_recovery_and_restarts_only_after_repeated_failures(self):
        for checks, expected in [([False, True, False, False], 0), ([False, False, False], 1)]:
            stop, restart = Mock(), Mock()
            stop.wait.side_effect = [False] * len(checks) + [True]
            probe = Mock(side_effect=checks)
            server.monitor_runtime(stop, probe, restart, interval=1)
            self.assertEqual(restart.call_count, expected)
            self.assertEqual(probe.call_count, len(checks))

    def test_health_rejects_wrong_server_and_closes_connections(self):
        connection = Mock()
        response = connection.getresponse.return_value
        response.status = 200
        for body, expected, calls in [(b'{"service":"orbit","pid":123}', True, 2), (b'{"service":"other","pid":123}', False, 1), (b'{"service":"orbit","pid":456}', False, 1), (b'bad json', False, 1)]:
            connection.reset_mock()
            response.read.return_value = body
            with patch.object(server.http.client, 'HTTPSConnection', return_value=connection):
                self.assertEqual(server.runtime_healthy(443, 123), expected)
            self.assertEqual(connection.close.call_count, calls)

    def test_no_activation_fallback_outside_launchd(self):
        if sys.platform != 'darwin':
            self.skipTest('macOS activation API')
        with self.assertRaises(OSError):
            server.launchd_listeners()

@unittest.skipUnless(sys.platform == 'darwin' and os.getuid() != 0, 'Needs macOS desktop launchd domain')
class LaunchdRecoveryTests(unittest.TestCase):
    def test_reserved_listener_survives_crash_and_silent_tls_client(self):
        with tempfile.TemporaryDirectory(prefix='orbit-runtime-test-') as folder:
            root = Path(folder)
            subprocess.run(['openssl', 'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-subj', '/CN=localhost', '-keyout', str(root/'orbit.com-key.pem'), '-out', str(root/'orbit.com.pem')], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            with socket.socket() as probe:
                probe.bind(('127.0.0.1', 0))
                port = probe.getsockname()[1]
            label = 'com.orbit.test.runtime.' + uuid.uuid4().hex
            domain = 'gui/' + str(os.getuid())
            job = domain + '/' + label
            plist = root / 'test.plist'
            plist.write_bytes(plistlib.dumps({'Label': label, 'ProgramArguments': [sys.executable, str(ROOT/'server.py')], 'WorkingDirectory': str(ROOT), 'RunAtLoad': True, 'KeepAlive': True, 'ThrottleInterval': 1, 'EnvironmentVariables': {'ORBIT_ROOT': str(root), 'ORBIT_PORT': str(port), 'ORBIT_LAUNCHD_SOCKETS': '1', 'PYTHONUNBUFFERED': '1'}, 'Sockets': {'HTTPS': [{'SockFamily': family, 'SockNodeName': host, 'SockServiceName': port, 'SockType': 'stream'} for family, host in [('IPv4','127.0.0.1'),('IPv6','::1')]]}, 'StandardOutPath': str(root/'out.log'), 'StandardErrorPath': str(root/'error.log')}))
            opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), urllib.request.HTTPSHandler(context=ssl._create_unverified_context()))
            def health(host='127.0.0.1'):
                with opener.open(f'https://{host}:{port}/api/health', timeout=2) as r:
                    return json.load(r)
            def wait_pid(old=None):
                for _ in range(80):
                    try:
                        data = health()
                        if data['service'] == 'orbit' and data['pid'] != old:
                            return data['pid']
                    except Exception:
                        pass
                    time.sleep(.1)
                self.fail('Test runtime failed: ' + (root/'error.log').read_text())
            try:
                subprocess.run(['launchctl','bootstrap',domain,str(plist)],check=True, capture_output=True)
                first = wait_pid()
                self.assertEqual(health('[::1]')['pid'],first)
                # An accepted TCP socket that never negotiates TLS must not freeze the listener.
                with socket.create_connection(('127.0.0.1',port), timeout=2):
                    self.assertEqual(health()['pid'],first)
                    self.assertEqual(health('[::1]')['pid'],first)
                for _ in range(2):
                    subprocess.run(['launchctl','kill','SIGKILL',job],check=True,capture_output=True)
                    for _ in range(15):
                        for family, host in [(socket.AF_INET,'127.0.0.1'),(socket.AF_INET6,'::1')]:
                            with socket.socket(family) as contender:
                                with self.assertRaises(OSError) as failure:
                                    contender.bind((host,port))
                                self.assertEqual(failure.exception.errno,errno.EADDRINUSE)
                        time.sleep(.02)
                    first = wait_pid(first)
                    self.assertEqual(health('[::1]')['pid'],first)
            finally:
                subprocess.run(['launchctl','bootout',job],capture_output=True)

if __name__ == '__main__':
    unittest.main()
