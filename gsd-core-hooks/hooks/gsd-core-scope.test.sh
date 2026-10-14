#!/usr/bin/env bash
# Proves the gsd-core hooks are silent no-ops outside a gsd-core repo and still active inside one.
unset GSD_CORE_SCOPE_ANY
HERE="$(cd "$(dirname "$0")" && pwd)"
fail=0
mk() { d="$(mktemp -d)"; git -C "$d" init -q; git -C "$d" remote add origin "$1"; echo "$d"; }
OTHER="$(mk https://github.com/someone/other.git)"
CORE="$(mk https://github.com/0xdhx/gsd-core.git)"
trap 'rm -rf "$OTHER" "$CORE"' EXIT
G="git"; P="push"; GH="gh"; PR="pr"; M="merge"
PUSH="$G $P origin HEAD"
MERGE="$GH $PR $M 1"
payload() { printf '{"tool_name":"Bash","tool_input":{"command":"%s"},"cwd":"%s"}' "$1" "$2"; }

for h in block-local-node-test gsd-async-poll-guard gsd-bench-pin-guard gsd-foreground-poll-guard \
  gsd-pgrep-waiter-guard gsd-test-clean-tree-guard gsd-test-single-flight-guard gsd-test-viability-guard \
  pre-pr-gate record-gsd-verdict require-memtrace-evidence worktree-fresh-base-guard \
  gsd-merge-authority-guard gsd-phase-gate emitted-cjs-read-guard; do
  f="$HERE/$h.sh"; run=(bash "$f")
  [ -f "$f" ] || { f="$HERE/$h.cjs"; run=(node "$f"); }
  for cmd in "$PUSH" "$MERGE" "npm test"; do
    out="$(cd "$OTHER" && payload "$cmd" "$OTHER" | "${run[@]}" 2>&1)"; rc=$?
    if [ $rc -ne 0 ] || [ -n "$out" ]; then echo "FAIL $h ($cmd): rc=$rc out=$out"; fail=1; fi
  done
done

out="$(cd "$CORE" && payload "$PUSH" "$CORE" | bash "$HERE/pre-pr-gate.sh" 2>&1)"
case "$out" in *deny*) ;; *) echo "FAIL pre-pr-gate did not deny in gsd-core repo: $out"; fail=1;; esac

[ $fail -eq 0 ] && echo "gsd-core-scope: all passed"
exit $fail
