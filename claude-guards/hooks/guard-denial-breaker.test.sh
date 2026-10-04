#!/usr/bin/env bash
# Behavioral suite for the guard circuit breaker v2:
#   guard-denial-breaker.cjs (PreToolUse notice), guard-restart-stop.cjs (Stop restart),
#   memtrace-quota-watch.cjs (quota -> CodeGraph routing), worktree-reap.sh (liveness).
#   bash claude-guards/hooks/guard-denial-breaker.test.sh
# Contract under test: the breaker NEVER denies a tool call, NEVER halts, and NEVER tells the
# user to type anything; the Stop hook restarts Claude on its own, bounded by a cap.
set -uo pipefail
cd "$(dirname "$0")" || exit 1
HERE="$(pwd)"
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT
export HOME="$WORK/home"; mkdir -p "$HOME"
export WORKTREE_REAP_LOG="$WORK/reap.log" GUARD_BREAKER_STATE="$WORK/state" MEMTRACE_QUOTA_STATE="$WORK/quota.json"
N=0; F=0
expect() { N=$((N+1)); if [ "$3" = "$2" ]; then echo "PASS  $1"; else F=$((F+1)); echo "FAIL  $1 -> got [$3], want [$2]"; fi; }
has() { case "$3" in *"$2"*) N=$((N+1)); echo "PASS  $1";; *) N=$((N+1)); F=$((F+1)); echo "FAIL  $1 -> [$3] lacks [$2]";; esac; }

mk() { # mk <file> <spec...>   kinds: human|denial|toolok|assistant
  local out="$1"; shift
  python3 - "$out" "$@" <<'PY'
import json,sys
out=sys.argv[1]; L=[]
for n,spec in enumerate(sys.argv[2:]):
    k,_,t=spec.partition(':')
    if k=='human': L.append({"type":"user","uuid":"h%d"%n,"message":{"content":t}})
    elif k=='denial': L.append({"type":"user","uuid":"u%d"%n,"message":{"content":[{"type":"tool_result","tool_use_id":"x%d"%n,"content":t,"is_error":True}]}})
    elif k=='toolok': L.append({"type":"user","uuid":"u%d"%n,"message":{"content":[{"type":"tool_result","tool_use_id":"x%d"%n,"content":t}]}})
    elif k=='assistant': L.append({"type":"assistant","uuid":"a%d"%n,"message":{"content":[{"type":"text","text":t}]}})
open(out,'w').write("\n".join(json.dumps(x) for x in L)+"\n")
PY
}
run() { # run <hook> <transcript> [session]
  python3 -c 'import json,sys;print(json.dumps({"tool_name":"Bash","tool_input":{},"transcript_path":sys.argv[1],"session_id":sys.argv[2],"hook_event_name":"x"}))' "$2" "${3:-s1}" | node "$HERE/$1" 2>/dev/null
}
field() { python3 -c 'import json,sys
try:
    d=json.load(sys.stdin)
except Exception:
    print("none"); sys.exit()
h=d.get("hookSpecificOutput",{})
print(d.get("decision") or h.get("permissionDecision") or ("context" if h.get("additionalContext") else "empty"))'; }

DNR='PreToolUse:Read hook error: DO NOT REPHRASE THIS COMMAND TO GET PAST THIS GUARD. MEMTRACE-FIRST: use mcp__codegraph__codegraph_node file mode.'

# --- PreToolUse breaker: never denies -----------------------------------------------------
T="$WORK/a.jsonl"; mk "$T" "human:go" "toolok:ok"
expect "no trip -> silent" none "$(run guard-denial-breaker.cjs "$T" | field)"

T="$WORK/b.jsonl"; mk "$T" "human:go" "denial:$DNR"
OUT1="$(run guard-denial-breaker.cjs "$T" sB)"
expect "trip -> context, NOT deny" context "$(printf '%s' "$OUT1" | field)"
has "notice quotes the guard's own instruction" "codegraph_node file mode" "$OUT1"
has "notice forbids stopping/asking the user" "do NOT ask them to type" "$OUT1"
expect "same trip again (parallel call) -> silent" none "$(run guard-denial-breaker.cjs "$T" sB | field)"

T="$WORK/c.jsonl"; mk "$T" "human:go" "denial:$DNR" "toolok:fine"
expect "already recovered -> silent" none "$(run guard-denial-breaker.cjs "$T" sC | field)"

T="$WORK/d.jsonl"; mk "$T" "human:go" "denial:PreToolUse:Bash hook error: GUARD-BREAKER: do NOT rephrase"
expect "own sentinel never re-trips" none "$(run guard-denial-breaker.cjs "$T" sD | field)"

T="$WORK/e.jsonl"; mk "$T" "human:go" "denial:$DNR" "human:new message" "toolok:ok"
expect "new human message resets" none "$(run guard-denial-breaker.cjs "$T" sE | field)"

# --- Stop hook: automatic restart, bounded -----------------------------------------------
T="$WORK/f.jsonl"; mk "$T" "human:go" "denial:$DNR" "assistant:I am blocked by a guard, please type the override phrase."
for i in 1 2 3; do expect "stop while blocked -> restart #$i" block "$(run guard-restart-stop.cjs "$T" sF | field)"; done
expect "restart cap reached -> allow stop, never halt" none "$(run guard-restart-stop.cjs "$T" sF | field)"
has "restart reason tells Claude to redo it" "task is not done" "$(run guard-restart-stop.cjs "$T" sF2)"

T="$WORK/g.jsonl"; mk "$T" "human:go" "denial:$DNR" "toolok:recovered" "assistant:Done, all finished."
expect "recovered and finished -> allow stop" none "$(run guard-restart-stop.cjs "$T" sG | field)"

T="$WORK/h.jsonl"; mk "$T" "human:go" "denial:$DNR" "toolok:recovered" "assistant:The hook blocked me so please run the override."
expect "recovered but hands back to human -> restart" block "$(run guard-restart-stop.cjs "$T" sH | field)"

T="$WORK/i.jsonl"; mk "$T" "human:go" "toolok:ok" "assistant:All done."
expect "no trip -> allow stop" none "$(run guard-restart-stop.cjs "$T" sI | field)"

# --- Memtrace quota -> CodeGraph routing ---------------------------------------------------
Q='{"hook_event_name":"PostToolUse","tool_name":"mcp__memtrace__find_code","tool_response":{"error":"quota_exceeded","message":"Monthly query limit reached (1000)","quota":{"blocked":true,"periodEnd":"2099-01-01T00:00:00Z"}}}'
OUTQ="$(printf '%s' "$Q" | node "$HERE/memtrace-quota-watch.cjs")"
expect "quota response -> context" context "$(printf '%s' "$OUTQ" | field)"
has "quota context names codegraph_explore" "codegraph_explore" "$OUTQ"
expect "quota state recorded" yes "$([ -f "$MEMTRACE_QUOTA_STATE" ] && echo yes || echo no)"
T="$WORK/j.jsonl"; mk "$T" "human:go" "denial:$DNR"
has "breaker routes to CodeGraph while quota blocked" "Memtrace quota is exhausted" "$(run guard-denial-breaker.cjs "$T" sJ)"
printf '%s' '{"hook_event_name":"PostToolUse","tool_name":"mcp__memtrace__find_code","tool_response":{"results":[]}}' | node "$HERE/memtrace-quota-watch.cjs" >/dev/null
expect "successful Memtrace call clears quota state" no "$([ -f "$MEMTRACE_QUOTA_STATE" ] && echo yes || echo no)"

# --- worktree-reap: a fresh, clean, trivially 'merged' worktree must survive ---------------
R="$WORK/repo"; git init -q -b main "$R" && git -C "$R" -c user.email=t@t -c user.name=t commit -q --allow-empty -m init
mkdir -p "$R/.claude/worktrees"; git -C "$R" worktree add -q "$R/.claude/worktrees/live" -b claude/live
( cd "$R" && WORKTREE_REAP_MIN_AGE_SECONDS=86400 bash "$HERE/worktree-reap.sh" </dev/null >/dev/null )
expect "fresh worktree not reaped (recent activity)" yes "$([ -d "$R/.claude/worktrees/live" ] && echo yes || echo no)"
( cd "$R/.claude/worktrees/live" && exec sleep 20 ) & echo $! >"$WORK/pid"; sleep 0.5
( cd "$R" && WORKTREE_REAP_MIN_AGE_SECONDS=0 bash "$HERE/worktree-reap.sh" </dev/null >/dev/null )
expect "worktree with live process cwd not reaped" yes "$([ -d "$R/.claude/worktrees/live" ] && echo yes || echo no)"
kill "$(cat "$WORK/pid")" 2>/dev/null; sleep 0.3
( cd "$R" && WORKTREE_REAP_MIN_AGE_SECONDS=0 bash "$HERE/worktree-reap.sh" </dev/null >/dev/null )
expect "idle, old, merged, clean worktree is reaped" no "$([ -d "$R/.claude/worktrees/live" ] && echo yes || echo no)"

echo "---"; echo "$((N-F))/$N passed"
[ "$F" -eq 0 ]
