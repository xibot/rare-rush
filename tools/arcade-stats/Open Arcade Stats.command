#!/bin/zsh
set -eu
cd -- "$(dirname -- "$0")/../.."
if command -v node >/dev/null 2>&1; then
  node tools/arcade-stats/open.mjs
elif [[ -x /opt/homebrew/bin/node ]]; then
  /opt/homebrew/bin/node tools/arcade-stats/open.mjs
elif [[ -x /usr/local/bin/node ]]; then
  /usr/local/bin/node tools/arcade-stats/open.mjs
else
  print 'Node.js is needed. Open this project in your terminal and run: node tools/arcade-stats/server.mjs'
  exit 1
fi
