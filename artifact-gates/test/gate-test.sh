#!/usr/bin/env bash
#
# Behavioral test for hooks/artifact-gate.cjs.
#
# Drives the REAL hook with REAL stdin payloads against a throwaway git repo,
# using contracts/full-example.json as the contract. A hook always exits 0 —
# allow vs deny is stdout — so that is what these assert.
#
#   bash test/gate-test.sh [path/to/artifact-gate.cjs] [path/to/contract.json]
#
set -u

HERE="$(cd "$(dirname "$0")" && pwd)"
HOOK="${1:-$HERE/../hooks/artifact-gate.cjs}"
CONTRACT="${2:-$HERE/../contracts/full-example.json}"

[ -f "$HOOK" ] || { echo "no hook at $HOOK"; exit 1; }
[ -f "$CONTRACT" ] || { echo "no contract at $CONTRACT"; exit 1; }

R="$(mktemp -d)/repo"
mkdir -p "$R" && cd "$R" || exit 1
git init -q -b fix/123-thing . 2>/dev/null || { git init -q .; git checkout -q -b fix/123-thing; }
git config user.email t@t.t; git config user.name t
# An unborn branch makes `rev-parse --abbrev-ref HEAD` fail, which correctly fails
# the hook OPEN — and would silently turn every branch-scoped assertion below into
# a false pass. A commit is a precondition of testing at all.
git commit -q --allow-empty -m init
git rev-parse --abbrev-ref HEAD | grep -qx 'fix/123-thing' \
  || { echo "SETUP FAIL: branch is $(git rev-parse --abbrev-ref HEAD)"; exit 1; }
mkdir -p src tests

PASS=0; FAIL=0

# run <name> <allow|deny> <json-payload>
run() {
  local name="$1" expect="$2" payload="$3" out got
  out="$(printf '%s' "$payload" | node "$HOOK" 2>&1)"
  got="allow"; case "$out" in *'"deny"'*) got="deny";; esac
  if [ "$got" = "$expect" ]; then
    PASS=$((PASS+1)); printf '  ok   %-56s %s\n' "$name" "$got"
  else
    FAIL=$((FAIL+1)); printf '  FAIL %-56s want=%s got=%s\n' "$name" "$expect" "$got"
    printf '       %s\n' "$(printf '%s' "$out" | head -c 300)"
  fi
}

edit()  { printf '{"tool_name":"Write","cwd":"%s","tool_input":{"file_path":"%s/%s"}}' "$R" "$R" "$1"; }
bash_() { printf '{"tool_name":"Bash","cwd":"%s","tool_input":{"command":"%s"}}' "$R" "$1"; }

echo "== no contract: the gate is not adopted here =="
run "no config, src edit"              allow "$(edit src/a.ts)"
run "no config, gh pr merge --admin"   allow "$(bash_ 'gh pr merge 5 --admin')"

cp "$CONTRACT" "$R/.artifact-gate.json"

echo "== contract present, nothing armed =="
run "unarmed src edit"                 allow "$(edit src/a.ts)"
run "unarmed git push"                 allow "$(bash_ 'git push origin HEAD')"
run "unarmed gh pr merge --admin"      allow "$(bash_ 'gh pr merge 5 --admin')"
run "unarmed gh issue close"           allow "$(bash_ 'gh issue close 9 --reason \"not planned\"')"

echo "== malformed contract fails LOUD, not open =="
echo 'not json at all' > "$R/.artifact-gate.json"
run "malformed config, src edit"       deny  "$(edit src/a.ts)"
run "malformed config, bash"           deny  "$(bash_ 'git push')"
run "malformed config, fix the config" allow "$(edit .artifact-gate.json)"
cp "$CONTRACT" "$R/.artifact-gate.json"

echo "== bugfix family: arm it =="
mkdir -p .gsd/bug/fix-123-thing
echo '{"issue":123,"branch":"fix/123-thing"}' > .gsd/bug/fix-123-thing/00-run.json
run "armed, src edit, no diagnosis"    deny  "$(edit src/a.ts)"
# $R is the mktemp path (/var/... on macOS) while git reports /private/var/... —
# so the line above IS the symlink case. Pin both ends so a future refactor that
# reintroduces a prefix comparison fails here instead of silently failing open.
PHYS="$(cd "$R" && pwd -P)"
run "src edit via physical path"       deny \
  "$(printf '{"tool_name":"Write","cwd":"%s","tool_input":{"file_path":"%s/src/a.ts"}}' "$R" "$PHYS")"
run "nested NEW src dir"               deny \
  "$(printf '{"tool_name":"Write","cwd":"%s","tool_input":{"file_path":"%s/src/deep/new/x.ts"}}' "$R" "$R")"
run "edit OUTSIDE the repo"            allow \
  "$(printf '{"tool_name":"Write","cwd":"%s","tool_input":{"file_path":"/etc/hosts"}}' "$R")"
run "sibling dir named srcx"           allow "$(edit srcx/a.ts)"
run "artifact dir is exempt"           allow "$(edit .gsd/bug/fix-123-thing/10-diagnosis.md)"
run ".claude is exempt"                allow "$(edit .claude/hooks/x.cjs)"
run "docs edit unaffected"             allow "$(edit docs/x.md)"
echo x > .gsd/bug/fix-123-thing/10-diagnosis.md
run "diagnosis present, src edit"      allow "$(edit src/a.ts)"
run "tests edit, no matrix"            deny  "$(edit tests/a.test.cjs)"
run "test/ singular also gated"        deny  "$(edit test/a.test.cjs)"
echo x > .gsd/bug/fix-123-thing/50-test-matrix.md
run "matrix present, tests edit"       allow "$(edit tests/a.test.cjs)"
run "push, no review"                  deny  "$(bash_ 'git push -u origin HEAD')"
echo '{}' > .gsd/bug/fix-123-thing/60-review.json
run "review present, push"             allow "$(bash_ 'git push -u origin HEAD')"

echo "== bugfix family: merge authority (contents-checked) =="
S=.gsd/bug/fix-123-thing/80-ship.json
run "merge, no ship record"            deny  "$(bash_ 'gh pr merge 42 --squash')"
echo 'not json' > $S
run "merge, malformed ship record"     deny  "$(bash_ 'gh pr merge 42 --squash')"
GREEN='{"pr":42,"checks":{"green":true,"failing":[]},"mergeable":"MERGEABLE","merge":{"admin":false,"admin_reason":null}}'
printf '%s' "$GREEN" > $S
run "merge, green, no --admin"         allow "$(bash_ 'gh pr merge 42 --squash')"
run "merge --admin, admin_reason null" deny  "$(bash_ 'gh pr merge 42 --squash --admin')"
ADM='{"pr":42,"checks":{"green":true,"failing":[]},"mergeable":"MERGEABLE","merge":{"admin":true,"admin_reason":"missing-secondary-reviewer"}}'
printf '%s' "$ADM" > $S
run "merge --admin, reviewer reason"   allow "$(bash_ 'gh pr merge 42 --squash --admin')"
BAD='{"pr":42,"checks":{"green":true,"failing":[]},"mergeable":"MERGEABLE","merge":{"admin":true,"admin_reason":"ci-is-flaky"}}'
printf '%s' "$BAD" > $S
run "merge --admin, invented reason"   deny  "$(bash_ 'gh pr merge 42 --squash --admin')"
MISMATCH='{"pr":42,"checks":{"green":true,"failing":[]},"mergeable":"MERGEABLE","merge":{"admin":false,"admin_reason":"missing-secondary-reviewer"}}'
printf '%s' "$MISMATCH" > $S
run "merge --admin, record says false" deny  "$(bash_ 'gh pr merge 42 --squash --admin')"
RED='{"pr":42,"checks":{"green":false,"failing":["ubuntu-24"]},"mergeable":"MERGEABLE","merge":{"admin":true,"admin_reason":"missing-secondary-reviewer"}}'
printf '%s' "$RED" > $S
run "RED ci + --admin (MUST deny)"     deny  "$(bash_ 'gh pr merge 42 --squash --admin')"
run "RED ci, plain merge"              deny  "$(bash_ 'gh pr merge 42 --squash')"
CONTRA='{"pr":42,"checks":{"green":true,"failing":["lint"]},"mergeable":"MERGEABLE","merge":{"admin":false}}'
printf '%s' "$CONTRA" > $S
run "green:true but failing non-empty" deny  "$(bash_ 'gh pr merge 42 --squash')"
CFL='{"pr":42,"checks":{"green":true,"failing":[]},"mergeable":"CONFLICTING","merge":{"admin":true,"admin_reason":"missing-secondary-reviewer"}}'
printf '%s' "$CFL" > $S
run "CONFLICTING + --admin (MUST deny)" deny "$(bash_ 'gh pr merge 42 --squash --admin')"
printf '%s' "$ADM" > $S

echo "== bugfix family: queue advance =="
run "checkout -b, no queue"            deny  "$(bash_ 'git checkout -b fix/124-next origin/next')"
echo '{"issues":[{"issue":123,"state":"in_progress"}]}' > .gsd/bug/queue.json
run "checkout -b, non-terminal state"  deny  "$(bash_ 'git checkout -b fix/124-next origin/next')"
echo '{"issues":[{"issue":999,"state":"merged"}]}' > .gsd/bug/queue.json
run "checkout -b, wrong issue logged"  deny  "$(bash_ 'git checkout -b fix/124-next origin/next')"
echo '{"issues":[{"issue":123,"state":"parked","reason":"conflict"}]}' > .gsd/bug/queue.json
run "checkout -b, parked with reason"  allow "$(bash_ 'git checkout -b fix/124-next origin/next')"
run "plain checkout (not -b)"          allow "$(bash_ 'git checkout next')"

echo "== triage family: outward writes =="
rm -rf .gsd/bug
mkdir -p .gsd/triage
echo '{"run":"r1"}' > .gsd/triage/00-run.json
run "armed, comment, no worklist"      deny  "$(bash_ 'gh issue comment 77 --body-file /tmp/b.md')"
run "armed, unrelated bash"            allow "$(bash_ 'ls -la')"
run "armed, src edit (no such gate)"   allow "$(edit src/a.ts)"
echo x > .gsd/triage/10-worklist.md
run "worklist present, plain comment"  allow "$(bash_ 'gh issue comment 77 --body-file /tmp/b.md')"
run "confirmed-bug, no diagnosis"      deny  "$(bash_ 'gh issue edit 77 --add-label confirmed-bug --remove-label needs-triage')"
mkdir -p .gsd/triage/20-diagnosis && echo x > .gsd/triage/20-diagnosis/77.md
run "confirmed-bug, diagnosis present" allow "$(bash_ 'gh issue edit 77 --add-label confirmed-bug --remove-label needs-triage')"
run "confirmed-bug on a DIFFERENT issue" deny "$(bash_ 'gh issue edit 88 --add-label confirmed-bug')"
run "confirmed-bug via gh api"         deny  "$(bash_ 'gh api -X POST repos/o/r/issues/88/labels -f labels[]=confirmed-bug')"
run "needs-reproduction label (no diag)" allow "$(bash_ 'gh issue edit 88 --add-label needs-reproduction')"
run "close diagnosed issue"            allow "$(bash_ 'gh issue close 77 --reason \"not planned\"')"
run "close undiagnosed, no decisions"  deny  "$(bash_ 'gh issue close 88 --reason \"not planned\"')"
echo '{"decisions":[]}' > .gsd/triage/30-decisions.json
run "close undiagnosed, decisions kept" allow "$(bash_ 'gh issue close 88 --reason \"not planned\"')"
run "gh pr create, no oos queue"       deny  "$(bash_ 'gh pr create --title x --body-file /tmp/b')"
echo '{"entries":[]}' > .gsd/triage/40-oos-queue.json
run "gh pr create, empty queue is OK"  allow "$(bash_ 'gh pr create --title x --body-file /tmp/b')"

echo "== triage family: the disarm =="
rm -f .gsd/triage/10-worklist.md .gsd/triage/40-oos-queue.json
run "still armed without worklist"     deny  "$(bash_ 'gh issue comment 77 --body x')"
echo x > .gsd/triage/90-summary.md
run "summary disarms issue writes"     allow "$(bash_ 'gh issue comment 77 --body x')"
run "summary disarms pr create"        allow "$(bash_ 'gh pr create --title x')"

echo "== human escape =="
rm -f .gsd/triage/90-summary.md
run "override prefix on command"       allow "$(bash_ 'ARTIFACT_GATE_OVERRIDE=1 gh issue comment 77 --body x')"
[ -f "$R/.artifact-gate-override.log" ] \
  && { PASS=$((PASS+1)); printf '  ok   %-56s %s\n' "override is logged" "logged"; } \
  || { FAIL=$((FAIL+1)); printf '  FAIL %-56s no log written\n' "override is logged"; }

echo
echo "PASS=$PASS FAIL=$FAIL"
[ "$FAIL" -eq 0 ]
