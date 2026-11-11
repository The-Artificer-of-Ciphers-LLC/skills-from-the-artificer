#!/usr/bin/env bash
export GSD_CORE_SCOPE_ANY=1
# Behavioral suite for require-memtrace-evidence.sh (graph evidence gate).
#   bash gsd-core-hooks/hooks/require-memtrace-evidence.test.sh
set -uo pipefail
cd "$(dirname "$0")" || exit 1
HOOK=$PWD/require-memtrace-evidence.sh
D=$(mktemp -d); trap 'rm -rf "$D"' EXIT
N=0; F=0
pass() { N=$((N+1)); echo "PASS  $1"; }
fail() { N=$((N+1)); F=$((F+1)); echo "FAIL  $1 -> $2"; }
run() { # body [flag]
  printf '%s' "$1" > "$D/body.md"
  OUT=$(bash "$HOOK" <<<"$(jq -n --arg c "gh pr review 7 ${2:---approve} --body-file $D/body.md" '{tool_input:{command:$c}}')")
}
denied() { printf '%s' "$OUT" | grep -q '"permissionDecision": "deny"'; }

run $'AI-assisted review by @trek-e.\n### Graph Evidence\n- codegraph impact foo: 3 callers\n'
! denied && pass "graph evidence with codegraph impact accepted" || fail cg "$OUT"
run $'### Graph Evidence\n- get_impact foo: medium risk\n' --request-changes
! denied && pass "graph evidence with get_impact accepted on request-changes" || fail mt "$OUT"
run $'### Memtrace Evidence\nget_impact get_symbol_context recall_decision find_code_review_issues\n'
! denied && pass "old Memtrace Evidence heading still accepted" || fail old "$OUT"
run $'### CodeGraph Evidence\n- codegraph impact foo: 3 callers\n'
! denied && pass "old CodeGraph Evidence heading accepted with no quota marker" || fail oldcg "$OUT"
run $'### Graph Evidence\n- codegraph callers foo: a, b\n'
denied && printf '%s' "$OUT" | grep -q 'no blast-radius call' && pass "section without a blast-radius call denied" || fail noimpact "$OUT"
run $'Summary only, codegraph impact mentioned in prose\n'
denied && printf '%s' "$OUT" | grep -q "missing the '### Graph Evidence' section" && pass "missing section denied" || fail nosection "$OUT"
OUT=$(bash "$HOOK" <<<"$(jq -n --arg c 'gh pr review 7 --approve --body-file "$BODY"' '{tool_input:{command:$c}}')")
denied && printf '%s' "$OUT" | grep -q 'No body found' && pass "unexpanded body path denied" || fail novar "$OUT"
OUT=$(bash "$HOOK" <<<"$(jq -n --arg c 'gh pr review 7 --comment --body "ok"' '{tool_input:{command:$c}}')")
[ -z "$OUT" ] && pass "--comment is exempt" || fail comment "$OUT"
echo "$N checks, $F failed"; [ "$F" -eq 0 ]
