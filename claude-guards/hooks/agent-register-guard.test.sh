#!/usr/bin/env bash
# Behavioral suite for agent-register-guard.cjs.   bash ~/.claude/hooks/agent-register-guard.test.sh
set -uo pipefail
cd "$(dirname "$0")" || exit 1
GUARD=./agent-register-guard.cjs
N=0; F=0
pass() { N=$((N+1)); echo "PASS  $1"; }
fail() { N=$((N+1)); F=$((F+1)); echo "FAIL  $1 -> $2"; }

WORK="$(mktemp -d)"
STATE="$HOME/.claude/state/gsd-agent-register"
trap 'rm -rf "$WORK"; rm -f "$STATE"/t-*.count' EXIT
rm -f "$STATE"/t-*.count

# mk <file> <brief> <registered:0|1> [source_id-in-call] [is_error]
mk() {
  node -e '
    const [file, brief, registered, callSid, isError] = process.argv.slice(1);
    const rows = [{ type: "user", message: { role: "user", content: brief } }];
    if (registered === "1") {
      rows.push({ type: "assistant", message: { role: "assistant", content: [{ type: "tool_use", id: "tu1", name: "mcp__memtrace__record_external_episode", input: { repo_id: "gsd-core", source_type: "agent_triage", source_id: callSid } }] } });
      rows.push({ type: "user", message: { role: "user", content: [{ type: "tool_result", tool_use_id: "tu1", is_error: isError === "1", content: [{ type: "text", text: "{\"episode_id\":\"01M5NYKCKCYCRT4RYAFWDJPJ8X\",\"repo_id\":\"gsd-core\"}" }] }] } });
    }
    require("fs").writeFileSync(file, rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
  ' "$@"
}

# run <agent_id> <transcript> <last message> -> OUT
run() {
  OUT=$(node -e '
    const [id, tp, last] = process.argv.slice(1);
    process.stdout.write(JSON.stringify({ agent_id: id, agent_transcript_path: tp, last_assistant_message: last }));
  ' "$1" "$2" "$3" | node "$GUARD" 2>&1)
}
blocked() { case "$OUT" in *'"decision":"block"'*) return 0 ;; *) return 1 ;; esac; }

BRIEF='Diagnose #1. REGISTER-WITH-MEMTRACE: source_id=triage-1 repo_id=gsd-core'
EP=01M5NYKCKCYCRT4RYAFWDJPJ8X

mk "$WORK/a.jsonl" "$BRIEF" 0
run t-a "$WORK/a.jsonl" "done, all good"
blocked && pass "governed + not registered -> block" || fail "governed + not registered" "[$OUT]"
case "$OUT" in *'source_id: \"triage-1\"'*) pass "block reason prefilled with source_id" ;; *) fail "prefilled source_id" "[$OUT]" ;; esac

mk "$WORK/b.jsonl" "$BRIEF" 1 triage-1
run t-b "$WORK/b.jsonl" "Registered: $EP  verdict ..."
[ -z "$OUT" ] && pass "registered + id stated -> allow" || fail "registered + stated" "[$OUT]"

run t-b2 "$WORK/b.jsonl" "verdict only, no id"
blocked && pass "registered but id not stated -> block" || fail "id not stated" "[$OUT]"

mk "$WORK/c.jsonl" "$BRIEF" 1 some-other-id
run t-c "$WORK/c.jsonl" "Registered: $EP"
blocked && pass "registered under a different source_id -> block" || fail "wrong source_id" "[$OUT]"

mk "$WORK/d.jsonl" "$BRIEF" 1 triage-1 1
run t-d "$WORK/d.jsonl" "Registered: $EP"
blocked && pass "registration tool_result was an error -> block" || fail "error result" "[$OUT]"

mk "$WORK/e.jsonl" "Explore the repo and report findings." 0
run t-e "$WORK/e.jsonl" "findings"
[ -z "$OUT" ] && pass "ungoverned subagent untouched" || fail "ungoverned" "[$OUT]"

# one-shot cap: third stop for same agent is let through (and logged), not wedged
mk "$WORK/f.jsonl" "$BRIEF" 0
run t-f "$WORK/f.jsonl" "x"; run t-f "$WORK/f.jsonl" "x"; run t-f "$WORK/f.jsonl" "x"
[ -z "$OUT" ] && pass "block cap: 3rd stop is let through" || fail "block cap" "[$OUT]"

run t-g "$WORK/missing.jsonl" "x"
[ -z "$OUT" ] && pass "missing transcript fails open" || fail "missing transcript" "[$OUT]"

OUT=$(printf 'not json' | node "$GUARD" 2>&1)
[ -z "$OUT" ] && pass "malformed payload fails open" || fail "malformed payload" "[$OUT]"

echo "---"; echo "$((N-F))/$N passed"
[ "$F" = 0 ]
