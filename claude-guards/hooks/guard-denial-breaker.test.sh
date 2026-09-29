#!/usr/bin/env bash
# Behavioral suite for guard-denial-breaker.cjs (synthetic transcripts).
#   bash ~/.claude/hooks/guard-denial-breaker.test.sh
set -uo pipefail
cd "$(dirname "$0")" || exit 1
GUARD="$(pwd)/guard-denial-breaker.cjs"

WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT
N=0; F=0

# mk <file> <spec...> : each spec is  kind:arg ; kinds:
#   human:<text> | midturn:<text> | wrapper:<text> | denial:<text> | plainerr:<text>
#   handback:<text> | agentres:<text> | toolok:<text>
mk() {
  local out="$1"; shift
  python3 - "$out" "$@" <<'PY'
import json,sys
out=sys.argv[1]; L=[]; n=0
for spec in sys.argv[2:]:
    k,_,t=spec.partition(':'); n+=1
    if k=='human': L.append({"type":"user","message":{"content":t}})
    elif k=='humanblock': L.append({"type":"user","message":{"content":[{"type":"text","text":t}]}})
    elif k=='wrapper': L.append({"type":"user","message":{"content":[{"type":"text","text":"<system-reminder>"+t+"</system-reminder>"}]}})
    elif k=='midturn': L.append({"type":"attachment","attachment":{"type":"queued_command","prompt":t,"origin":{"kind":"human"},"humanTurn":True},"rendered":[{"content":"<system-reminder>\nThe user sent a new message while you were working:\n"+t+"\n</system-reminder>"}]})
    elif k=='denial': L.append({"type":"user","message":{"content":[{"type":"tool_result","tool_use_id":"x%d"%n,"content":t,"is_error":True}]}})
    elif k=='toolok': L.append({"type":"user","message":{"content":[{"type":"tool_result","tool_use_id":"x%d"%n,"content":t}]}})
    elif k=='handback': L.append({"type":"queue-operation","operation":"enqueue","content":"<agent-message from=\"a1\">\n[Subagent hand-back] "+t+"\n</agent-message>"})
    elif k=='agentcall': L.append({"type":"assistant","message":{"content":[{"type":"tool_use","id":"ag%d"%n,"name":"Agent","input":{}}]}})
    elif k=='agentres': L.append({"type":"user","message":{"content":[{"type":"tool_result","tool_use_id":"ag%d"%(n-1),"content":[{"type":"text","text":t}]}]}})
open(out,'w').write("\n".join(json.dumps(x) for x in L)+"\n")
PY
}

decision() { # decision <tool> <transcript> [tool_input-json] [extra-env]
  local tool="$1" tr="$2" ti="${3-}"
  [ -z "$ti" ] && ti='{}'
  python3 -c 'import json,sys;print(json.dumps({"tool_name":sys.argv[1],"tool_input":json.loads(sys.argv[3]),"transcript_path":sys.argv[2],"session_id":"s"}))' "$tool" "$tr" "$ti" \
    | HOME="$WORK/home" node "$GUARD" 2>/dev/null | python3 -c 'import json,sys
try:
    print(json.load(sys.stdin)["hookSpecificOutput"].get("permissionDecision",""))
except Exception:
    print("none")'
}
expect() { # expect <name> <want> <got>
  N=$((N+1))
  if [ "$3" = "$2" ]; then echo "PASS  $1"; else F=$((F+1)); echo "FAIL  $1 -> got $3, want $2"; fi
}

DNR='PreToolUse:Bash hook error: DO NOT REPHRASE THIS COMMAND TO GET PAST THIS GUARD. MEMTRACE-FIRST: Bash is targeting an indexed source file'
CLF='Permission for this action was denied by the Claude Code auto mode classifier. Reason: [Safety Bypass Flag].'

T="$WORK/none.jsonl"; mk "$T" "human:do the thing" "toolok:ok"
expect "no denial -> allow (Bash)" allow "$(decision Bash "$T")"

T="$WORK/t1.jsonl"; mk "$T" "human:do the thing" "denial:$DNR"
for TOOL in Bash Read Agent SendMessage mcp__memtrace__find_code; do
  expect "T1 hook denial after last user msg -> deny ($TOOL)" deny "$(decision "$TOOL" "$T")"
done

T="$WORK/clf.jsonl"; mk "$T" "human:go" "denial:$CLF"
expect "T1 classifier denial -> deny" deny "$(decision Bash "$T")"

T="$WORK/before.jsonl"; mk "$T" "denial:$DNR" "human:ok, carry on"
expect "T1 denial BEFORE last user msg -> allow" allow "$(decision Bash "$T")"

T="$WORK/beforeblock.jsonl"; mk "$T" "denial:$DNR" "humanblock:ok, carry on"
expect "T1 denial before a text-block user msg -> allow" allow "$(decision Bash "$T")"

T="$WORK/wrapperonly.jsonl"; mk "$T" "human:go" "denial:$DNR" "wrapper:some reminder"
expect "system-reminder wrapper is NOT a human message -> still deny" deny "$(decision Bash "$T")"

T="$WORK/t2.jsonl"; mk "$T" "human:go" "handback:BLOCKED: the hook denied my Bash call"
expect "T2 subagent BLOCKED hand-back (queue-operation) -> deny" deny "$(decision Bash "$T")"

T="$WORK/t2b.jsonl"; mk "$T" "human:go" "agentcall:" "agentres:Denied by the guard hook; nothing was edited."
expect "T2 Agent tool_result reporting a hook denial -> deny" deny "$(decision Read "$T")"

T="$WORK/t2c.jsonl"; mk "$T" "human:go" "toolok:npm hook: permission denied for the guard agent"
expect "ordinary tool output mentioning denied+hook is NOT a T2 -> allow" allow "$(decision Bash "$T")"

T="$WORK/split.jsonl"; mk "$T" "human:go" "denial:This session is isolated in the worktree /x. Split it into plain, separate commands and run them from /x."
expect "worktree 'Split it into plain' refusal alone -> allow" allow "$(decision Bash "$T")"

T="$WORK/opus.jsonl"; mk "$T" "human:go" "denial:PreToolUse:Write hook error: OPUS CODE-WRITE BLOCKED: opus is the architect. Dispatch instead: Agent(...)"
expect "tier-guard 'Dispatch instead' denial alone -> allow" allow "$(decision Write "$T")"

T="$WORK/quote.jsonl"; mk "$T" "human:go" "toolok:the guard source says DO NOT REPHRASE and circumvention in a comment"
expect "file content merely quoting a T1 phrase -> allow" allow "$(decision Bash "$T")"

T="$WORK/t1.jsonl"
expect "tripped + Write .gsd/phase/x/HALT.md -> allow" allow "$(decision Write "$T" '{"file_path":"/r/.gsd/phase/x/HALT.md","content":"h"}')"
expect "tripped + Write elsewhere -> deny" deny "$(decision Write "$T" '{"file_path":"/r/src/a.cts","content":"h"}')"
expect "tripped + Write HALT.md-lookalike -> deny" deny "$(decision Write "$T" '{"file_path":"/r/.gsd/phase/x/notHALT.md","content":"h"}')"

T="$WORK/mid.jsonl"; mk "$T" "human:go" "denial:$DNR" "midturn:carry on, it is fine"
expect "mid-turn 'user sent a new message' after denial -> allow" allow "$(decision Bash "$T")"

T="$WORK/bad.jsonl"; printf 'not json\n{"broken\n' > "$T"
expect "malformed transcript -> allow" allow "$(decision Bash "$T")"
expect "missing transcript file -> allow" allow "$(decision Bash "$WORK/nope.jsonl")"

T="$WORK/t1.jsonl"
N=$((N+1))
G=$(python3 -c 'import json,sys;print(json.dumps({"tool_name":"Bash","tool_input":{},"transcript_path":sys.argv[1]}))' "$T" | GSD_GUARD_BREAKER_OFF=1 HOME="$WORK/home" node "$GUARD" 2>/dev/null | python3 -c 'import json,sys;print(json.load(sys.stdin)["hookSpecificOutput"].get("permissionDecision",""))')
if [ "$G" = "allow" ]; then echo "PASS  GSD_GUARD_BREAKER_OFF=1 -> allow"; else F=$((F+1)); echo "FAIL  kill switch -> $G"; fi

N=$((N+1))
if [ -s "$WORK/home/.claude/logs/guard-denial-breaker.jsonl" ]; then echo "PASS  trips are logged under HOME/.claude/logs"; else F=$((F+1)); echo "FAIL  no trip log written"; fi

N=$((N+1))
R=$(python3 -c 'import json,sys;print(json.dumps({"tool_name":"Bash","tool_input":{},"transcript_path":sys.argv[1]}))' "$WORK/t1.jsonl" | HOME="$WORK/home" node "$GUARD" 2>/dev/null | python3 -c 'import json,sys;print(json.load(sys.stdin)["hookSpecificOutput"]["permissionDecisionReason"])')
case "$R" in GUARD-DENIAL\ BREAKER*"Stop and tell the user"*) echo "PASS  deny reason text";; *) F=$((F+1)); echo "FAIL  reason -> $R";; esac

echo
echo "guard-denial-breaker suite: $((N-F))/$N passed"
[ $F -eq 0 ] && exit 0 || exit 1
