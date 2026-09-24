#!/bin/zsh
set -eu
agent_play_dir="${0:A:h}"
cd "$agent_play_dir/../.."
if [[ -x /opt/homebrew/bin/node ]]; then
  agent_play_node=/opt/homebrew/bin/node
else
  agent_play_node=$(command -v node)
fi
print 'Starting Rare Rush | Agent Play at http://127.0.0.1:4220/'
print 'Keep this terminal open. Press Control-C to stop the local preview.'
exec "$agent_play_node" drafts/agent-play/serve.mjs
