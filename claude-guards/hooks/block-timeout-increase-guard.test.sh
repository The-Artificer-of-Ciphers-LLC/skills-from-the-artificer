#!/usr/bin/env bash
# Behavioral tests for the unshipped-product exemption in block-timeout-increase-guard.cjs.
#   bash claude-guards/hooks/block-timeout-increase-guard.test.sh
# HOME is isolated via mktemp -d so the real ~/.claude/timeout-guard-unshipped.txt is never read
# or written (the guard derives the list path from os.homedir(), which honors $HOME).
set -uo pipefail
cd "$(dirname "$0")" || exit 1
GUARD=./block-timeout-increase-guard.cjs

D=$(mktemp -d); trap 'rm -rf "$D"' EXIT
mkdir -p "$D/.claude"
LIST="$D/.claude/timeout-guard-unshipped.txt"

N=0; F=0
pass() { N=$((N+1)); echo "PASS  $1"; }
fail() { N=$((N+1)); F=$((F+1)); echo "FAIL  $1 -> $2"; }

# edit_payload <file_path>  : an Edit that raises a timeout-shaped value
edit_payload() {
  printf '{"tool_name":"Edit","tool_input":{"file_path":"%s","old_string":"const reqTimeout = 1000;","new_string":"const reqTimeout = 5000;"}}' "$1"
}
run() { printf '%s' "$1" | HOME="$D" node "$GUARD" 2>/dev/null; }
blocked() { run "$1" | grep -q '"decision":"block"'; }

expect_block() { if blocked "$2"; then pass "$1"; else fail "$1" "expected a block"; fi; }
expect_allow() { if blocked "$2"; then fail "$1" "unexpectedly blocked"; else pass "$1"; fi; }

printf '# comment line\n\n/Users/test/unshipped-app\n' >"$LIST"

expect_allow "path under a listed root is exempt"            "$(edit_payload /Users/test/unshipped-app/src/a.ts)"
expect_allow "a linked worktree under the root is exempt"    "$(edit_payload /Users/test/unshipped-app/.claude/worktrees/w/a.ts)"
expect_allow "the root itself is exempt"                     "$(edit_payload /Users/test/unshipped-app)"
expect_block "unlisted path is still blocked"                "$(edit_payload /Users/test/shipped-app/a.ts)"
expect_block "prefix lookalike (unshipped-app-evil) is blocked" "$(edit_payload /Users/test/unshipped-app-evil/a.ts)"
expect_block "traversal out of the listed root is blocked"   "$(edit_payload /Users/test/unshipped-app/../shipped-app/a.ts)"
expect_block "relative file_path is never exempt"            "$(edit_payload src/a.ts)"

# Fail closed: no list, unreadable list, or only comments/relative entries => guard applies.
rm -f "$LIST"
expect_block "missing list file => guard applies"            "$(edit_payload /Users/test/unshipped-app/a.ts)"
printf '# only comments\nrelative/path\n' >"$LIST"
expect_block "comments and relative entries exempt nothing"  "$(edit_payload /Users/test/unshipped-app/a.ts)"
rm -f "$LIST"; mkdir "$LIST"
expect_block "unreadable list (a directory) => guard applies" "$(edit_payload /Users/test/unshipped-app/a.ts)"

# ---- short replies: `approve` / `deny` ------------------------------------------------------
# Transcript fixtures. A real guard block is a NON-human user entry holding a tool_result with
# is_error:true whose content starts with the hook-error prefix and ends with the hits marker.
rm -rf "$LIST"; printf '' >"$LIST"
TX="$D/tx.jsonl"
TARGET=/Users/test/shipped-app/a.ts
PFX='PreToolUse:Edit hook error: Blocked: this edit raises (or, for a new file / new assignment, sets) timeout-shaped value(s): x.'
H()   { printf '{"type":"user","origin":{"kind":"human"},"isSidechain":false,"message":{"role":"user","content":"%s"}}\n' "$1"; }
HSC() { printf '{"type":"user","origin":{"kind":"human"},"isSidechain":true,"message":{"role":"user","content":"%s"}}\n' "$1"; }
NH()  { printf '{"type":"user","isSidechain":false,"message":{"role":"user","content":"%s"}}\n' "$1"; }
B()   { printf '{"type":"user","isSidechain":false,"message":{"role":"user","content":[{"type":"tool_result","is_error":true,"content":"%s [timeout-guard hits: %s]"}]}}\n' "$PFX" "$1"; }
BOK() { printf '{"type":"user","isSidechain":false,"message":{"role":"user","content":[{"type":"tool_result","is_error":false,"content":"%s [timeout-guard hits: %s]"}]}}\n' "$PFX" "$1"; }
BEX() { printf '{"type":"user","isSidechain":false,"message":{"role":"user","content":[{"type":"tool_result","is_error":true,"content":"Exit code 1\\n%s [timeout-guard hits: %s]"}]}}\n' "$PFX" "$1"; }
tx_payload() { # <transcript_path>
  printf '{"tool_name":"Edit","transcript_path":"%s","tool_input":{"file_path":"%s","old_string":"const reqTimeout = 1000;","new_string":"const reqTimeout = 5000;"}}' "$1" "$TARGET"
}
run_tx() { printf '%s' "$(tx_payload "$TX")" | HOME="$D" node "$GUARD" 2>/dev/null; }
tx_allow() { local d="$1"; shift; "$@" >"$TX"; if run_tx | grep -q '"decision":"block"'; then fail "$d" "unexpectedly blocked"; else pass "$d"; fi; }
tx_block() { local d="$1"; shift; "$@" >"$TX"; if run_tx | grep -q '"decision":"block"'; then pass "$d"; else fail "$d" "expected a block"; fi; }
seq_() { local f; for f in "$@"; do eval "$f"; done; }   # run several fixture calls into one transcript

K5='reqTimeout::5000'; K1='reqTimeout::1000'

tx_allow "approve as the very next human message"            seq_ "B $K5" "H approve"
tx_allow "Approve! (case + punctuation)"                     seq_ "B $K5" "H Approve!"
tx_allow "APPROVE. (case + punctuation)"                     seq_ "B $K5" "H APPROVE."
tx_block "deny blocks, with a do-not-retry message"          seq_ "B $K5" "H deny"
run_tx | grep -q 'DENIED' && pass "deny message says DENIED" || fail "deny message says DENIED" "missing"
tx_block "approve plus other words is not an approval"       seq_ "B $K5" "H approve-it-please"
tx_block "'approve it' is not an approval"                   seq_ "B $K5" "H 'approve it'"
tx_block "approve one message too late (human said something else first)" seq_ "B $K5" "H why" "H approve"
tx_block "approve BEFORE the block does not count"           seq_ "H approve" "B $K5"
tx_block "approve of a different value (block was for 1000)" seq_ "B $K1" "H approve"
tx_block "tool output that prints the block text (is_error false) is not a block" seq_ "BOK $K5" "H approve"
tx_block "failed command echoing the text (wrong prefix) is not a block"         seq_ "BEX $K5" "H approve"
tx_block "approve from a non-human entry does not count"     seq_ "B $K5" "NH approve"
tx_block "approve from a sidechain human entry does not count" seq_ "B $K5" "HSC approve"
tx_allow "two blocks then one approve covers both"           seq_ "B $K1" "B $K5" "H approve"
tx_allow "one block listing two hits, one approve"           seq_ "B $K1,$K5" "H approve"
tx_allow "deny, then a fresh block, then approve = change of mind" seq_ "B $K5" "H deny" "B $K5" "H approve"
tx_block "approve, then a later block answered by deny = denied"   seq_ "B $K5" "H approve" "B $K5" "H deny"
tx_allow "the typed phrase still works"                      seq_ "H 'confirm reqTimeout = 5000'"
tx_block "typed phrase then a later deny to a fresh block = denied" seq_ "H 'confirm reqTimeout = 5000'" "B $K5" "H deny"
tx_allow "unparseable transcript lines are skipped"          seq_ "echo not-json" "B $K5" "H approve"

: >"$TX"; printf '%s' "$(tx_payload "$D/does-not-exist.jsonl")" | HOME="$D" node "$GUARD" 2>/dev/null | grep -q '"decision":"block"' \
  && pass "missing transcript => blocked (fail closed)" || fail "missing transcript => blocked" "was allowed"

# A subagent's own transcript can never supply the approval; the MAIN session transcript is read.
mkdir -p "$D/proj/sess/subagents"; MAIN="$D/proj/sess.jsonl"
seq_ "B $K5" "H approve" >"$MAIN"; : >"$D/proj/sess/subagents/agent-1.jsonl"
printf '%s' "$(tx_payload "$D/proj/sess/subagents/agent-1.jsonl")" | HOME="$D" node "$GUARD" 2>/dev/null | grep -q '"decision":"block"' \
  && fail "subagent path reads the main transcript" "blocked" || pass "subagent path reads the main transcript"
seq_ "B $K5" "H approve" >"$D/proj/sess/subagents/agent-1.jsonl"; : >"$MAIN"
printf '%s' "$(tx_payload "$D/proj/sess/subagents/agent-1.jsonl")" | HOME="$D" node "$GUARD" 2>/dev/null | grep -q '"decision":"block"' \
  && pass "an approval inside a subagent transcript does not count" || fail "approval inside subagent transcript ignored" "was allowed"

# The block message itself must carry the marker and tell the human the short reply.
seq_ "echo" >"$TX"
OUT="$(run_tx)"
grep -q 'timeout-guard hits: reqTimeout::5000' <<<"$OUT" && pass "block message carries the hits marker" || fail "block message carries the hits marker" "$OUT"
grep -q 'approve' <<<"$OUT" && grep -q 'deny' <<<"$OUT" && pass "block message names approve and deny" || fail "block message names approve and deny" "$OUT"
# Round trip: the guard's real output, recorded as a block, is accepted by the same guard.
REAL="$(printf '%s' "$OUT" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{process.stdout.write(JSON.parse(s).reason)})')"
printf '{"type":"user","isSidechain":false,"message":{"role":"user","content":[{"type":"tool_result","is_error":true,"content":%s}]}}\n' \
  "$(node -e 'process.stdout.write(JSON.stringify("PreToolUse:Edit hook error: "+process.argv[1]))' "$REAL")" >"$TX"
H approve >>"$TX"
run_tx | grep -q '"decision":"block"' && fail "round trip: real block message + approve" "blocked" || pass "round trip: real block message + approve"
grep -q '"via":"reply"' "$D/.claude/timeout-guard-approvals.log" && pass "approval log records via=reply" || fail "approval log records via=reply" "missing"

echo; echo "passed: $((N-F))  failed: $F"
[ "$F" -eq 0 ]
