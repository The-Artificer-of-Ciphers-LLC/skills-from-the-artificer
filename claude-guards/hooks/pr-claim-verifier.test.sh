#!/usr/bin/env bash
# Behavioral suite for pr-claim-verifier.cjs. `gh` is replaced by fake-gh.sh; HOME is isolated.
#   bash claude-guards/hooks/pr-claim-verifier.test.sh
set -uo pipefail
cd "$(dirname "$0")" || exit 1
HOOK=$PWD/pr-claim-verifier.cjs
D=$(mktemp -d); trap 'rm -rf "$D"' EXIT
mkdir -p "$D/bin"; cp fake-gh.sh "$D/bin/gh"; chmod +x "$D/bin/gh"
N=0; F=0
pass() { N=$((N+1)); echo "PASS  $1"; }
fail() { N=$((N+1)); F=$((F+1)); echo "FAIL  $1 -> $2"; }

green='[{"__typename":"CheckRun","name":"Tests","status":"COMPLETED","conclusion":"SUCCESS"}]'
red='[{"__typename":"CheckRun","name":"Tests","status":"COMPLETED","conclusion":"SUCCESS"},{"__typename":"CheckRun","name":"Mutation","status":"COMPLETED","conclusion":"FAILURE"}]'
pend='[{"__typename":"CheckRun","name":"Tests","status":"IN_PROGRESS","conclusion":""}]'
pr() { # state mergeable mergeStateStatus rollup [draft]
  printf '{"number":12,"state":"%s","isDraft":%s,"headRefOid":"abcdef1234567890","baseRefName":"next","mergeable":"%s","mergeStateStatus":"%s","statusCheckRollup":%s}' \
    "$1" "${5:-false}" "$2" "$3" "$4" > "$D/pr.json"
}
transcript() { # assistant text; preceded by a human turn and followed by nothing
  python3 - "$D/t.jsonl" "$1" <<'PY'
import json,sys
p,text=sys.argv[1],sys.argv[2]
rows=[{"type":"user","message":{"role":"user","content":"status?"}},
      {"type":"assistant","message":{"role":"assistant","content":[{"type":"tool_use","id":"x","name":"Bash","input":{}}]}},
      {"type":"user","message":{"role":"user","content":[{"type":"tool_result","tool_use_id":"x","content":"..."}]}},
      {"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":text}]}}]
open(p,"w").write("\n".join(json.dumps(r) for r in rows)+"\n")
PY
}
run() { # [ENV=val ...]; uses $D/t.jsonl; OUT=stdout
  OUT=$( export HOME="$D" PATH="$D/bin:$PATH" FAKE_PR_JSON="$D/pr.json" FAKE_REPO=owner/repo; unset PR_CLAIM_VERIFIER PR_CLAIM_VERIFIER_REPO
         for kv in "$@"; do export "$kv"; done
         printf '{"session_id":"s1","transcript_path":"%s","cwd":"%s"}' "$D/t.jsonl" "$D" | node "$HOOK" )
  rm -f "$D/.claude/state/pr-claim-verifier/s1.json"
}
blocks() { printf '%s' "$OUT" | grep -q '"decision":"block"'; }

pr OPEN MERGEABLE CLEAN "$red"; transcript "PR #12 is CI green and ready to merge."
run; blocks && printf '%s' "$OUT" | grep -q 'Mutation' && pass "green claim vs failing check blocks, names the check" || fail "red" "$OUT"

pr OPEN MERGEABLE CLEAN "$green"; run; [ -z "$OUT" ] && pass "true claim passes silently" || fail "true claim" "$OUT"

pr OPEN MERGEABLE CLEAN "$pend"; transcript "Checks passed on #12."; run
blocks && printf '%s' "$OUT" | grep -q 'still running' && pass "pending checks contradict a pass claim" || fail "pending" "$OUT"

pr OPEN MERGEABLE CLEAN "[]"; transcript "CI green on #12."; run
blocks && printf '%s' "$OUT" | grep -q 'no checks have run' && pass "no checks run contradicts a green claim" || fail "no checks" "$OUT"

pr OPEN CONFLICTING DIRTY "$green"; transcript "No merge conflicts on PR 12."; run
blocks && printf '%s' "$OUT" | grep -q 'conflicts with next' && pass "no-conflict claim vs CONFLICTING blocks" || fail "conflict" "$OUT"

pr OPEN MERGEABLE BEHIND "$green"; transcript "#12 is up to date with next."; run
blocks && pass "up-to-date claim vs BEHIND blocks" || fail "behind" "$OUT"

pr OPEN MERGEABLE CLEAN "$green" true; transcript "PR #12 is ready to merge."; run
blocks && printf '%s' "$OUT" | grep -q 'draft' && pass "ready claim on a draft blocks" || fail "draft" "$OUT"

pr OPEN MERGEABLE CLEAN "$red"; transcript "CI is not green on #12; Mutation is failing."; run
[ -z "$OUT" ] && pass "negated claim is not a claim" || fail "negation" "$OUT"
transcript "PR #12 is not ready to merge yet."; run
[ -z "$OUT" ] && pass "negated ready claim is not a claim" || fail "negation ready" "$OUT"

transcript "Merged the docs change; nothing else to report."; run
[ -z "$OUT" ] && pass "no PR reference, no check" || fail "no ref" "$OUT"

pr OPEN MERGEABLE CLEAN "$red"; transcript "Reviewed #12 again.
All green, ready to merge."; run
blocks && pass "single PR in reply binds claims on other lines" || fail "binding" "$OUT"

pr MERGED MERGEABLE CLEAN "$red"; transcript "PR #12 was CI green and merged."; run
[ -z "$OUT" ] && pass "merged PR: history is not checked" || fail "merged" "$OUT"

pr OPEN MERGEABLE CLEAN "$red"; transcript "PR #12 is CI green."; run FAKE_GH_FAIL=1
[ -z "$OUT" ] && pass "gh failure fails open" || fail "gh fail" "$OUT"
run PR_CLAIM_VERIFIER=0; [ -z "$OUT" ] && pass "PR_CLAIM_VERIFIER=0 disables" || fail "disable" "$OUT"

transcript "See https://github.com/open-gsd/gsd-core/pull/12 — CI green."; run
blocks && printf '%s' "$OUT" | grep -q 'open-gsd/gsd-core#12' && pass "repo taken from PR URL" || fail "url repo" "$OUT"

# streak: blocks twice in a row, then lets the stop through
transcript "PR #12 is CI green."
S=$( export HOME="$D" PATH="$D/bin:$PATH" FAKE_PR_JSON="$D/pr.json"
     for i in 1 2 3; do printf '{"session_id":"s2","transcript_path":"%s","cwd":"%s"}' "$D/t.jsonl" "$D" | node "$HOOK" | grep -c '"decision":"block"'; done | tr '\n' ' ')
[ "$S" = "1 1 0 " ] && pass "blocks at most twice in a row" || fail "streak" "$S"

echo "---- $((N-F))/$N passed"; [ "$F" -eq 0 ]
