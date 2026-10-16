#!/bin/bash
# Apply the tested frontend/provider update to an existing installation.
# No certificates, DNS, model files or user settings are replaced.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEST='/Library/Application Support/Orbit'
LABEL='com.sathya.orbit.server'
WEB_ONLY=false
if [[ ${1:-} == --web-only ]]; then WEB_ONLY=true; elif [[ $# -gt 0 ]]; then echo 'Usage: update-installed-macos.command [--web-only]'; exit 2; fi
python3 "$ROOT/scripts/setup-analyze.py"
FILES=(gemini.py openai_gateway.py deepseek.py aicredits.py server.py app.js index.html manifest.webmanifest icon.svg pwa-appearance.js custom-theme.js styles.css mobile.css mobile.js document-format.js document-assets.js document-edits.js workspace-core.js workspace-budget.js document-history.js workspace-tools.js long-documents.js boot.js analyze-sandbox.html analyze.js analyze-worker.js chat-store.js memories.js file-preview.js archives.js voice.js usage.js thinking.js charts.js widgets.js widgets-ui.js web-tools.js service-worker.js)
if "$WEB_ONLY"; then FILES=(app.js index.html manifest.webmanifest icon.svg pwa-appearance.js custom-theme.js styles.css mobile.css mobile.js document-format.js document-assets.js document-edits.js workspace-core.js workspace-budget.js document-history.js workspace-tools.js long-documents.js boot.js analyze-sandbox.html analyze.js analyze-worker.js chat-store.js memories.js file-preview.js archives.js voice.js usage.js thinking.js charts.js widgets.js widgets-ui.js web-tools.js service-worker.js); fi
[[ -f "$DEST/server.py" && -f "/Library/LaunchDaemons/$LABEL.plist" ]] || { echo 'No installed Orbit service found. Use the full installer.'; exit 1; }
for asset in "${FILES[@]}"; do [[ -f "$ROOT/$asset" ]] || { echo "Missing update asset: $asset"; exit 1; }; done
[[ -f "$ROOT/vendor/readers/pdf.min.mjs" && -f "$ROOT/vendor/readers/pdf.worker.min.mjs" && -f "$ROOT/vendor/readers/mammoth.browser.min.js" && -f "$ROOT/vendor/readers/jszip.min.js" ]] || { echo 'Missing bundled document readers.'; exit 1; }
if [[ "$EUID" -ne 0 ]]; then
  echo 'Updating the existing Orbit app. Enter your Mac password at the Password prompt.'
  if "$WEB_ONLY"; then exec /usr/bin/sudo /bin/bash "$0" --web-only; fi
  exec /usr/bin/sudo /bin/bash "$0"
fi
CURRENT_UID="${SUDO_UID:-$(id -u)}"
if [[ "$CURRENT_UID" -ne 0 ]]; then
  # The installed daemon owns the protected API settings. A legacy development
  # agent can otherwise take port 443 with an empty, separate configuration.
  /bin/launchctl bootout "gui/$CURRENT_UID/$LABEL" 2>/dev/null || true
  /bin/launchctl disable "gui/$CURRENT_UID/$LABEL" 2>/dev/null || true
fi
for asset in "${FILES[@]}"; do
  /usr/bin/install -o root -g wheel -m 644 "$ROOT/$asset" "$DEST/$asset"
done
while IFS= read -r -d '' asset; do
  relative="${asset#"$ROOT/"}"
  /usr/bin/install -d -o root -g wheel -m 755 "$(dirname "$DEST/$relative")"
  /usr/bin/install -o root -g wheel -m 644 "$asset" "$DEST/$relative"
done < <(find "$ROOT/vendor" -type f ! -name '.*' -print0)
if ! "$WEB_ONLY"; then
  PLIST="/Library/LaunchDaemons/$LABEL.plist"
  NEXT_PLIST="$(mktemp "${PLIST}.next.XXXXXX")"
  OLD_PLIST="$(mktemp "${PLIST}.backup.XXXXXX")"
  trap 'rm -f "$NEXT_PLIST" "$OLD_PLIST"' EXIT
  cp "$PLIST" "$OLD_PLIST"
  python3 - "$PLIST" "$NEXT_PLIST" <<'PY'
import plistlib, sys
from pathlib import Path
data = plistlib.loads(Path(sys.argv[1]).read_bytes())
data.setdefault('EnvironmentVariables', {})['ORBIT_LAUNCHD_SOCKETS'] = '1'
data['Sockets'] = {'HTTPS': [
    {'SockFamily': family, 'SockNodeName': host, 'SockServiceName': 443, 'SockType': 'stream'}
    for family, host in [('IPv4', '127.0.0.1'), ('IPv6', '::1')]
]}
data['RunAtLoad'], data['KeepAlive'] = True, True
data['ThrottleInterval'] = 5
Path(sys.argv[2]).write_bytes(plistlib.dumps(data))
PY
  chmod 644 "$NEXT_PLIST"
  if cmp -s "$PLIST" "$NEXT_PLIST"; then
    /bin/launchctl kickstart -k "system/$LABEL"
  else
    /bin/launchctl bootout "system/$LABEL" 2>/dev/null || true
    mv -f "$NEXT_PLIST" "$PLIST"
    /bin/launchctl enable "system/$LABEL"
    if ! /bin/launchctl bootstrap system "$PLIST"; then
      cp "$OLD_PLIST" "$PLIST"
      chmod 644 "$PLIST"
      /bin/launchctl bootstrap system "$PLIST" || true
      echo 'Could not reserve Orbit HTTPS sockets. Previous service configuration restored; no API settings were changed.' >&2
      exit 1
    fi
  fi
  python3 - <<'PY'
import json, ssl, time, urllib.request
for attempt in range(30):
    try:
        for host in ['127.0.0.1', '[::1]']:
            request = urllib.request.Request('https://' + host + '/api/health', headers={'Host': 'orbit.com'})
            opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), urllib.request.HTTPSHandler(context=ssl._create_unverified_context()))
            with opener.open(request, timeout=2) as response:
                assert json.load(response).get('service') == 'orbit'
        break
    except Exception:
        time.sleep(1)
else:
    raise SystemExit('Orbit did not pass its HTTPS health checks. API settings are preserved; inspect orbit-server-error.log before retrying.')
PY
fi
echo 'Orbit updated. Reload https://orbit.com to load the update.'
