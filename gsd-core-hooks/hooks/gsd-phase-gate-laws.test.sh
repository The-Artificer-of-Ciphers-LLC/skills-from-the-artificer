#!/usr/bin/env bash
# Behavioral suite for the Artificer-laws honesty check in gsd-phase-gate.cjs (bug gate).
#   bash gsd-core-hooks/hooks/gsd-phase-gate-laws.test.sh
set -uo pipefail
cd "$(dirname "$0")" || exit 1
HOOK=$PWD/gsd-phase-gate.cjs
D=$(mktemp -d); trap 'rm -rf "$D"' EXIT
R=$D/repo; mkdir -p "$R/src"
git -C "$R" init -q -b main
git -C "$R" -c user.name=t -c user.email=t@t commit -q --allow-empty -m init
git -C "$R" checkout -q -b fix/1-x
BUG=$R/.gsd/bug/fix-1-x; mkdir -p "$BUG"; echo '{}' > "$BUG/00-run.json"
N=0; F=0
pass() { N=$((N+1)); echo "PASS  $1"; }
fail() { N=$((N+1)); F=$((F+1)); echo "FAIL  $1 -> $2"; }

diag() { # laws-section-body ("" => omit section)
  { printf '## Root cause\nx\n\n'
    [ -n "$1" ] && printf '## Laws that apply\n%s\n' "$1"
    printf '\n## Not-the-bug\ny\n'; } > "$BUG/10-diagnosis.md"
}
tx_with() { printf '%s\n' '{"message":{"content":[{"type":"tool_use","name":"Skill","input":{"skill":"skills-from-the-artificer","args":"a"}}]}}' > "$D/t.jsonl"; }
tx_without() { printf '%s\n' '{"message":{"content":[{"type":"tool_use","name":"Skill","input":{"skill":"postels-law"}}]}}' > "$D/t.jsonl"; }
run() { # file_path transcript_path|-
  local tp=""; [ "$2" != "-" ] && tp=$2
  OUT=$(python3 -c 'import json,sys;d={"tool_name":"Edit","tool_input":{"file_path":sys.argv[1]},"cwd":sys.argv[2]}
if sys.argv[3]: d["transcript_path"]=sys.argv[3]
print(json.dumps(d))' "$1" "$R" "$tp" | node "$HOOK")
}
denied() { printf '%s' "$OUT" | grep -q '"permissionDecision":"deny"'; }

GOOD='Subject: x
- **hyrums-law** — fired: changes exit code of foo. Action: keep old code.
Considered and cleared: postels-law (no parsing)'

diag "$GOOD"; tx_with; run "$R/src/a.ts" "$D/t.jsonl"
[ -z "$OUT" ] && pass "honest block + real Skill call: allowed" || fail "honest" "$OUT"

diag '- **Law of the Smallest Sufficient Change** — the defect is in data.'; tx_with; run "$R/src/a.ts" "$D/t.jsonl"
denied && printf '%s' "$OUT" | grep -q 'names no law' && pass "coined law: denied" || fail "coined" "$OUT"

diag ""; tx_with; run "$R/src/a.ts" "$D/t.jsonl"
denied && printf '%s' "$OUT" | grep -q 'missing or empty' && pass "no Laws section: denied" || fail "nosection" "$OUT"

diag 'None fire — pure data fix, no boundary touched.'; tx_with; run "$R/src/a.ts" "$D/t.jsonl"
[ -z "$OUT" ] && pass "'None fire' block: allowed" || fail "nonefire" "$OUT"

diag "$GOOD"; tx_without; run "$R/src/a.ts" "$D/t.jsonl"
denied && printf '%s' "$OUT" | grep -q 'no `Skill` call' && pass "section present but dispatcher never called: denied" || fail "nocall" "$OUT"

diag "$GOOD"; run "$R/src/a.ts" "$D/does-not-exist.jsonl"
[ -z "$OUT" ] && pass "unreadable transcript: only the transcript arm is skipped" || fail "unreadable" "$OUT"

diag "$GOOD"; run "$R/src/a.ts" -
[ -z "$OUT" ] && pass "no transcript_path in payload: content check only, allowed" || fail "notp" "$OUT"

diag "$GOOD
- **murphys-law** — coined."; tx_with; run "$R/src/a.ts" "$D/t.jsonl"
denied && printf '%s' "$OUT" | grep -q 'murphys-law' && pass "valid law + foreign *-law name: denied" || fail "foreign" "$OUT"

diag '- **Law of X** — nope.'; tx_without; run "$R/README.md" "$D/t.jsonl"
[ -z "$OUT" ] && pass "non-src edit is never gated by the laws check" || fail "nonsrc" "$OUT"

diag '- **Law of X** — nope.'; tx_without; run "$BUG/10-diagnosis.md" "$D/t.jsonl"
[ -z "$OUT" ] && pass "writing the diagnosis itself is never blocked" || fail "selfwrite" "$OUT"

echo "$N checks, $F failed"; [ "$F" -eq 0 ]
