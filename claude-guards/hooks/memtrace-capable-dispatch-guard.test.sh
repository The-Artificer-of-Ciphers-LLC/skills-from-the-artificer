#!/usr/bin/env bash
# Behavioral suite for memtrace-capable-dispatch-guard.cjs.
#   bash ~/.claude/hooks/memtrace-capable-dispatch-guard.test.sh
set -uo pipefail
cd "$(dirname "$0")" || exit 1
GUARD="$(pwd)/memtrace-capable-dispatch-guard.cjs"

N=0; F=0

# Self-contained fixture: a git repo standing in for the scoped root, a real
# worktree under it, and a sibling "<root>-other" directory.
TMP=$(mktemp -d)
CORE="$TMP/gsd-core"
WT="$CORE/.claude/worktrees/ci-timeout-rolling-pr"
OTHER="$TMP/gsd-core-other"
cleanup() {
  git -C "$CORE" worktree prune >/dev/null 2>&1
  rm -rf "$TMP"
  [ -n "${CORE:-}" ] && git -C "$CORE" worktree prune >/dev/null 2>&1
}
trap cleanup EXIT
mkdir -p "$CORE" "$OTHER" || exit 1
git -C "$CORE" init -q || exit 1
git -C "$CORE" -c user.email=t@example.com -c user.name=t commit -q --allow-empty -m init || exit 1
mkdir -p "$CORE/.claude/worktrees"
git -C "$CORE" worktree add -q "$WT" -b fixture-wt || exit 1
export MEMTRACE_DISPATCH_GUARD_ROOT="$CORE"

decision() { # decision <stdin-text>
  printf '%s' "$1" | node "$GUARD" 2>/dev/null | python3 -c 'import json,sys
try:
    print(json.load(sys.stdin)["hookSpecificOutput"].get("permissionDecision",""))
except Exception:
    print("none")'
}
expect() { # expect <name> <want> <stdin-text>
  local got; got=$(decision "$3"); N=$((N+1))
  if [ "$got" = "$2" ]; then echo "PASS  $1"; else F=$((F+1)); echo "FAIL  $1 -> got $got, want $2"; fi
}
payload() { printf '{"tool_name":"Agent","tool_input":{"subagent_type":"%s"},"cwd":"%s"}' "$1" "$2"; }

for T in sonnet-coder haiku-scout haiku-importer; do
  expect "$T in gsd-core cwd -> deny" deny "$(payload $T $CORE)"
  expect "$T in gsd-core worktree cwd -> deny" deny "$(payload $T $WT)"
done
expect "case-insensitive Sonnet-Coder -> deny" deny "$(payload Sonnet-Coder $CORE)"
expect "general-purpose in gsd-core -> allow" allow "$(payload general-purpose $CORE)"
expect "sonnet-coder outside gsd-core -> allow" allow "$(payload sonnet-coder /tmp)"
expect "sonnet-coder in sibling path gsd-core-other -> allow" allow "$(payload sonnet-coder $OTHER)"
expect "malformed stdin -> allow" allow "not json {"
expect "empty stdin -> allow" allow ""
expect "no subagent_type -> allow" allow "{\"tool_name\":\"Agent\",\"tool_input\":{},\"cwd\":\"$CORE\"}"
# Default (no env var) resolves to $HOME/projects/gsd-core; pure path resolution,
# the fake HOME directory tree is intentionally never created.
FAKEHOME="$TMP/fakehome"
dec_default=$(printf '%s' "$(payload sonnet-coder "$FAKEHOME/projects/gsd-core/sub")" | env -u MEMTRACE_DISPATCH_GUARD_ROOT HOME="$FAKEHOME" node "$GUARD" 2>/dev/null | python3 -c 'import json,sys
print(json.load(sys.stdin)["hookSpecificOutput"].get("permissionDecision",""))')
dec_sib=$(printf '%s' "$(payload sonnet-coder "$FAKEHOME/projects/gsd-core-other")" | env -u MEMTRACE_DISPATCH_GUARD_ROOT HOME="$FAKEHOME" node "$GUARD" 2>/dev/null | python3 -c 'import json,sys
print(json.load(sys.stdin)["hookSpecificOutput"].get("permissionDecision",""))')
N=$((N+1))
if [ "$dec_default" = deny ] && [ "$dec_sib" = allow ]; then echo "PASS  default root resolves to \$HOME/projects/gsd-core"; else F=$((F+1)); echo "FAIL  default root -> in=$dec_default sibling=$dec_sib"; fi

echo
echo "memtrace-capable-dispatch-guard suite: $((N-F))/$N passed"
[ $F -eq 0 ] && exit 0 || exit 1
