#!/usr/bin/env bash
# Behavioral regression suite for measure-dont-infer-guard.cjs.
# Run after ANY edit to the guard:
#   bash ~/.claude/hooks/measure-dont-infer-guard.test.sh
set -uo pipefail
cd "$(dirname "$0")" || exit 1

GUARD=./measure-dont-infer-guard.cjs
STATE_FILE="$HOME/.claude/state/gsd-measure-guard-denials.jsonl"

N=0
F=0

pass() { N=$((N+1)); echo "PASS  $1"; }
fail() { N=$((N+1)); F=$((F+1)); echo "FAIL  $1 -> $2"; }

# mkpayload <tool_name> <command> -> JSON on stdout (Node-built, no manual escaping)
mkpayload() {
  node -e '
    const [toolName, command] = process.argv.slice(1);
    const payload = { tool_name: toolName };
    if (command !== undefined) payload.tool_input = { command };
    process.stdout.write(JSON.stringify(payload));
  ' "$1" "${2-}"
}

clear_denials() {
  rm -f "$STATE_FILE" 2>/dev/null || true
}

# run <raw-json-payload>
# Populates OUT (stderr text) and RC (exit code). Clears the persisted
# denial-log before every call so independent cases never contaminate each
# other via the repeat-denial detector's 15-minute window.
run() {
  local payload="$1"
  clear_denials
  OUT=$(printf '%s' "$payload" | node "$GUARD" 2>&1 >/dev/null)
  RC=$?
}

# run_no_clear <raw-json-payload>
# Same as run(), but preserves the denial-log written by a prior call —
# used ONLY to exercise the repeat-denial detector across a seed command and
# a follow-up command in the same test case.
run_no_clear() {
  local payload="$1"
  OUT=$(printf '%s' "$payload" | node "$GUARD" 2>&1 >/dev/null)
  RC=$?
}

assert_contains() {
  local name="$1" needle="$2"
  case "$OUT" in
    *"$needle"*) pass "$name" ;;
    *) fail "$name" "stderr did not contain [$needle]; stderr=[$OUT]" ;;
  esac
}

assert_rc() {
  local name="$1" expected="$2"
  if [ "$RC" = "$expected" ]; then
    pass "$name"
  else
    fail "$name" "rc=$RC (expected $expected) stderr=[$OUT]"
  fi
}

deny_case() {
  local name="$1" cmd="$2"
  run "$(mkpayload Bash "$cmd")"
  assert_rc "DENY: $name" 2
}

allow_case() {
  local name="$1" cmd="$2"
  run "$(mkpayload Bash "$cmd")"
  assert_rc "ALLOW: $name" 0
}

echo "=== MUST-DENY: counts + code-construct pattern + source target ==="

deny_case "escaped-dot pattern, -c, src/ dir (worked example)" \
  "grep -c 'process\.exit' src/"

deny_case "bundled -rc, camelCase pattern, src/ dir" \
  'grep -rc "processExit" src/'

deny_case "parens pattern, piped into wc -l, src/ dir" \
  'grep -rn "processExit()" src/ | wc -l'

deny_case "rg --count, 'class ' token pattern, src/ dir" \
  'rg -c "class Foo" src/'

deny_case "--count long flag, require( pattern, .js target" \
  'grep --count "require(" lib/utils.js'

deny_case "multi-stage pipe (sort | uniq | wc -l), camelCase, scripts/ dir" \
  'grep -rn "processExit" scripts/ | sort | uniq | wc -l'

deny_case "bundled -rhc, camelCase pattern, src/ dir" \
  'grep -rhc "processExit" src/'

deny_case "count flag AND piped wc -l both present, still denies" \
  'grep -c "processExit" src/ | wc -l'

deny_case "grep-count buried after && in a compound command" \
  'echo hi && grep -c "processExit" src/'

deny_case "sort | uniq -c after grep (the live bug)" \
  'grep -rhoE "process\.exit\(\s*-?[0-9]+\s*\)" src bin scripts hooks | sort | uniq -c'

deny_case "uniq -c directly, no intervening sort" \
  'grep -rho "process\.exit(" hooks/ | uniq -c'

deny_case "sort -u | uniq -c, flags on sort" \
  'grep -rhoE "require\(" scripts/ | sort -u | uniq -c'

deny_case "awk END NR accumulator" \
  "grep -rn \"process\.exit\" src/ | awk 'END{print NR}'"

deny_case "wc -w word count" \
  'grep -rn "processExit" src/ | wc -w'

echo "=== MUST-ALLOW: regression cases from the brief ==="

allow_case "find | wc -l, no grep at all" \
  "find . -name '*.md' | wc -l"

allow_case "ls | wc -l, no grep at all" \
  "ls src/ | wc -l"

allow_case "grep -c with plain-text pattern (no code signature)" \
  'grep -c "TODO" src/'

allow_case "grep -c markdown target, no code signature" \
  'grep -c "^## " docs/guide.md'

allow_case "grep -c config target (package.json)" \
  'grep -c "version" package.json'

allow_case "grep -rn listing (no count) even with code pattern" \
  'grep -rn "process\.exit" src/'

allow_case "grep -rn piped into head, not wc -l" \
  'grep -rn "process\.exit" src/ | head -20'

# 2026-09-09: the inline escape markers were DELETED because they were
# self-issuable — the constrained party wrote its own justification inside the
# command under judgement. These two cases now pin their ABSENCE. Restoring an
# inline escape must break the suite.
deny_case "REMOVED escape: '# text-count-ok:' no longer bypasses" \
  "grep -c 'process\.exit' src/  # text-count-ok: verifying known baseline"

deny_case "REMOVED escape: '# raw-lines-ok:' no longer bypasses" \
  "grep -c 'process\.exit' src/  # raw-lines-ok: need the actual lines"

echo "=== ALLOW: additional false-positive guards ==="

allow_case "capital -C is context, not count (lowercase-only rule)" \
  'grep -C 3 "processExit" src/'

allow_case "count flag but no target looks like source" \
  'grep -c "processExit" README.md'

allow_case "code-construct pattern but no count/wc-l (listing only)" \
  'grep -rn "require(" src/'

allow_case "sort | uniq -c with no grep in the pipeline at all" \
  'sort file.txt | uniq -c'

allow_case "grep -c with plain pattern piped into sort | uniq -c" \
  'grep -c "TODO" src/ | sort | uniq -c'

allow_case "grep on a log with plain pattern, non-source target, piped into sort | uniq -c" \
  'cat access.log | grep " 500 " | sort | uniq -c'

allow_case "awk without END/NR is a projection, not a count" \
  'grep -rn "process\.exit" src/ | awk '"'"'{print $1}'"'"''

echo "=== MUST-DENY: the four known leaks ==="

deny_case "sed -n line-count leak (grep piped into sed instead of wc -l)" \
  'grep -rn "processExit" src/ | sed -n "$="'

deny_case "nl piped into tail -1 line-count leak" \
  'grep -rn "processExit()" src/ | nl | tail -1'

deny_case "rg --stats summary-count leak" \
  'rg --stats "processExit" src/'

deny_case "grep -c inside \$(...) substitution, shell-variable target (for-loop accumulator leak)" \
  'for f in $(find src -name "*.ts"); do c=$(grep -c "processExit" "$f"); total=$((total+c)); done'

echo "=== Change 1: anti-circumvention block on every deny message ==="

run "$(mkpayload Bash 'grep -c "processExit" src/')"
assert_rc "DENY: baseline for anti-circumvention check" 2
assert_contains "anti-circumvention block present in standard deny" \
  "DO NOT REPHRASE THIS COMMAND TO GET PAST THIS GUARD."

echo "=== Change 2: denial persistence ==="

clear_denials
run "$(mkpayload Bash 'grep -c "processExit" src/')"
assert_rc "DENY: baseline for persistence check" 2
if [ -s "$STATE_FILE" ] && grep -q '"fingerprint"' "$STATE_FILE" 2>/dev/null; then
  pass "denial persisted as a JSON line with a fingerprint"
else
  fail "denial persisted as a JSON line with a fingerprint" "STATE_FILE missing or empty"
fi

echo "=== MUST-DENY: repeat-denial detector ==="

clear_denials
run "$(mkpayload Bash 'grep -rc "process\.exit" src/')"
assert_rc "seed denial for reworded-mechanism repeat test" 2
run_no_clear "$(mkpayload Bash 'grep -rn "process\.exit(" src/ | nl | tail -1')"
assert_rc "DENY: repeat via reworded counting mechanism (nl|tail leak)" 2
assert_contains "repeat message present for reworded mechanism" \
  "REPEAT OF A DENIED QUESTION"

clear_denials
run "$(mkpayload Bash 'grep -rc "process\.exit" src/')"
assert_rc "seed denial for plain-listing repeat test" 2
run_no_clear "$(mkpayload Bash 'grep -rn "process\.exit" src/')"
assert_rc "DENY: plain listing repeats a denied (pattern,target)" 2
assert_contains "repeat message present for plain listing" \
  "REPEAT OF A DENIED QUESTION"

echo "=== MUST-ALLOW: repeat-detector escapes and independence ==="

clear_denials
run "$(mkpayload Bash 'grep -rc "process\.exit" src/')"
assert_rc "seed denial for raw-lines-ok escape test" 2
run_no_clear "$(mkpayload Bash 'grep -rn "process\.exit" src/  # raw-lines-ok: need literal call sites for manual triage')"
assert_rc "ALLOW: raw-lines-ok escape bypasses repeat detector" 0

clear_denials
run "$(mkpayload Bash 'grep -rc "process\.exit" src/')"
assert_rc "seed denial for different-pattern independence test" 2
run_no_clear "$(mkpayload Bash 'grep -rn "TODO" src/')"
assert_rc "ALLOW: different pattern, same target, after a denial" 0

clear_denials
run "$(mkpayload Bash 'grep -rc "process\.exit" src/')"
assert_rc "seed denial for different-target independence test" 2
run_no_clear "$(mkpayload Bash 'grep -n "process\.exit" docs/guide.md')"
assert_rc "ALLOW: same pattern, different target root, after a denial" 0

echo "=== MUST-DENY: grep invocation buried in a compound command (not the first word) ==="

deny_case "count buried in a for-loop arithmetic accumulator, nested \$((...\$(...)...))" \
  'n=0; for f in src/*.cts; do n=$((n+$(grep -c "process\.exit" $f))); done; echo $n'

clear_denials
run "$(mkpayload Bash 'grep -rc "process\.exit" src/')"
assert_rc "seed denial for buried-loop repeat test" 2
run_no_clear "$(mkpayload Bash 'n=0; for f in src/*.cts; do n=$((n+$(grep -c "process\.exit" $f))); done; echo $n')"
assert_rc "DENY: buried for-loop count repeats a denied (pattern,target) via resolved loop-var glob" 2
assert_contains "repeat message present for buried for-loop count" \
  "REPEAT OF A DENIED QUESTION"

clear_denials
run "$(mkpayload Bash 'grep -qc "process\.exit" src/io.cts')"
assert_rc "seed denial for if-condition repeat test" 2
run_no_clear "$(mkpayload Bash 'if grep -qc "process\.exit" src/io.cts; then echo hi; fi')"
assert_rc "DENY: grep buried in an if-condition repeats a denied (pattern,target)" 2
assert_contains "repeat message present for if-condition grep" \
  "REPEAT OF A DENIED QUESTION"

deny_case "count flag inside a \$(...) substitution assigned to a variable, code pattern, .cjs target" \
  'x=$(grep -c "require(" scripts/foo.cjs); echo $x'

echo "=== MUST-ALLOW: buried-grep detection must not overreach ==="

allow_case "for-loop accumulator over a non-source glob with a non-code pattern" \
  'n=0; for f in docs/*.md; do n=$((n+$(grep -c "^## " $f))); done; echo $n'

# A `grep -c ... src/` mention inside a quoted string being echoed is not an
# invocation. Distinguishing "quoted mention" from "executed invocation" is
# reliable here (quote-tracking), so this allows rather than failing closed.
allow_case "grep mention inside a quoted echo string, not executed" \
  'echo "grep -c foo src/"'

echo "=== Non-Bash tool_name, malformed/empty/missing input ==="

run "$(mkpayload Read '')"
assert_rc "non-Bash tool_name -> allow" 0

run '{"tool_name":"Bash"}'
assert_rc "Bash with no tool_input -> allow" 0

run '{"tool_name":"Bash","tool_input":{}}'
assert_rc "Bash with no command field -> allow" 0

run ''
assert_rc "empty stdin -> allow" 0

run '{not valid json'
assert_rc "malformed json -> allow" 0

run '   '
assert_rc "whitespace-only stdin -> allow" 0

echo
echo "measure-dont-infer-guard suite: $((N-F))/$N passed"
[ $F -eq 0 ] && exit 0 || exit 1
