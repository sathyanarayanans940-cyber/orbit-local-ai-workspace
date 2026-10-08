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
FILES=(gemini.py openai_gateway.py deepseek.py aicredits.py server.py app.js index.html styles.css document-format.js document-assets.js document-edits.js workspace-core.js workspace-budget.js document-history.js workspace-tools.js long-documents.js boot.js analyze-sandbox.html analyze.js analyze-worker.js chat-store.js memories.js file-preview.js archives.js voice.js usage.js thinking.js charts.js widgets.js widgets-ui.js web-tools.js service-worker.js)
if "$WEB_ONLY"; then FILES=(app.js index.html styles.css document-format.js document-assets.js document-edits.js workspace-core.js workspace-budget.js document-history.js workspace-tools.js long-documents.js boot.js analyze-sandbox.html analyze.js analyze-worker.js chat-store.js memories.js file-preview.js archives.js voice.js usage.js thinking.js charts.js widgets.js widgets-ui.js web-tools.js service-worker.js); fi
[[ -f "$DEST/server.py" && -f "/Library/LaunchDaemons/$LABEL.plist" ]] || { echo 'No installed Orbit service found. Use the full installer.'; exit 1; }
for asset in "${FILES[@]}"; do [[ -f "$ROOT/$asset" ]] || { echo "Missing update asset: $asset"; exit 1; }; done
[[ -f "$ROOT/vendor/readers/pdf.min.mjs" && -f "$ROOT/vendor/readers/pdf.worker.min.mjs" && -f "$ROOT/vendor/readers/mammoth.browser.min.js" && -f "$ROOT/vendor/readers/jszip.min.js" ]] || { echo 'Missing bundled document readers.'; exit 1; }
if [[ "$EUID" -ne 0 ]]; then
  echo 'Updating the existing Orbit app. Enter your Mac password at the Password prompt.'
  if "$WEB_ONLY"; then exec /usr/bin/sudo /bin/bash "$0" --web-only; fi
  exec /usr/bin/sudo /bin/bash "$0"
fi
for asset in "${FILES[@]}"; do
  /usr/bin/install -o root -g wheel -m 644 "$ROOT/$asset" "$DEST/$asset"
done
while IFS= read -r -d '' asset; do
  relative="${asset#"$ROOT/"}"
  /usr/bin/install -d -o root -g wheel -m 755 "$(dirname "$DEST/$relative")"
  /usr/bin/install -o root -g wheel -m 644 "$asset" "$DEST/$relative"
done < <(find "$ROOT/vendor" -type f ! -name '.*' -print0)
if ! "$WEB_ONLY"; then /bin/launchctl kickstart -k "system/$LABEL"; fi
echo 'Orbit updated. Reload https://orbit.com to load the update.'
