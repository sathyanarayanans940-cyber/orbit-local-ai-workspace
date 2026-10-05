#!/bin/bash
set -euo pipefail

OLLAMA_BIN="${1:?Ollama executable path was not provided}"

# If Ollama's desktop app or another instance already owns the API, do not
# start a second daemon. This also makes the launch agent safe to install on
# machines where Ollama already starts at login.
if /usr/bin/curl --noproxy '*' -fsS --connect-timeout 1 --max-time 2 \
  http://127.0.0.1:11434/api/tags >/dev/null 2>&1; then
  exit 0
fi

exec "$OLLAMA_BIN" serve
