#!/usr/bin/env bash
export GSD_CORE_SCOPE_ANY=1
# Behavioral suite for require-memtrace-evidence.sh (quota-marker gate).
#   bash gsd-core-hooks/hooks/require-memtrace-evidence.test.sh
set -uo pipefail
cd "$(dirname "$0")" || exit 1
HOOK=$PWD/require-memtrace-evidence.sh
D=$(mktemp -d); trap 'rm -rf "$D"' EXIT
N=0; F=0
pass() { N=$((N+1)); echo "PASS  $1"; }
fail() { N=$((N+1)); F=$((F+1)); echo "FAIL  $1 -> $2"; }
CG=$'### CodeGraph Evidence\n- codegraph impact foo: 3 callers\n- codegraph callers foo: a, b\n'
CGPART=$'### CodeGraph Evidence\n- codegraph impact foo: 3 callers\n'
MT=$'### Memtrace Evidence\nget_impact get_symbol_context recall_decision find_code_review_issues\n'
VERB="gh pr review 7"
run() { # body statefile
  printf '%s' "$1" > "$D/body.md"
  OUT=$(MEMTRACE_QUOTA_STATE="$2" bash "$HOOK" <<<"$(jq -n --arg c "$VERB --approve --body-file $D/body.md" '{tool_input:{command:$c}}')")
}
denied() { printf '%s' "$OUT" | grep -q '"permissionDecision": "deny"'; }
now=$(python3 -c 'import time;print(int(time.time()*1000))')
echo "{\"blocked\":true,\"until\":$((now+3600000))}" > "$D/live.json"
echo "{\"blocked\":true,\"until\":$((now-1000))}" > "$D/expired.json"
echo "{\"blocked\":false,\"until\":$((now+3600000))}" > "$D/unblocked.json"
echo "not json" > "$D/bad.json"

run "$CG" "$D/live.json"
! denied && printf '%s' "$OUT" | grep -qE 'returns at [0-9]{4}-[0-9]{2}-[0-9]{2}T' && pass "live cooldown: CodeGraph evidence accepted with ISO return time" || fail live "$OUT"
run "$CGPART" "$D/live.json"
denied && printf '%s' "$OUT" | grep -q 'callers|callees|node' && pass "live cooldown: missing callers/callees/node denied" || fail partial "$OUT"
for s in expired unblocked bad missing; do
  run "$CG" "$D/$s.json"
  denied && printf '%s' "$OUT" | grep -q 'Memtrace is not in a quota cooldown; run the Memtrace tools' && pass "$s marker: CodeGraph evidence denied" || fail "$s" "$OUT"
done
run $'Memtrace unavailable: quota\n'"$CG" "$D/missing.json"
denied && pass "self-attested line no longer accepted" || fail selfattest "$OUT"
run "$MT" "$D/missing.json"; ! denied && pass "full Memtrace evidence accepted without marker" || fail mt "$OUT"
run $'### Memtrace Evidence\nget_impact only\n' "$D/live.json"; denied && pass "partial Memtrace evidence denied" || fail mtpart "$OUT"
echo "$N checks, $F failed"; [ "$F" -eq 0 ]
