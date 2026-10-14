#!/usr/bin/env bash
# Symlink the agents from this checkout into Claude Code and opencode.
# Files stay here; nothing is copied. Re-run after adding an agent.
#   Claude:   ~/.claude/agents/<n>.md         -> agents/<n>.md
#   opencode: ~/.config/opencode/agents/<n>.md -> opencode/agents/<n>.md  (generated)
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
"$here/scripts/build-opencode.sh" >/dev/null
link() { # src dst
  if [ -e "$2" ] && [ ! -L "$2" ]; then echo "skip (real file exists): $2"; return; fi
  ln -sfn "$1" "$2"
}
mkdir -p "$HOME/.claude/agents" "${XDG_CONFIG_HOME:-$HOME/.config}/opencode/agents"
for f in "$here"/agents/*.md; do
  n="$(basename "$f")"
  link "$f" "$HOME/.claude/agents/$n"
  link "$here/opencode/agents/$n" "${XDG_CONFIG_HOME:-$HOME/.config}/opencode/agents/$n"
done
echo "linked $(ls "$here"/agents/*.md | wc -l | tr -d ' ') agents into Claude Code and opencode"
