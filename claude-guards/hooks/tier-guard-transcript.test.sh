#!/usr/bin/env bash
# tier-guard-transcript.test.sh — transcript-derived tier resolution for tier-guard.cjs.
# Self-contained: temp HOME, no GSD_TIER_GUARD* / ANTHROPIC_MODEL.
set -u
HOOK="$(cd "$(dirname "$0")" && pwd)/tier-guard.cjs"
BASE="${TMPDIR_BASE:-/private/tmp/claude-501/-Users-trekkie-projects-gsd-core--claude-worktrees-triage-review-699f9b/39f7e993-290a-4bd7-9954-7a5206dbbce4/scratchpad}"
mkdir -p "$BASE"
T="$(mktemp -d "$BASE/tgt.XXXXXX")"
trap 'rm -rf "$T"' EXIT
export HOME="$T/home"; mkdir -p "$HOME/.claude/state/gsd-tier"
unset GSD_TIER_GUARD GSD_TIER_GUARD_UNKNOWN GSD_TIER_GUARD_FREE_EDITS GSD_TIER_GUARD_MAX_LINES GSD_TIER_GUARD_MAX_CHARS ANTHROPIC_MODEL

PASS=0; FAIL=0
line() { # model
  printf '{"type":"assistant","message":{"model":"%s","content":[]}}\n' "$1"
}
user() { printf '{"type":"user","message":{"content":"hi"}}\n'; }
record() { # sid tier
  printf '{"tier":"%s"}' "$2" > "$HOME/.claude/state/gsd-tier/$1.json"
}
run() { # sid tool path transcript_or_empty [extra tool_input json]
  local sid="$1" tool="$2" p="$3" tp="$4" ti
  if [ "$tool" = Edit ]; then ti="{\"file_path\":\"$p\",\"old_string\":\"a\",\"new_string\":\"x\"}"
  else ti="{\"file_path\":\"$p\",\"content\":\"x\"}"; fi
  local tpj=""; [ -n "$tp" ] && tpj=",\"transcript_path\":\"$tp\""
  printf '{"session_id":"%s","tool_name":"%s","tool_input":%s%s}' "$sid" "$tool" "$ti" "$tpj" | node "$HOOK" 2>/dev/null
}
expect() { # name allow|deny output [needle]
  local name="$1" want="$2" out="$3" needle="${4:-}" got=allow
  case "$out" in *'"permissionDecision":"deny"'*) got=deny;; esac
  local ok=1
  [ "$got" = "$want" ] || ok=0
  if [ -n "$needle" ] && [ "$ok" = 1 ]; then case "$out" in *"$needle"*) ;; *) ok=0;; esac; fi
  if [ "$ok" = 1 ]; then PASS=$((PASS+1)); echo "PASS  $name (got $got)"; else FAIL=$((FAIL+1)); echo "FAIL  $name (want $want, got $got) out=${out:0:200}"; fi
}
CODE=/tmp/x/foo.cjs

# 1 sonnet transcript, no record -> allow
{ user; line claude-sonnet-5-5; } > "$T/1.jsonl"
expect "1 sonnet transcript, no record" allow "$(run c1 Write $CODE "$T/1.jsonl")"
# 2 opus transcript -> deny
{ user; line claude-opus-5-5; } > "$T/2.jsonl"
expect "2 opus transcript" deny "$(run c2 Write $CODE "$T/2.jsonl")"
# 3 record sonnet, transcript opus -> deny
record c3 sonnet
expect "3 record sonnet / transcript opus (cab4b46e)" deny "$(run c3 Write $CODE "$T/2.jsonl")"
# 4 record opus, transcript sonnet -> allow
record c4 opus
expect "4 record opus / transcript sonnet" allow "$(run c4 Write $CODE "$T/1.jsonl")"
# 5 switches
{ line claude-opus-5-5; user; line claude-opus-5-5; line claude-sonnet-5-5; } > "$T/5a.jsonl"
expect "5a opus then sonnet" allow "$(run c5a Write $CODE "$T/5a.jsonl")"
{ line claude-sonnet-5-5; user; line claude-opus-5-5; } > "$T/5b.jsonl"
expect "5b sonnet then opus" deny "$(run c5b Write $CODE "$T/5b.jsonl")"
# 6 trailing synthetic ignored
{ line claude-sonnet-5-5; line '<synthetic>'; } > "$T/6.jsonl"
expect "6 trailing synthetic ignored" allow "$(run c6 Write $CODE "$T/6.jsonl")"
# 7 nothing known -> deny with could-not-be-determined
expect "7 no transcript/record/env fail-closed" deny "$(run c7 Write $CODE "")" "could not be determined"
# 8 unreadable/garbage
expect "8a nonexistent file" deny "$(run c8a Write $CODE "$T/nope.jsonl")" "could not be determined"
mkdir "$T/dir.jsonl"
expect "8b directory named .jsonl" deny "$(run c8b Write $CODE "$T/dir.jsonl")" "could not be determined"
line claude-sonnet-5-5 > "$T/model.txt"
expect "8c non-.jsonl file ignored" deny "$(run c8c Write $CODE "$T/model.txt")" "could not be determined"
printf 'garbage\n{not json\n\n\x00\x01"assistant"\n' > "$T/garbage.jsonl"
expect "8d garbage lines" deny "$(run c8d Write $CODE "$T/garbage.jsonl")" "could not be determined"
record c8e sonnet
expect "8e garbage transcript, record sonnet honored" allow "$(run c8e Write $CODE "$T/garbage.jsonl")"
record c8f unknown
expect "8f record unknown ignored -> env sonnet honored" allow "$(ANTHROPIC_MODEL=claude-sonnet-5-5 run c8f Write $CODE "$T/nope.jsonl")"
expect "8g env opus, nothing else" deny "$(ANTHROPIC_MODEL=claude-opus-5-5 run c8g Write $CODE "")" "OPUS CODE-WRITE BLOCKED: opus is the architect"
# 9 large transcript, model at end
{ for i in $(seq 1 12000); do printf '{"type":"user","message":{"content":"padding padding padding padding padding padding padding padding %s"}}\n' "$i"; done; line claude-sonnet-5-5; } > "$T/9a.jsonl"
{ line claude-sonnet-5-5; for i in $(seq 1 12000); do printf '{"type":"user","message":{"content":"padding padding padding padding padding padding padding padding %s"}}\n' "$i"; done; line claude-opus-5-5; } > "$T/9b.jsonl"
SZ=$(wc -c < "$T/9b.jsonl"); [ "$SZ" -gt 1048576 ] || { FAIL=$((FAIL+1)); echo "FAIL  9 setup: transcript only $SZ bytes"; }
s=$(date +%s%N 2>/dev/null || python3 -c 'import time;print(int(time.time()*1e9))')
out=$(run c9a Write $CODE "$T/9a.jsonl")
e=$(date +%s%N 2>/dev/null || python3 -c 'import time;print(int(time.time()*1e9))')
expect "9a >1MB, sonnet at end" allow "$out"
[ $(( (e - s) / 1000000 )) -lt 1000 ] && { PASS=$((PASS+1)); echo "PASS  9a fast ($(( (e - s) / 1000000 ))ms)"; } || { FAIL=$((FAIL+1)); echo "FAIL  9a slow"; }
s=$(date +%s%N 2>/dev/null || python3 -c 'import time;print(int(time.time()*1e9))')
out=$(run c9b Write $CODE "$T/9b.jsonl")
e=$(date +%s%N 2>/dev/null || python3 -c 'import time;print(int(time.time()*1e9))')
expect "9b >1MB, sonnet first / opus at end" deny "$out"
[ $(( (e - s) / 1000000 )) -lt 1000 ] && { PASS=$((PASS+1)); echo "PASS  9b fast ($(( (e - s) / 1000000 ))ms)"; } || { FAIL=$((FAIL+1)); echo "FAIL  9b slow"; }
# 10 opus small Edit under free budget
expect "10 opus small Edit allowed (free budget)" allow "$(run c10-fresh Edit $CODE "$T/2.jsonl")"
# 11 non-code path by opus
expect "11 opus non-code path allowed" allow "$(run c11 Write /tmp/x/notes.md "$T/2.jsonl")"

echo "---- $PASS passed, $FAIL failed"
[ "$FAIL" = 0 ]
