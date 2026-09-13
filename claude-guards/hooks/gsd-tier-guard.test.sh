#!/usr/bin/env bash
# Behavioral regression suite for the tier-guard hook family:
#   gsd-session-model.cjs, gsd-tier-guard.cjs, gsd-agent-dispatch-guard.cjs,
#   gsd-subagent-output-cap.cjs
# Run after ANY edit to these hooks:
#   bash ~/.claude/hooks/gsd-tier-guard.test.sh
# HOME is isolated per invocation via mktemp -d and destroyed on exit via
# trap. This suite NEVER touches the real ~/.claude/state — every hook under
# test derives its state dir from os.homedir(), which honors $HOME.
set -uo pipefail
cd "$(dirname "$0")" || exit 1

SESSION_MODEL=./gsd-session-model.cjs
TIER_GUARD=./gsd-tier-guard.cjs
DISPATCH_GUARD=./gsd-agent-dispatch-guard.cjs
OUTPUT_CAP=./gsd-subagent-output-cap.cjs

D=$(mktemp -d); trap 'rm -rf "$D"' EXIT
STATE_DIR="$D/.claude/state/gsd-tier"

N=0
F=0

pass() { N=$((N+1)); echo "PASS  $1"; }
fail() { N=$((N+1)); F=$((F+1)); echo "FAIL  $1 -> $2"; }

# run <script> <payload-json> [ENVVAR=val ...]
# Populates globals OUT (stdout) and RC (exit code). Isolated HOME, and every
# env var any of these four hooks reads is force-unset first so nothing
# leaks in from the ambient shell (hermeticity), then re-set per case.
run() {
  local script="$1" payload="$2"; shift 2
  OUT=$(
    unset ANTHROPIC_MODEL GSD_TIER_GUARD GSD_TIER_GUARD_UNKNOWN \
      GSD_TIER_GUARD_MAX_LINES GSD_TIER_GUARD_MAX_CHARS GSD_TIER_GUARD_FREE_EDITS \
      GSD_DISPATCH_GUARD GSD_DISPATCH_INHERIT_TYPES GSD_DISPATCH_RETURN_LINES \
      GSD_OUTPUT_CAP GSD_OUTPUT_CAP_CHARS
    export HOME="$D"
    for kv in "$@"; do export "$kv"; done
    printf '%s' "$payload" | node "$script" 2>/dev/null
  )
  RC=$?
}

# check <name> <python-snippet-reading $OUT off stdin, raises on failure>
check() {
  local name="$1" py="$2" res
  if res=$(printf '%s' "$OUT" | python3 -c "$py" 2>&1); then
    pass "$name"
  else
    fail "$name" "$res"
  fi
}

assert_rc() {
  local name="$1" expected="$2"
  if [ "$RC" = "$expected" ]; then pass "$name"; else fail "$name" "rc=$RC (expected $expected)"; fi
}

EMPTY_CHECK='import sys; assert sys.stdin.read()==""'
DENY_CHECK='import json,sys
d=json.load(sys.stdin)
assert d["hookSpecificOutput"]["permissionDecision"]=="deny", d'
ALLOW_CHECK='import json,sys
d=json.load(sys.stdin)
assert d["hookSpecificOutput"]["permissionDecision"]=="allow", d'
BLOCK_CHECK='import json,sys
d=json.load(sys.stdin)
assert d["decision"]=="block", d'

mkstr() { python3 -c "print('x'*$1, end='')"; }

seed_tier() {
  local sid="$1" tier="$2"
  mkdir -p "$STATE_DIR"
  printf '{"sessionId":"%s","model":"x","tier":"%s","recordedAt":"2026-01-01T00:00:00.000Z"}' "$sid" "$tier" > "$STATE_DIR/$sid.json"
}

echo "=== gsd-session-model.cjs ==="

run "$SESSION_MODEL" '{"session_id":"sess-model-opus","model":"claude-opus-5"}'
assert_rc "session-model: opus string -> rc0" 0
TIER=$(python3 -c 'import json;print(json.load(open("'"$STATE_DIR"'/sess-model-opus.json"))["tier"])' 2>/dev/null)
[ "$TIER" = "opus" ] && pass "session-model: opus string -> tier opus" || fail "session-model: opus string -> tier opus" "got '$TIER'"

run "$SESSION_MODEL" '{"session_id":"sess-model-sonnet","model":{"id":"claude-sonnet-5"}}'
TIER=$(python3 -c 'import json;print(json.load(open("'"$STATE_DIR"'/sess-model-sonnet.json"))["tier"])' 2>/dev/null)
[ "$TIER" = "sonnet" ] && pass "session-model: nested model.id sonnet -> tier sonnet" || fail "session-model: nested model.id sonnet -> tier sonnet" "got '$TIER'"

run "$SESSION_MODEL" '{"session_id":"sess-model-unknown"}'
TIER=$(python3 -c 'import json;print(json.load(open("'"$STATE_DIR"'/sess-model-unknown.json"))["tier"])' 2>/dev/null)
[ "$TIER" = "unknown" ] && pass "session-model: no model, no env -> tier unknown" || fail "session-model: no model, no env -> tier unknown" "got '$TIER'"

BEFORE_COUNT=$(ls "$STATE_DIR" | wc -l | tr -d ' ')
run "$SESSION_MODEL" '{"model":"claude-opus-5"}'
AFTER_COUNT=$(ls "$STATE_DIR" | wc -l | tr -d ' ')
if [ "$RC" = "0" ] && [ "$BEFORE_COUNT" = "$AFTER_COUNT" ]; then
  pass "session-model: missing session_id -> writes nothing, rc0"
else
  fail "session-model: missing session_id -> writes nothing, rc0" "rc=$RC before=$BEFORE_COUNT after=$AFTER_COUNT"
fi

BEFORE_COUNT=$(ls "$STATE_DIR" | wc -l | tr -d ' ')
run "$SESSION_MODEL" '{"session_id":"bad/id","model":"claude-opus-5"}'
AFTER_COUNT=$(ls "$STATE_DIR" | wc -l | tr -d ' ')
if [ "$RC" = "0" ] && [ "$BEFORE_COUNT" = "$AFTER_COUNT" ] && [ ! -e "$STATE_DIR/bad" ]; then
  pass "session-model: invalid session_id -> writes nothing, rc0"
else
  fail "session-model: invalid session_id -> writes nothing, rc0" "rc=$RC before=$BEFORE_COUNT after=$AFTER_COUNT"
fi

echo "=== gsd-tier-guard.cjs ==="

seed_tier sess-tg-opus opus
PAYLOAD_DENY='{"session_id":"sess-tg-opus","tool_name":"Write","tool_input":{"file_path":"src/foo.ts","content":"whatever"}}'
run "$TIER_GUARD" "$PAYLOAD_DENY"
check "tier-guard: Write .ts, tier opus, no agent_id -> deny" "$DENY_CHECK"

run "$TIER_GUARD" '{"session_id":"sess-tg-opus","agent_id":"a1","tool_name":"Write","tool_input":{"file_path":"src/foo.ts","content":"whatever"}}'
check "tier-guard: same payload + agent_id -> empty stdout" "$EMPTY_CHECK"

run "$TIER_GUARD" '{"session_id":"sess-tg-opus","tool_name":"Write","tool_input":{"file_path":"src/foo.md","content":"whatever"}}'
check "tier-guard: Write .md -> empty stdout" "$EMPTY_CHECK"

run "$TIER_GUARD" '{"session_id":"sess-tg-opus","tool_name":"Write","tool_input":{"file_path":"src/foo.json","content":"whatever"}}'
check "tier-guard: Write .json -> empty stdout" "$EMPTY_CHECK"

run "$TIER_GUARD" '{"session_id":"sess-tg-opus","tool_name":"Write","tool_input":{"file_path":"docs/adr/foo.ts","content":"whatever"}}'
check "tier-guard: docs/ segment + .ts -> empty stdout" "$EMPTY_CHECK"

seed_tier sess-tg-sonnet sonnet
run "$TIER_GUARD" '{"session_id":"sess-tg-sonnet","tool_name":"Write","tool_input":{"file_path":"src/foo.ts","content":"whatever"}}'
check "tier-guard: tier sonnet, Write .ts -> empty stdout" "$EMPTY_CHECK"

run "$TIER_GUARD" "$PAYLOAD_DENY" "GSD_TIER_GUARD=off"
check "tier-guard: GSD_TIER_GUARD=off with deny payload -> empty stdout" "$EMPTY_CHECK"

# Boundary triplet — lines, with maxLines=3 / maxChars=240.
seed_tier sess-tg-lines opus
run "$TIER_GUARD" '{"session_id":"sess-tg-lines","tool_name":"Edit","tool_input":{"file_path":"src/foo.ts","old_string":"z","new_string":"a\nb"}}' \
  "GSD_TIER_GUARD_MAX_LINES=3" "GSD_TIER_GUARD_MAX_CHARS=240"
check "tier-guard: Edit new_string 2 lines -> sub-threshold (empty)" "$EMPTY_CHECK"

run "$TIER_GUARD" '{"session_id":"sess-tg-lines","tool_name":"Edit","tool_input":{"file_path":"src/foo.ts","old_string":"z","new_string":"a\nb\nc"}}' \
  "GSD_TIER_GUARD_MAX_LINES=3" "GSD_TIER_GUARD_MAX_CHARS=240"
check "tier-guard: Edit new_string exactly 3 lines -> sub-threshold (empty)" "$EMPTY_CHECK"

run "$TIER_GUARD" '{"session_id":"sess-tg-lines","tool_name":"Edit","tool_input":{"file_path":"src/foo.ts","old_string":"z","new_string":"a\nb\nc\nd"}}' \
  "GSD_TIER_GUARD_MAX_LINES=3" "GSD_TIER_GUARD_MAX_CHARS=240"
check "tier-guard: Edit new_string 4 lines -> deny" "$DENY_CHECK"

# Boundary triplet — chars, with maxLines=3 / maxChars=240, single-line strings.
seed_tier sess-tg-chars opus
S239=$(mkstr 239); S240=$(mkstr 240); S241=$(mkstr 241)
run "$TIER_GUARD" "{\"session_id\":\"sess-tg-chars\",\"tool_name\":\"Edit\",\"tool_input\":{\"file_path\":\"src/foo.ts\",\"old_string\":\"z\",\"new_string\":\"$S239\"}}" \
  "GSD_TIER_GUARD_MAX_LINES=3" "GSD_TIER_GUARD_MAX_CHARS=240"
check "tier-guard: Edit new_string 239 chars -> sub-threshold (empty)" "$EMPTY_CHECK"

run "$TIER_GUARD" "{\"session_id\":\"sess-tg-chars\",\"tool_name\":\"Edit\",\"tool_input\":{\"file_path\":\"src/foo.ts\",\"old_string\":\"z\",\"new_string\":\"$S240\"}}" \
  "GSD_TIER_GUARD_MAX_LINES=3" "GSD_TIER_GUARD_MAX_CHARS=240"
check "tier-guard: Edit new_string exactly 240 chars -> sub-threshold (empty)" "$EMPTY_CHECK"

run "$TIER_GUARD" "{\"session_id\":\"sess-tg-chars\",\"tool_name\":\"Edit\",\"tool_input\":{\"file_path\":\"src/foo.ts\",\"old_string\":\"z\",\"new_string\":\"$S241\"}}" \
  "GSD_TIER_GUARD_MAX_LINES=3" "GSD_TIER_GUARD_MAX_CHARS=240"
check "tier-guard: Edit new_string 241 chars -> deny" "$DENY_CHECK"

# Ratchet — GSD_TIER_GUARD_FREE_EDITS=2, three consecutive sub-threshold
# edits in the same session -> allow, allow, deny.
seed_tier sess-tg-ratchet opus
run "$TIER_GUARD" '{"session_id":"sess-tg-ratchet","tool_name":"Edit","tool_input":{"file_path":"src/foo.ts","old_string":"z","new_string":"x"}}' \
  "GSD_TIER_GUARD_FREE_EDITS=2"
check "tier-guard: ratchet edit 1/2 -> allow (empty)" "$EMPTY_CHECK"

run "$TIER_GUARD" '{"session_id":"sess-tg-ratchet","tool_name":"Edit","tool_input":{"file_path":"src/foo.ts","old_string":"z","new_string":"x"}}' \
  "GSD_TIER_GUARD_FREE_EDITS=2"
check "tier-guard: ratchet edit 2/2 -> allow (empty)" "$EMPTY_CHECK"

run "$TIER_GUARD" '{"session_id":"sess-tg-ratchet","tool_name":"Edit","tool_input":{"file_path":"src/foo.ts","old_string":"z","new_string":"x"}}' \
  "GSD_TIER_GUARD_FREE_EDITS=2"
check "tier-guard: ratchet edit 3 (budget exhausted) -> deny" "$DENY_CHECK"

echo "=== gsd-agent-dispatch-guard.cjs ==="

run "$DISPATCH_GUARD" '{"tool_name":"Agent","tool_input":{"subagent_type":"general-purpose","description":"do stuff","prompt":"do the thing"}}'
check "dispatch-guard: general-purpose, no model -> deny" "$DENY_CHECK"

run "$DISPATCH_GUARD" '{"tool_name":"Agent","tool_input":{"subagent_type":"general-purpose","model":"haiku","description":"do stuff","prompt":"do the thing"}}'
check "dispatch-guard: general-purpose + model haiku -> allow, updatedInput preserved+extended" '
import json,sys
d=json.load(sys.stdin)
ho=d["hookSpecificOutput"]
assert ho["permissionDecision"]=="allow", ho
ui=ho["updatedInput"]
assert ui["subagent_type"]=="general-purpose", ui
assert ui["model"]=="haiku", ui
assert ui["description"]=="do stuff", ui
assert len(ui["prompt"]) > len("do the thing"), ui["prompt"]
'

run "$DISPATCH_GUARD" '{"tool_name":"Agent","tool_input":{"subagent_type":"sonnet-coder","description":"code it","prompt":"fix the bug"}}'
check "dispatch-guard: sonnet-coder, no model -> allow with updatedInput" '
import json,sys
d=json.load(sys.stdin)
ho=d["hookSpecificOutput"]
assert ho["permissionDecision"]=="allow", ho
ui=ho["updatedInput"]
assert len(ui["prompt"]) > len("fix the bug"), ui["prompt"]
'

run "$DISPATCH_GUARD" '{"tool_name":"Agent","tool_input":{"subagent_type":"sonnet-coder","description":"code it","prompt":"fix the bug\n\n=== RETURN CONTRACT (injected) ===\nalready here"}}'
check "dispatch-guard: prompt already has sentinel -> empty stdout" "$EMPTY_CHECK"

run "$DISPATCH_GUARD" '{"tool_name":"Bash","tool_input":{"command":"ls"}}'
check "dispatch-guard: tool_name Bash -> empty stdout" "$EMPTY_CHECK"

echo "=== gsd-subagent-output-cap.cjs ==="

MSG20000=$(mkstr 20000)
run "$OUTPUT_CAP" "{\"agent_id\":\"agent-cap-block\",\"last_assistant_message\":\"$MSG20000\"}"
check "output-cap: 20000 chars -> block" "$BLOCK_CHECK"

run "$OUTPUT_CAP" "{\"agent_id\":\"agent-cap-block\",\"last_assistant_message\":\"$MSG20000\"}"
check "output-cap: identical rerun (same agent_id) -> empty (one-shot)" "$EMPTY_CHECK"

run "$OUTPUT_CAP" "{\"agent_id\":\"agent-cap-stop\",\"stop_hook_active\":true,\"last_assistant_message\":\"$MSG20000\"}"
check "output-cap: stop_hook_active true -> empty stdout" "$EMPTY_CHECK"

M99=$(mkstr 99); M100=$(mkstr 100); M101=$(mkstr 101)
run "$OUTPUT_CAP" "{\"agent_id\":\"agent-cap-99\",\"last_assistant_message\":\"$M99\"}" "GSD_OUTPUT_CAP_CHARS=100"
check "output-cap: 99 chars vs cap 100 -> empty" "$EMPTY_CHECK"

run "$OUTPUT_CAP" "{\"agent_id\":\"agent-cap-100\",\"last_assistant_message\":\"$M100\"}" "GSD_OUTPUT_CAP_CHARS=100"
check "output-cap: exactly 100 chars vs cap 100 -> empty" "$EMPTY_CHECK"

run "$OUTPUT_CAP" "{\"agent_id\":\"agent-cap-101\",\"last_assistant_message\":\"$M101\"}" "GSD_OUTPUT_CAP_CHARS=100"
check "output-cap: 101 chars vs cap 100 -> block" "$BLOCK_CHECK"

echo "=== all four hooks: empty / malformed stdin ==="

for script in "$SESSION_MODEL" "$TIER_GUARD" "$DISPATCH_GUARD" "$OUTPUT_CAP"; do
  name=$(basename "$script")

  run "$script" ""
  assert_rc "$name: empty stdin -> rc0" 0
  check "$name: empty stdin -> empty stdout" "$EMPTY_CHECK"

  run "$script" '{not valid json'
  assert_rc "$name: malformed json -> rc0" 0
  check "$name: malformed json -> empty stdout" "$EMPTY_CHECK"
done

echo
echo "gsd-tier-guard suite: $((N-F))/$N passed"
[ $F -eq 0 ] && exit 0 || exit 1
