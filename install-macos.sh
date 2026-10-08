#!/bin/bash
set -euo pipefail

IFS=$'\n\t'

APP_LABEL="com.sathya.orbit.server"
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
ORIGINAL_ARGS=("$@")
STAGING_DIR=""
INSTALL_ROOT=""
HOSTS_FILE=""
LAUNCHD_DIR=""
IS_STAGING=0
OLLAMA_BIN="${ORBIT_OLLAMA_BIN:-}"
LOGIN_UID="${ORBIT_LOGIN_UID:-}"
LOGIN_USER="${ORBIT_LOGIN_USER:-}"
LOGIN_HOME="${ORBIT_LOGIN_HOME:-}"
OLLAMA_LAUNCHD_LABEL="com.sathya.orbit.ollama"

usage() {
  cat <<'USAGE'
Install Orbit locally on macOS.

Usage:
  ./install-macos.sh
  ./install-macos.sh --staging-dir /tmp/orbit-install-test

The normal install asks for administrator access once, installs the app under
/Library/Application Support/Orbit, trusts a machine-specific HTTPS
certificate, maps orbit.com to loopback over IPv4 and IPv6, and starts Orbit
at boot with launchd.

--staging-dir DIR  Build an isolated install layout without changing the real
                   hosts file, keychain, or launchd. Useful for testing.
USAGE
}

die() {
  printf 'Orbit installer error: %s\n' "$*" >&2
  exit 1
}

while [[ "$#" -gt 0 ]]; do
  case "$1" in
    --staging-dir)
      shift
      [[ $# -gt 0 ]] || die "--staging-dir needs a directory"
      STAGING_DIR="$1"
      shift
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      die "Unknown argument: $1"
      ;;
  esac
done

find_python() {
  local candidate
  local candidates=(
    "$(command -v python3 2>/dev/null || true)"
    "/opt/homebrew/bin/python3"
    "/usr/local/bin/python3"
    "/Library/Frameworks/Python.framework/Versions/Current/bin/python3"
    "/usr/bin/python3"
  )
  for candidate in "${candidates[@]}"; do
    if [[ -n "$candidate" && -x "$candidate" && "$candidate" != */shims/python3 ]]; then
      # Apple's stub opens a developer-tools dialog when CLT is absent.
      if [[ "$candidate" == /usr/bin/python3 ]] && ! xcode-select -p >/dev/null 2>&1; then
        continue
      fi
      if "$candidate" -c 'import sys, ssl, http.server; assert sys.version_info >= (3, 9)' >/dev/null 2>&1; then
        printf '%s' "$candidate"
        return 0
      fi
    fi
  done
  return 1
}

find_ollama() {
  local candidate
  local candidates=(
    "$(command -v ollama 2>/dev/null || true)"
    "/Applications/Ollama.app/Contents/Resources/ollama"
    "$HOME/.ollama/bin/ollama"
    "/opt/homebrew/bin/ollama"
    "/usr/local/bin/ollama"
  )
  for candidate in "${candidates[@]}"; do
    if [[ -n "$candidate" && -x "$candidate" ]]; then
      printf '%s' "$candidate"
      return 0
    fi
  done
  return 1
}

if [[ -n "$STAGING_DIR" ]]; then
  STAGING_DIR="$(mkdir -p "$STAGING_DIR" && cd "$STAGING_DIR" && pwd)"
  INSTALL_ROOT="$STAGING_DIR/Orbit"
  HOSTS_FILE="$STAGING_DIR/hosts"
  LAUNCHD_DIR="$STAGING_DIR/LaunchDaemons"
  IS_STAGING=1
else
  INSTALL_ROOT="/Library/Application Support/Orbit"
  HOSTS_FILE="/etc/hosts"
  LAUNCHD_DIR="/Library/LaunchDaemons"
  if [[ "$(id -u)" -ne 0 ]]; then
    LOGIN_UID="$(id -u)"
    LOGIN_USER="$(id -un)"
    LOGIN_HOME="$HOME"
    # Discover before elevation, but do not launch apps or download yet.
    OLLAMA_BIN="$(find_ollama || true)"
    PYTHON_FOR_INSTALL="$(find_python || true)"
    printf 'Orbit will install missing Python/Ollama, HTTPS, Safari DNS, and automatic startup.\n'
    printf 'Enter your Mac administrator password once when prompted (typing stays invisible).\n'
    exec sudo \
      ORBIT_INSTALL_ELEVATED=1 \
      ORBIT_PYTHON_BIN="$PYTHON_FOR_INSTALL" \
      ORBIT_LOGIN_UID="$LOGIN_UID" \
      ORBIT_LOGIN_USER="$LOGIN_USER" \
      ORBIT_LOGIN_HOME="$LOGIN_HOME" \
      ORBIT_OLLAMA_BIN="$OLLAMA_BIN" \
      /bin/bash "$SCRIPT_DIR/install-macos.sh" ${ORIGINAL_ARGS[@]+"${ORIGINAL_ARGS[@]}"}
  fi
fi

if [[ -z "$LOGIN_UID" && -n "${SUDO_UID:-}" ]]; then
  LOGIN_UID="$SUDO_UID"
fi
if [[ -z "$LOGIN_USER" && -n "${SUDO_USER:-}" ]]; then
  LOGIN_USER="$SUDO_USER"
fi
if [[ -z "$LOGIN_HOME" && -n "$LOGIN_USER" ]]; then
  LOGIN_HOME="$(dscl . -read "/Users/$LOGIN_USER" NFSHomeDirectory 2>/dev/null | awk '{print $2}')"
fi

require_command() {
  command -v "$1" >/dev/null 2>&1 || die "Required command not found: $1"
}

PYTHON_BIN="${ORBIT_PYTHON_BIN:-}"
if [[ -z "$PYTHON_BIN" || ! -x "$PYTHON_BIN" ]]; then
  PYTHON_BIN="$(find_python || true)"
fi
if [[ -z "$PYTHON_BIN" && "$IS_STAGING" -eq 0 ]]; then
  prerequisite_dir="$(mktemp -d /private/tmp/orbit-prerequisites.XXXXXX)"
  trap 'rm -rf "$prerequisite_dir"' EXIT
  printf 'Downloading Python from python.org...\n'
  curl --fail --location --proto '=https' --tlsv1.2 --retry 2 --connect-timeout 15 --max-time 900 \
    'https://www.python.org/ftp/python/3.14.7/python-3.14.7-macos11.pkg' -o "$prerequisite_dir/python.pkg" \
    || die "Python download failed. Check the internet connection and run the installer again."
  printf '%s  %s\n' '70c5239ad2d62925d2947e46921d0ddd3d35be3d2f0a2d50db33da507dbcb419' "$prerequisite_dir/python.pkg" | shasum -a 256 -c - \
    || die "Python download checksum did not match."
  pkgutil --check-signature "$prerequisite_dir/python.pkg" >/dev/null \
    || die "Python installer signature verification failed."
  /usr/sbin/installer -pkg "$prerequisite_dir/python.pkg" -target / \
    || die "Python installation failed."
  PYTHON_BIN="$(find_python || true)"
  rm -rf "$prerequisite_dir"
  trap - EXIT
fi
[[ -n "$PYTHON_BIN" ]] || die "A working Python 3.9 or newer is required."
if [[ "$IS_STAGING" -eq 0 && -z "$OLLAMA_BIN" ]]; then
  OLLAMA_BIN="$(find_ollama || true)"
  if [[ -z "$OLLAMA_BIN" ]]; then
    prerequisite_dir="$(mktemp -d /private/tmp/orbit-prerequisites.XXXXXX)"
    trap 'rm -rf "$prerequisite_dir"' EXIT
    macos_major="$(sw_vers -productVersion | cut -d. -f1)"
    [[ "$macos_major" -ge 14 ]] || die "Automatic Ollama installation requires macOS 14 or later."
    printf 'Downloading Ollama from ollama.com (models are not downloaded)...\n'
    curl --fail --location --proto '=https' --tlsv1.2 --retry 2 --connect-timeout 15 --max-time 1800 \
      'https://ollama.com/download/Ollama-darwin.zip' -o "$prerequisite_dir/ollama.zip" \
      || die "Ollama download failed. Check the internet connection and run the installer again."
    ditto -x -k "$prerequisite_dir/ollama.zip" "$prerequisite_dir/unpacked"
    codesign --verify --deep --strict "$prerequisite_dir/unpacked/Ollama.app" \
      || die "Ollama application signature verification failed."
    spctl --assess --type execute "$prerequisite_dir/unpacked/Ollama.app" \
      || die "macOS could not verify Ollama's developer."
    [[ ! -e /Applications/Ollama.app ]] || die "An existing Ollama app needs repair; it was not overwritten."
    ditto "$prerequisite_dir/unpacked/Ollama.app" /Applications/Ollama.app
    OLLAMA_BIN="$(find_ollama || true)"
    [[ -n "$OLLAMA_BIN" ]] || die "Ollama was copied, but its runtime executable was not found."
    rm -rf "$prerequisite_dir"
    trap - EXIT
  fi
fi
require_command openssl

"$PYTHON_BIN" "$SCRIPT_DIR/scripts/setup-analyze.py" || die "Offline Analyze setup failed."

ASSETS=(
  file-preview.js
  archives.js
  analyze.js
  document-format.js
  document-assets.js
  document-edits.js
  workspace-core.js
  workspace-budget.js
  document-history.js
  workspace-tools.js
  long-documents.js
  boot.js
  analyze-sandbox.html
  analyze-worker.js
  chat-store.js
  memories.js
  app.js
  charts.js
  widgets.js
  web-tools.js
  thinking.js
  voice.js
  usage.js
  widgets-ui.js
  icon.svg
  index.html
  manifest.webmanifest
  server.py
  gemini.py
  openai_gateway.py deepseek.py
  aicredits.py
  orbit-dns.py
  service-worker.js
  styles.css
  orbit-ollama-start-macos.sh
)

for asset in xlsx.full.min.js LICENSE; do
  [[ -f "$SCRIPT_DIR/vendor/sheetjs/$asset" ]] || die "Missing spreadsheet reader: $asset"
done

for asset in pdf.min.mjs pdf.worker.min.mjs mammoth.browser.min.js jszip.min.js PDFJS-LICENSE MAMMOTH-LICENSE JSZIP-LICENSE; do
  [[ -f "$SCRIPT_DIR/vendor/readers/$asset" ]] || die "Missing bundled document reader: $asset"
done

VENDOR_ASSETS=("$SCRIPT_DIR"/vendor/katex/*)

for asset in "${ASSETS[@]}"; do
  [[ -f "$SCRIPT_DIR/$asset" ]] || die "Missing Orbit file: $asset"
done
[[ -d "$SCRIPT_DIR/vendor/katex" ]] || die "Missing Orbit vendor directory: vendor/katex"
[[ "${#VENDOR_ASSETS[@]}" -gt 0 && -f "${VENDOR_ASSETS[0]}" ]] || die "Missing bundled KaTeX assets."
[[ -f "$SCRIPT_DIR/vendor/widgets/engine.js" && -f "$SCRIPT_DIR/vendor/widgets/LICENSES.txt" && -f "$SCRIPT_DIR/vendor/widgets/ROBOTO-LICENSE.txt" ]] || die "Missing bundled widget assets."

# Keep the installer health check tied to the asset actually shipped in
# index.html so a frontend cache-bust never makes a healthy install look bad.
EXPECTED_APP_ASSET="$(sed -n 's/.*\(boot\.js?v=[^"[:space:]]*\).*/\1/p' "$SCRIPT_DIR/index.html" | head -n 1)"
[[ -n "$EXPECTED_APP_ASSET" ]] || die "Could not determine the Orbit app asset version from index.html."

# Safari can use public HTTPS/SVCB records despite /etc/hosts. Scope DNS
# to this domain only; do not change the user's default DNS/privacy settings.
RESOLVER_DIR="/etc/resolver"
[[ "$IS_STAGING" -eq 1 ]] && RESOLVER_DIR="$STAGING_DIR/resolver"
mkdir -p "$RESOLVER_DIR"
RESOLVER_FILE="$RESOLVER_DIR/orbit.com"
if [[ -f "$RESOLVER_FILE" ]] && ! grep -Fq '# Orbit managed resolver' "$RESOLVER_FILE"; then
  die "An existing resolver for orbit.com is present at $RESOLVER_FILE; keep it and review the conflict before installing."
fi

mkdir -p "$INSTALL_ROOT" "$LAUNCHD_DIR"
chmod 755 "$INSTALL_ROOT"
for asset in "${ASSETS[@]}"; do
  cp "$SCRIPT_DIR/$asset" "$INSTALL_ROOT/$asset"
  if [[ "$asset" == "orbit-ollama-start-macos.sh" ]]; then
    chmod 755 "$INSTALL_ROOT/$asset"
  else
    chmod 644 "$INSTALL_ROOT/$asset"
  fi
done
mkdir -p "$INSTALL_ROOT/vendor/katex"
for vendor_asset in "${VENDOR_ASSETS[@]}"; do
  cp "$vendor_asset" "$INSTALL_ROOT/vendor/katex/$(basename "$vendor_asset")"
  chmod 644 "$INSTALL_ROOT/vendor/katex/$(basename "$vendor_asset")"
done

mkdir -p "$INSTALL_ROOT/vendor/widgets"
cp -R "$SCRIPT_DIR/vendor/widgets/." "$INSTALL_ROOT/vendor/widgets/"
find "$INSTALL_ROOT/vendor/widgets" -type d -exec chmod 755 {} +
find "$INSTALL_ROOT/vendor/widgets" -type f -exec chmod 644 {} +

mkdir -p "$INSTALL_ROOT/vendor/analyze"
cp -R "$SCRIPT_DIR/vendor/analyze/." "$INSTALL_ROOT/vendor/analyze/"
chmod -R a+rX "$INSTALL_ROOT/vendor/analyze"
mkdir -p "$INSTALL_ROOT/vendor/readers"
cp -R "$SCRIPT_DIR/vendor/readers/." "$INSTALL_ROOT/vendor/readers/"
find "$INSTALL_ROOT/vendor/readers" -type d -exec chmod 755 {} +
find "$INSTALL_ROOT/vendor/readers" -type f -exec chmod 644 {} +

mkdir -p "$INSTALL_ROOT/vendor/sheetjs"
cp "$SCRIPT_DIR/vendor/sheetjs/xlsx.full.min.js" "$SCRIPT_DIR/vendor/sheetjs/LICENSE" "$INSTALL_ROOT/vendor/sheetjs/"
chmod 644 "$INSTALL_ROOT/vendor/sheetjs/"*

CERT_FILE="$INSTALL_ROOT/orbit.com.pem"
KEY_FILE="$INSTALL_ROOT/orbit.com-key.pem"
CERT_BACKUP_DIR="$INSTALL_ROOT/.orbit-cert-backup"
if [[ -e "$CERT_BACKUP_DIR" ]]; then
  if [[ -f "$CERT_BACKUP_DIR/orbit.com.pem" && -f "$CERT_BACKUP_DIR/orbit.com-key.pem" ]]; then
    printf 'Recovering the previous Orbit certificate pair before continuing...\n'
    rm -f "$CERT_FILE" "$KEY_FILE"
    mv -f "$CERT_BACKUP_DIR/orbit.com.pem" "$CERT_FILE"
    mv -f "$CERT_BACKUP_DIR/orbit.com-key.pem" "$KEY_FILE"
    rm -rf "$CERT_BACKUP_DIR"
  else
    backup_file_found=0
    for backup_file in "$CERT_BACKUP_DIR"/*; do
      if [[ -f "$backup_file" ]]; then
        backup_file_found=1
        break
      fi
    done
    if [[ "$backup_file_found" -eq 1 ]]; then
      die "An incomplete Orbit certificate backup was found at $CERT_BACKUP_DIR. Verify it before retrying."
    fi
    rm -rf "$CERT_BACKUP_DIR"
  fi
fi
CERT_CONFIG="$(mktemp -t orbit-cert-config)"
CERT_WORK_DIR="$(mktemp -d "$INSTALL_ROOT/.orbit-cert.XXXXXX")"
CERT_MOVED_TO_BACKUP=0
KEY_MOVED_TO_BACKUP=0
CERT_NEW_INSTALLED=0
KEY_NEW_INSTALLED=0

restore_previous_certificate_pair() {
  if [[ "$CERT_NEW_INSTALLED" -eq 1 ]]; then
    if ! rm -f "$CERT_FILE"; then return 1; fi
    CERT_NEW_INSTALLED=0
  fi
  if [[ "$KEY_NEW_INSTALLED" -eq 1 ]]; then
    if ! rm -f "$KEY_FILE"; then return 1; fi
    KEY_NEW_INSTALLED=0
  fi
  if [[ "$CERT_MOVED_TO_BACKUP" -eq 1 && -f "$CERT_BACKUP_DIR/orbit.com.pem" ]]; then
    if ! mv -f "$CERT_BACKUP_DIR/orbit.com.pem" "$CERT_FILE"; then return 1; fi
    CERT_MOVED_TO_BACKUP=0
  fi
  if [[ "$KEY_MOVED_TO_BACKUP" -eq 1 && -f "$CERT_BACKUP_DIR/orbit.com-key.pem" ]]; then
    if ! mv -f "$CERT_BACKUP_DIR/orbit.com-key.pem" "$KEY_FILE"; then return 1; fi
    KEY_MOVED_TO_BACKUP=0
  fi
}

cleanup() {
  rm -f "$CERT_CONFIG"
  rm -rf "$CERT_WORK_DIR"
  if [[ -n "$CERT_BACKUP_DIR" ]]; then
    if restore_previous_certificate_pair; then
      rm -rf "$CERT_BACKUP_DIR"
    else
      printf 'Orbit installer warning: previous certificate backup was kept at %s\n' "$CERT_BACKUP_DIR" >&2
    fi
  fi
}
trap cleanup EXIT

cat > "$CERT_CONFIG" <<'CERT_CONFIG_EOF'
[req]
distinguished_name = req_distinguished_name
x509_extensions = v3_req
prompt = no

[req_distinguished_name]
CN = orbit.com

[v3_req]
subjectAltName = @alt_names
basicConstraints = critical,CA:FALSE
keyUsage = critical,digitalSignature,keyEncipherment
extendedKeyUsage = serverAuth

[alt_names]
DNS.1 = orbit.com
DNS.2 = localhost
IP.1 = 127.0.0.1
IP.2 = ::1
CERT_CONFIG_EOF

CERT_TEMP_FILE="$CERT_WORK_DIR/orbit.com.pem"
KEY_TEMP_FILE="$CERT_WORK_DIR/orbit.com-key.pem"
openssl req -x509 -newkey rsa:2048 -nodes -sha256 -days 365 -keyout "$KEY_TEMP_FILE" -out "$CERT_TEMP_FILE" -config "$CERT_CONFIG" >/dev/null 2>&1
[[ -s "$CERT_TEMP_FILE" && -s "$KEY_TEMP_FILE" ]] || die "Could not create the Orbit HTTPS certificate."
chmod 600 "$KEY_TEMP_FILE"
chmod 644 "$CERT_TEMP_FILE"

if ! mkdir -m 700 "$CERT_BACKUP_DIR"; then
  die "Could not create a safe Orbit certificate backup directory."
fi
if [[ -e "$CERT_FILE" ]]; then
  if ! mv -f "$CERT_FILE" "$CERT_BACKUP_DIR/orbit.com.pem"; then
    rm -rf "$CERT_BACKUP_DIR"
    CERT_BACKUP_DIR=""
    die "Could not stage the existing Orbit certificate for replacement."
  fi
  CERT_MOVED_TO_BACKUP=1
fi
if [[ -e "$KEY_FILE" ]]; then
  if ! mv -f "$KEY_FILE" "$CERT_BACKUP_DIR/orbit.com-key.pem"; then
    if ! restore_previous_certificate_pair; then
      die "Could not restore the existing Orbit certificate pair after staging failed."
    fi
    rm -rf "$CERT_BACKUP_DIR"
    CERT_BACKUP_DIR=""
    die "Could not stage the existing Orbit certificate key for replacement."
  fi
  KEY_MOVED_TO_BACKUP=1
fi
if ! mv -f "$CERT_TEMP_FILE" "$CERT_FILE"; then
  if ! restore_previous_certificate_pair; then
    die "Could not restore the existing Orbit certificate pair after replacement failed."
  fi
  rm -rf "$CERT_BACKUP_DIR"
  CERT_BACKUP_DIR=""
  die "Could not install the new Orbit certificate."
fi
CERT_NEW_INSTALLED=1
if ! mv -f "$KEY_TEMP_FILE" "$KEY_FILE"; then
  if ! restore_previous_certificate_pair; then
    die "Could not restore the existing Orbit certificate pair after key replacement failed."
  fi
  rm -rf "$CERT_BACKUP_DIR"
  CERT_BACKUP_DIR=""
  die "Could not install the new Orbit certificate key."
fi
KEY_NEW_INSTALLED=1
rm -rf "$CERT_BACKUP_DIR"
CERT_BACKUP_DIR=""

if [[ ! -f "$HOSTS_FILE" ]]; then
  mkdir -p "$(dirname "$HOSTS_FILE")"
  touch "$HOSTS_FILE"
fi
normalize_hosts_file() {
  local temp_file
  temp_file="$(mktemp "${HOSTS_FILE}.orbit.XXXXXX")"
  awk '
    {
      if ($0 ~ /^[[:space:]]*#[[:space:]]*Orbit local domain[[:space:]]*$/) next
      hash = index($0, "#")
      data = hash ? substr($0, 1, hash - 1) : $0
      comment = hash ? substr($0, hash) : ""
      count = split(data, tokens, /[[:space:]]+/)
      has_orbit = 0
      for (token_index = 1; token_index <= count; token_index++) {
        lowered = tolower(tokens[token_index])
        if (lowered == "orbit.com" || lowered == "orbit.com.") has_orbit = 1
      }
      if (!has_orbit) {
        print $0
        next
      }
      output = ""
      has_hostname = 0
      for (token_index = 1; token_index <= count; token_index++) {
        token = tokens[token_index]
        lowered = tolower(token)
        if (token == "" || lowered == "orbit.com" || lowered == "orbit.com.") continue
        output = output (output ? " " : "") token
        if (token !~ /^[0-9]+(\.[0-9]+){3}$/ && token !~ /^[0-9A-Fa-f:]+$/) has_hostname = 1
      }
      if (!has_hostname) next
      if (comment) output = output (output ? " " : "") comment
      print output
    }
  ' "$HOSTS_FILE" > "$temp_file"
  printf '\n# Orbit local domain\n127.0.0.1 orbit.com\n::1 orbit.com\n' >> "$temp_file"
  chmod 644 "$temp_file"
  if [[ "$IS_STAGING" -eq 0 ]]; then
    chown root:wheel "$temp_file"
  fi
  mv -f "$temp_file" "$HOSTS_FILE"
}

normalize_hosts_file
if [[ "$IS_STAGING" -eq 0 ]]; then
  dscacheutil -flushcache || true
  killall -HUP mDNSResponder 2>/dev/null || true
fi

xml_escape() {
  printf '%s' "$1" | sed -e 's/&/\&amp;/g' -e 's/</\&lt;/g' -e 's/>/\&gt;/g' -e 's/"/\&quot;/g'
}

install_ollama_launch_agent() {
  if [[ "$IS_STAGING" -eq 1 ]]; then
    return 0
  fi
  if [[ -z "$OLLAMA_BIN" || ! -x "$OLLAMA_BIN" ]]; then
    printf 'Ollama auto-start was not registered because its executable could not be located.\n' >&2
    return 0
  fi
  if [[ ! "$LOGIN_UID" =~ ^[0-9]+$ || -z "$LOGIN_USER" || -z "$LOGIN_HOME" || ! -d "$LOGIN_HOME" ]]; then
    printf 'Ollama auto-start was not registered because the logged-in user profile could not be resolved.\n' >&2
    return 0
  fi

  local login_group
  local launch_agents_dir="$LOGIN_HOME/Library/LaunchAgents"
  local log_dir="$LOGIN_HOME/Library/Logs/Orbit"
  local plist="$launch_agents_dir/$OLLAMA_LAUNCHD_LABEL.plist"
  local helper="$INSTALL_ROOT/orbit-ollama-start-macos.sh"
  login_group="$(id -gn "$LOGIN_USER" 2>/dev/null || true)"
  [[ -n "$login_group" ]] || login_group="staff"
  [[ -x "$helper" ]] || die "Missing Ollama startup helper: $helper"

  mkdir -p "$launch_agents_dir" "$log_dir"
  chown "$LOGIN_UID:$login_group" "$launch_agents_dir" "$log_dir"
  chmod 700 "$launch_agents_dir" "$log_dir"

  local ollama_xml helper_xml log_dir_xml
  ollama_xml="$(xml_escape "$OLLAMA_BIN")"
  helper_xml="$(xml_escape "$helper")"
  log_dir_xml="$(xml_escape "$log_dir")"
  cat > "$plist" <<PLIST_EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>$OLLAMA_LAUNCHD_LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>$helper_xml</string>
    <string>$ollama_xml</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <dict>
    <key>SuccessfulExit</key>
    <false/>
  </dict>
  <key>ThrottleInterval</key>
  <integer>5</integer>
  <key>StandardOutPath</key>
  <string>$log_dir_xml/ollama-launch.log</string>
  <key>StandardErrorPath</key>
  <string>$log_dir_xml/ollama-launch-error.log</string>
</dict>
</plist>
PLIST_EOF
  chown "$LOGIN_UID:$login_group" "$plist"
  chmod 644 "$plist"

  launchctl bootout "gui/$LOGIN_UID/$OLLAMA_LAUNCHD_LABEL" 2>/dev/null || true
  launchctl bootstrap "gui/$LOGIN_UID" "$plist" || die "Could not register Ollama to start automatically at user login."
  launchctl enable "gui/$LOGIN_UID/$OLLAMA_LAUNCHD_LABEL" 2>/dev/null || true
  launchctl kickstart -k "gui/$LOGIN_UID/$OLLAMA_LAUNCHD_LABEL" 2>/dev/null || true
  printf 'Ollama is registered to start automatically for %s at login.\n' "$LOGIN_USER"
}

if [[ "$IS_STAGING" -eq 0 ]]; then
  security find-certificate -a -p /System/Library/Keychains/SystemRootCertificates.keychain > "$INSTALL_ROOT/system-ca.pem"
  [[ -s "$INSTALL_ROOT/system-ca.pem" ]] || die "Could not load macOS HTTPS root certificates."
  chmod 644 "$INSTALL_ROOT/system-ca.pem"
fi
PYTHON_XML="$(xml_escape "$PYTHON_BIN")"
INSTALL_ROOT_XML="$(xml_escape "$INSTALL_ROOT")"
SERVER_XML="$(xml_escape "$INSTALL_ROOT/server.py")"
PLIST="$LAUNCHD_DIR/$APP_LABEL.plist"
cat > "$PLIST" <<PLIST_EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>$APP_LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>$PYTHON_XML</string>
    <string>$SERVER_XML</string>
  </array>
  <key>WorkingDirectory</key>
  <string>$INSTALL_ROOT_XML</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>SSL_CERT_FILE</key>
    <string>$INSTALL_ROOT_XML/system-ca.pem</string>
    <key>PYTHONUNBUFFERED</key>
    <string>1</string>
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>ThrottleInterval</key>
  <integer>5</integer>
  <key>StandardOutPath</key>
  <string>$INSTALL_ROOT_XML/orbit-server.log</string>
  <key>StandardErrorPath</key>
  <string>$INSTALL_ROOT_XML/orbit-server-error.log</string>
</dict>
</plist>
PLIST_EOF

DNS_PLIST="$LAUNCHD_DIR/com.orbit.local-dns.plist"
cat > "$DNS_PLIST" <<DNS_PLIST_EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>com.orbit.local-dns</string>
<key>ProgramArguments</key><array><string>$PYTHON_XML</string><string>$INSTALL_ROOT_XML/orbit-dns.py</string></array>
<key>RunAtLoad</key><true/><key>KeepAlive</key><true/>
<key>ThrottleInterval</key><integer>5</integer>
<key>StandardErrorPath</key><string>$INSTALL_ROOT_XML/orbit-dns-error.log</string>
</dict></plist>
DNS_PLIST_EOF
chmod 644 "$DNS_PLIST"
if [[ "$IS_STAGING" -eq 0 ]]; then
  chown root:wheel "$DNS_PLIST"
  launchctl bootout system/com.orbit.local-dns 2>/dev/null || true
  launchctl bootstrap system "$DNS_PLIST"
  launchctl enable system/com.orbit.local-dns
  launchctl kickstart -k system/com.orbit.local-dns
  "$PYTHON_BIN" - <<'DNS_CHECK'
import socket, struct, time
query = struct.pack('!6H', 1234, 0x100, 1, 0, 0, 0) + b'\x05orbit\x03com\x00' + struct.pack('!HH', 1, 1)
for attempt in range(20):
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as sock:
            sock.settimeout(.5)
            sock.sendto(query, ('127.0.0.1', 15353))
            data = sock.recv(512)
            if data[:2] == query[:2] and data.endswith(b'\x7f\x00\x00\x01'):
                break
    except OSError:
        pass
    time.sleep(.2)
else:
    raise SystemExit('Orbit DNS did not start; scoped DNS configuration was not changed.')
DNS_CHECK
fi
cat > "$RESOLVER_FILE" <<'RESOLVER_EOF'
# Orbit managed resolver
nameserver 127.0.0.1
port 15353
timeout 2
RESOLVER_EOF
chmod 644 "$RESOLVER_FILE"
if [[ "$IS_STAGING" -eq 0 ]]; then
  chown root:wheel "$RESOLVER_FILE"
  dscacheutil -flushcache
  killall -HUP mDNSResponder || true
fi

if [[ "$IS_STAGING" -eq 1 ]]; then
  printf 'Staged Orbit install created at: %s\n' "$INSTALL_ROOT"
  printf 'Staged hosts file: %s\n' "$HOSTS_FILE"
  printf 'Staged launchd file: %s\n' "$PLIST"
  exit 0
fi

printf 'Trusting the Orbit HTTPS certificate...\n'
security add-trusted-cert -d -r trustRoot -k /Library/Keychains/System.keychain "$CERT_FILE"

chown -R root:wheel "$INSTALL_ROOT"
chmod 600 "$KEY_FILE"
chown root:wheel "$PLIST"
chmod 644 "$PLIST"

install_ollama_launch_agent

CURRENT_UID="${SUDO_UID:-$(id -u)}"
launchctl bootout "gui/$CURRENT_UID/$APP_LABEL" 2>/dev/null || true
launchctl bootout "system/$APP_LABEL" 2>/dev/null || true
launchctl bootstrap system "$PLIST"
launchctl enable "system/$APP_LABEL"
launchctl kickstart -k "system/$APP_LABEL"

orbit_endpoint_is_healthy() {
  local address="$1"
  curl --noproxy '*' -fsS --connect-timeout 1 --max-time 3 \
    --resolve "orbit.com:443:$address" https://orbit.com/index.html 2>/dev/null \
    | grep -Fq "$EXPECTED_APP_ASSET"
}

printf 'Waiting for Orbit to answer on HTTPS...\n'
for attempt in {1..10}; do
  if orbit_endpoint_is_healthy '127.0.0.1' && orbit_endpoint_is_healthy '[::1]'; then
    # The source checkout may still be serving Orbit. Never delete its keys.
    printf '\nOrbit is installed. Open https://orbit.com\nQuit and reopen Safari after installing to clear old DNS connections.\nIf this is your first Ollama installation, add a model or sign in for cloud models.\n'
    # Open the browser as the original desktop user, never as root. Failure
    # to open a browser must not turn a healthy installation into an error.
    if [[ "$LOGIN_UID" =~ ^[0-9]+$ && -n "$LOGIN_USER" ]]; then
      launchctl asuser "$LOGIN_UID" /usr/bin/sudo -u "$LOGIN_USER" /usr/bin/open 'https://orbit.com' \
        || printf 'Open https://orbit.com in your browser to start Orbit.\n'
    fi
    exit 0
  fi
  sleep 1
done

printf 'Orbit was installed, but its trusted HTTPS server did not answer over both IPv4 and IPv6 yet. Check %s/orbit-server-error.log.\n' "$INSTALL_ROOT" >&2
exit 1
