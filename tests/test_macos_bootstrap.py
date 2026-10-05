"""Exercise the real no-argument elevation branch using harmless sudo/curl stubs."""
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]

@unittest.skipUnless(Path('/bin/bash').exists() and os.getuid() != 0, 'Needs non-root Bash host')
class MacBootstrap(unittest.TestCase):
    def test_no_arguments_under_system_bash(self):
        with tempfile.TemporaryDirectory(prefix='Orbit installer with spaces ') as temporary:
            folder = Path(temporary)
            installer = folder / 'install-macos.sh'
            shutil.copyfile(ROOT / 'install-macos.sh', installer)
            installer.chmod(0o644)  # bash invocation must work without executable bit
            (folder / 'curl').write_text('#!/bin/sh\nexit 0\n')
            (folder / 'sudo').write_text('''#!/bin/sh
if [ "$1" = '-v' ]; then exit 0; fi
printf '%s\\0' "$@"
''')
            for name in ['sudo','curl']:
                (folder / name).chmod(0o755)
            launcher = folder / 'install-macos.command'
            shutil.copyfile(ROOT / launcher.name, launcher)
            for invocation in [['/bin/bash', str(installer)], ['/bin/zsh', str(launcher)]]:
                with self.subTest(invocation=invocation):
                    result = subprocess.run(invocation, env=dict(os.environ, PATH=str(folder)+':'+os.environ['PATH']), capture_output=True)
                    self.assertEqual(result.returncode, 0, result.stderr.decode())
                    args = result.stdout.split(b'\0')
                    self.assertEqual(args[-3:-1], [b'/bin/bash', str(installer).encode()])
                    self.assertNotIn(b'unbound variable', result.stderr)
                    self.assertNotIn(b'-v', args)  # one sudo call, no separate credential prompt


class FreshPrerequisites(unittest.TestCase):
    """Run the actual prerequisite branch with system operations mocked.

    This verifies control flow only, not a clean-machine OS installation.
    """
    def run_bootstrap(self, **overrides):
        with tempfile.TemporaryDirectory(prefix='Orbit fresh bootstrap ') as temporary:
            folder = Path(temporary)
            commands = folder / 'bin'
            commands.mkdir()
            log = folder / 'calls'
            app = folder / 'Applications/Ollama.app'
            scripts = {
                'curl': 'printf "curl\\n" >> "$TEST_LOG"\nexit "${SIM_DOWNLOAD_FAIL:-0}"',
                'shasum': 'cat >/dev/null\nprintf "checksum\\n" >> "$TEST_LOG"\nexit "${SIM_CHECKSUM_FAIL:-0}"',
                'pkgutil': 'printf "pkg-signature\\n" >> "$TEST_LOG"\nexit 0',
                'installer': 'printf "python-install\\n" >> "$TEST_LOG"\ntouch "$TEST_ROOT/python-ready"',
                'sw_vers': 'printf "%s\\n" "${SIM_MAC_VERSION:-14.0}"',
                'ditto': '''printf "ditto\\n" >> "$TEST_LOG"
for arg in "$@"; do destination="$arg"; done
mkdir -p "$destination/Contents/Resources"
touch "$destination/Contents/Resources/ollama"
chmod +x "$destination/Contents/Resources/ollama"''',
                'codesign': 'printf "app-signature\\n" >> "$TEST_LOG"\nexit "${SIM_SIGNATURE_FAIL:-0}"',
                'spctl': 'printf "app-assessment\\n" >> "$TEST_LOG"\nexit 0',
            }
            for name, body in scripts.items():
                target = commands / name
                target.write_text('#!/bin/bash\nset -eu\n'+body+'\n')
                target.chmod(0o755)
            source = (ROOT / 'install-macos.sh').read_text()
            branch = source.split('PYTHON_BIN="${ORBIT_PYTHON_BIN:-}"', 1)[1].split('require_command openssl', 1)[0]
            branch = 'PYTHON_BIN="${ORBIT_PYTHON_BIN:-}"'+branch
            branch = branch.replace('/usr/sbin/installer', 'installer').replace('/Applications/Ollama.app', '"$TEST_ROOT/Applications/Ollama.app"')
            script = folder / 'exercise.sh'
            script.write_text('''#!/bin/bash
set -euo pipefail
IS_STAGING=0
OLLAMA_BIN=""
die() { printf '%s\\n' "$*" >&2; exit 1; }
find_python() { [[ -f "$TEST_ROOT/python-ready" ]] && printf /usr/bin/true; }
find_ollama() { [[ -x "$TEST_ROOT/Applications/Ollama.app/Contents/Resources/ollama" ]] && printf '%s' "$TEST_ROOT/Applications/Ollama.app/Contents/Resources/ollama"; }
'''+branch)
            result = subprocess.run(['/bin/bash', str(script)], capture_output=True, text=True,
                                    env=dict(os.environ, PATH=str(commands)+':/usr/bin:/bin:/usr/sbin:/sbin',
                                             TEST_ROOT=str(folder), TEST_LOG=str(log), ORBIT_PYTHON_BIN='', **overrides))
            return result, log.read_text().splitlines() if log.exists() else []

    def test_missing_python_and_ollama_automatic_setup(self):
        result, calls = self.run_bootstrap()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(calls, ['curl','checksum','pkg-signature','python-install','curl','ditto','app-signature','app-assessment','ditto'])

    def test_failed_download_stops_before_installing(self):
        result, calls = self.run_bootstrap(SIM_DOWNLOAD_FAIL='22')
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(calls, ['curl'])
        self.assertIn('Python download failed', result.stderr)

    def test_bad_checksum_stops_before_installing(self):
        result, calls = self.run_bootstrap(SIM_CHECKSUM_FAIL='1')
        self.assertNotEqual(result.returncode, 0)
        self.assertNotIn('python-install', calls)

    def test_failed_ollama_signature_does_not_copy_app(self):
        result, calls = self.run_bootstrap(SIM_SIGNATURE_FAIL='1')
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(calls.count('ditto'), 1)  # unpack only, never install
        self.assertNotIn('app-assessment', calls)

    def test_unsupported_macos_stops_ollama_download(self):
        result, calls = self.run_bootstrap(SIM_MAC_VERSION='13.7')
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(calls.count('curl'), 1)
        self.assertIn('macOS 14', result.stderr)

class BrowserLaunch(unittest.TestCase):
    def test_browser_runs_as_original_user_and_failure_is_nonfatal(self):
        source = (ROOT / 'install-macos.sh').read_text()
        branch = source.split('    # Open the browser as the original desktop user', 1)[1].split('    exit 0', 1)[0]
        branch = '# Open the browser as the original desktop user'+branch
        with tempfile.TemporaryDirectory(prefix='Orbit browser launch ') as temporary:
            folder=Path(temporary)
            launcher=folder/'launchctl'
            launcher.write_text('#!/bin/bash\nprintf "%s\\n" "$@" > "$TEST_LOG"\nexit "$SIM_RESULT"\n')
            launcher.chmod(0o755)
            for code in ['0','1']:
                result=subprocess.run(['/bin/bash','-c','set -euo pipefail\nLOGIN_UID=501\nLOGIN_USER=testuser\n'+branch],
                    env=dict(os.environ,PATH=str(folder)+':/usr/bin:/bin',TEST_LOG=str(folder/'args'),SIM_RESULT=code),capture_output=True,text=True)
                self.assertEqual(result.returncode,0,result.stderr)
                self.assertEqual((folder/'args').read_text().splitlines(),['asuser','501','/usr/bin/sudo','-u','testuser','/usr/bin/open','https://orbit.com'])
