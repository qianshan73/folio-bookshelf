#!/usr/bin/env sh
set -eu
cd "$(dirname "$0")"
if ! command -v node >/dev/null 2>&1; then
  echo 'Please install Node.js 24+ from https://nodejs.org/'
  exit 1
fi
if [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 24 ]; then
  echo 'Node.js 24 or newer is required.'
  exit 1
fi
if [ ! -d node_modules/marked ]; then npm ci --omit=dev; fi
FOLIO_OPEN=1 node server.mjs
