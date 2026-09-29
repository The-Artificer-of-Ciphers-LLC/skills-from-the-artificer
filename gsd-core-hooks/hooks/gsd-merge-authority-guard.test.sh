#!/usr/bin/env bash
# Behavioral suite for gsd-merge-authority-guard.cjs (author rule + core gates). `gh` is faked.
#   bash gsd-core-hooks/hooks/gsd-merge-authority-guard.test.sh
set -uo pipefail
cd "$(dirname "$0")" || exit 1
HOOK=$PWD/gsd-merge-authority-guard.cjs
D=$(mktemp -d); trap 'rm -rf "$D"' EXIT
mkdir -p "$D/bin"; cp ../../claude-guards/hooks/fake-gh.sh "$D/bin/gh"; chmod +x "$D/bin/gh"
N=0; F=0
pass() { N=$((N+1)); echo "PASS  $1"; }
fail() { N=$((N+1)); F=$((F+1)); echo "FAIL  $1 -> $2"; }
green='[{"__typename":"CheckRun","workflowName":"CI","name":"Tests","status":"COMPLETED","conclusion":"SUCCESS"}]'
red='[{"__typename":"CheckRun","workflowName":"CI","name":"Tests","status":"COMPLETED","conclusion":"FAILURE"}]'
pr() { # author reviewDecision rollup [mergeable]
  printf '{"number":7,"url":"https://github.com/open-gsd/gsd-core/pull/7","isDraft":false,"author":{"login":"%s"},"baseRefName":"next","headRefOid":"0123456789abcdef","mergeable":"%s","mergeStateStatus":"BLOCKED","reviewDecision":"%s","statusCheckRollup":%s}' \
    "$1" "${4:-MERGEABLE}" "$2" "$3" > "$D/pr.json"
}
run() { # command [ENV=val ...]
  local cmd="$1"; shift
  OUT=$( export HOME="$D" PATH="$D/bin:$PATH" FAKE_PR_JSON="$D/pr.json" FAKE_BEHIND=0; unset GSD_MERGE_GATE_OVERRIDE GSD_MERGE_ADMIN_AUTHOR
         for kv in "$@"; do export "$kv"; done
         python3 -c 'import json,sys;print(json.dumps({"tool_input":{"command":sys.argv[1]},"cwd":sys.argv[2]}))' "$cmd" "$D" | node "$HOOK" )
}
denied() { printf '%s' "$OUT" | grep -q '"permissionDecision":"deny"'; }
ADMIN="gh pr merge 7 --admin --squash --repo open-gsd/gsd-core"

pr trek-e REVIEW_REQUIRED "$green"; run "$ADMIN"; [ -z "$OUT" ] && pass "own PR, only blocker 2nd review: admin merge allowed" || fail "own" "$OUT"
pr Trek-E REVIEW_REQUIRED "$green"; run "$ADMIN"; [ -z "$OUT" ] && pass "login match is case-insensitive" || fail "case" "$OUT"
pr contributor42 REVIEW_REQUIRED "$green"; run "$ADMIN"
denied && printf '%s' "$OUT" | grep -q 'authored by contributor42' && pass "contributor PR: admin bypass denied" || fail "contrib" "$OUT"
printf '{"number":7,"url":"https://github.com/open-gsd/gsd-core/pull/7","isDraft":false,"baseRefName":"next","headRefOid":"0123","mergeable":"MERGEABLE","mergeStateStatus":"BLOCKED","reviewDecision":"REVIEW_REQUIRED","statusCheckRollup":%s}' "$green" > "$D/pr.json"
run "$ADMIN"; denied && pass "unknown author: denied" || fail "no author" "$OUT"
pr trek-e REVIEW_REQUIRED "$red"; run "$ADMIN"; denied && printf '%s' "$OUT" | grep -q 'checks failed' && pass "own PR with red check: denied" || fail "own red" "$OUT"
pr trek-e REVIEW_REQUIRED "$green" CONFLICTING; run "$ADMIN"; denied && printf '%s' "$OUT" | grep -q 'conflict' && pass "own PR with conflict: denied" || fail "own conflict" "$OUT"
pr trek-e REVIEW_REQUIRED "$green"; run "$ADMIN" FAKE_BEHIND=3; denied && printf '%s' "$OUT" | grep -q 'BEHIND' && pass "own PR behind base: denied" || fail "own behind" "$OUT"
pr trek-e CHANGES_REQUESTED "$green"; run "$ADMIN"; denied && pass "own PR with changes requested: denied" || fail "changes req" "$OUT"
pr contributor42 APPROVED "$green"; run "gh pr merge 7 --squash --repo open-gsd/gsd-core"; [ -z "$OUT" ] && pass "approved contributor PR, normal merge: allowed" || fail "normal" "$OUT"
pr alice REVIEW_REQUIRED "$green"; run "$ADMIN" GSD_MERGE_ADMIN_AUTHOR=alice,bob; [ -z "$OUT" ] && pass "GSD_MERGE_ADMIN_AUTHOR widens the set" || fail "env allow" "$OUT"
pr trek-e REVIEW_REQUIRED "$green"; run "$ADMIN" GSD_MERGE_ADMIN_AUTHOR=alice; denied && pass "GSD_MERGE_ADMIN_AUTHOR replaces the default" || fail "env replace" "$OUT"
pr contributor42 REVIEW_REQUIRED "$green"; run "GSD_MERGE_GATE_OVERRIDE=1 $ADMIN"; [ -z "$OUT" ] && pass "human override still works" || fail "override" "$OUT"
run "gh pr view 7"; [ -z "$OUT" ] && pass "non-merge gh command untouched" || fail "non-merge" "$OUT"
echo "---- $((N-F))/$N passed"; [ "$F" -eq 0 ]
