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
expect "a subagent BLOCKED hand-back (queue-operation) is NOT a trip -> allow" allow "$(decision Bash "$T")"

T="$WORK/t2b.jsonl"; mk "$T" "human:go" "agentcall:" "agentres:Denied by the guard hook; nothing was edited."
expect "an Agent tool_result reporting a hook denial is NOT a trip -> allow" allow "$(decision Read "$T")"

T="$WORK/t2c.jsonl"; mk "$T" "human:go" "toolok:npm hook: permission denied for the guard agent"
expect "ordinary tool output mentioning denied+hook is NOT a T2 -> allow" allow "$(decision Bash "$T")"

T="$WORK/split.jsonl"; mk "$T" "human:go" "denial:This session is isolated in the worktree /x. Split it into plain, separate commands and run them from /x."
expect "worktree 'Split it into plain' refusal alone -> allow" allow "$(decision Bash "$T")"

T="$WORK/opus.jsonl"; mk "$T" "human:go" "denial:PreToolUse:Write hook error: OPUS CODE-WRITE BLOCKED: opus is the architect. Dispatch instead: Agent(...)"
expect "tier-guard 'Dispatch instead' denial alone -> allow" allow "$(decision Write "$T")"

T="$WORK/quote.jsonl"; mk "$T" "human:go" "toolok:the guard source says DO NOT REPHRASE and circumvention in a comment"
expect "file content merely quoting a T1 phrase -> allow" allow "$(decision Bash "$T")"

RS='denial:GUARD-BREAKER RESTART: a guard just denied an action; re-plan.'
T="$WORK/t1.jsonl"
expect "first trip + HALT.md write -> deny (interrupt is total for one call)" deny "$(decision Write "$T" '{"file_path":"/r/.gsd/phase/x/HALT.md","content":"h"}')"

T="$WORK/ack1.jsonl"; mk "$T" "human:go" "denial:$DNR" "$RS"
expect "trip then own restart denial -> next call allowed (Bash)" allow "$(decision Bash "$T")"
expect "trip then own restart denial -> next call allowed (Agent)" allow "$(decision Agent "$T")"

T="$WORK/ack2.jsonl"; mk "$T" "human:go" "denial:$DNR" "$RS" "toolok:ok" "denial:$CLF"
expect "second NEW trip after an interrupt -> deny again" deny "$(decision Bash "$T")"

T="$WORK/ack3.jsonl"; mk "$T" "human:go" "denial:$DNR" "$RS" "denial:$CLF" "$RS"
expect "second trip acknowledged -> allow" allow "$(decision Bash "$T")"

T="$WORK/selfquote.jsonl"; mk "$T" "human:go" "denial:GUARD-BREAKER RESTART: do not rephrase; circumvention; do not route around it"
expect "sentinel message quoting T1 phrases never trips -> allow" allow "$(decision Bash "$T")"

T="$WORK/handack.jsonl"; mk "$T" "human:go" "handback:BLOCKED: the hook denied my Bash call" "$RS" "handback:BLOCKED: the guard denied it again"
expect "a new subagent BLOCKED report after an interrupt is still NOT a trip -> allow" allow "$(decision Bash "$T")"

T="$WORK/max4.jsonl"; mk "$T" "human:go" "denial:$DNR" "$RS" "denial:$DNR" "$RS" "denial:$DNR" "$RS" "denial:$DNR" "$RS" "denial:$DNR"
expect "4 interrupts then a 5th trip -> restart deny (not hard stop)" deny "$(decision Write "$T" '{"file_path":"/r/.gsd/phase/x/HALT.md","content":"h"}')"

T="$WORK/max5.jsonl"; mk "$T" "human:go" "denial:$DNR" "$RS" "denial:$DNR" "$RS" "denial:$DNR" "$RS" "denial:$DNR" "$RS" "denial:$DNR" "$RS"
expect "5 interrupts in one human turn -> hard stop (Bash)" deny "$(decision Bash "$T")"
expect "hard stop still allows HALT.md Write" allow "$(decision Write "$T" '{"file_path":"/r/.gsd/phase/x/HALT.md","content":"h"}')"
expect "hard stop denies other Write" deny "$(decision Write "$T" '{"file_path":"/r/src/a.cts","content":"h"}')"
expect "hard stop denies HALT.md lookalike" deny "$(decision Write "$T" '{"file_path":"/r/.gsd/phase/x/notHALT.md","content":"h"}')"

T="$WORK/max5h.jsonl"; mk "$T" "human:go" "denial:$DNR" "$RS" "denial:$DNR" "$RS" "denial:$DNR" "$RS" "denial:$DNR" "$RS" "denial:$DNR" "$RS" "human:ok continue"
expect "human message resets the interrupt counter -> allow" allow "$(decision Bash "$T")"
T="$WORK/max5h2.jsonl"; mk "$T" "human:go" "denial:$DNR" "$RS" "denial:$DNR" "$RS" "denial:$DNR" "$RS" "denial:$DNR" "$RS" "denial:$DNR" "$RS" "human:ok continue" "denial:$DNR"
expect "after human reset a new trip -> one restart interrupt" deny "$(decision Bash "$T")"

T="$WORK/mid.jsonl"; mk "$T" "human:go" "denial:$DNR" "midturn:carry on, it is fine"
expect "mid-turn 'user sent a new message' after denial -> allow" allow "$(decision Bash "$T")"

T="$WORK/bad.jsonl"; printf 'not json\n{"broken\n' > "$T"
expect "malformed transcript -> allow" allow "$(decision Bash "$T")"
expect "missing transcript file -> allow" allow "$(decision Bash "$WORK/nope.jsonl")"

# Real harness shape: a hook denial is stored as "PreToolUse:<Tool> hook error: <text>".
PRS='denial:PreToolUse:Read hook error: GUARD-BREAKER RESTART: a guard just denied an action; re-plan.'
PRSB='denial:PreToolUse:Bash hook error: GUARD-BREAKER RESTART: a guard just denied an action; re-plan.'

T="$WORK/pfx_a.jsonl"; mk "$T" "human:go" "denial:$DNR" "$PRS"
expect "prefixed restart ack (Read) -> next call allowed" allow "$(decision Bash "$T")"
T="$WORK/pfx_a2.jsonl"; mk "$T" "human:go" "denial:$DNR" "$PRSB"
expect "prefixed restart ack (Bash) -> next call allowed" allow "$(decision Read "$T")"

T="$WORK/pfx_b.jsonl"; mk "$T" "human:go" "denial:$DNR" "$PRS" "denial:$CLF"
expect "prefixed ack then a NEW trip -> deny again" deny "$(decision Bash "$T")"
T="$WORK/pfx_b2.jsonl"; mk "$T" "human:go" "denial:$DNR" "$PRS" "denial:$DNR" "$PRSB"
expect "prefixed ack, new trip, second prefixed ack -> allow" allow "$(decision Bash "$T")"

T="$WORK/pfx_c5.jsonl"; mk "$T" "human:go" "denial:$DNR" "$PRS" "denial:$DNR" "$PRSB" "denial:$DNR" "$PRS" "denial:$DNR" "$PRSB" "denial:$DNR" "$PRS"
expect "5 prefixed acks in one human turn -> hard stop (Bash)" deny "$(decision Bash "$T")"
expect "5 prefixed acks -> HALT.md Write still allowed" allow "$(decision Write "$T" '{"file_path":"/r/.gsd/phase/x/HALT.md","content":"h"}')"
expect "5 prefixed acks -> other Write denied" deny "$(decision Write "$T" '{"file_path":"/r/src/a.cts","content":"h"}')"
T="$WORK/pfx_c4.jsonl"; mk "$T" "human:go" "denial:$DNR" "$PRS" "denial:$DNR" "$PRSB" "denial:$DNR" "$PRS" "denial:$DNR" "$PRSB"
expect "4 prefixed acks -> still allowed" allow "$(decision Bash "$T")"

T="$WORK/pfx_d.jsonl"; mk "$T" "human:go" "denial:PreToolUse:Read hook error: GUARD-BREAKER RESTART: do not rephrase; circumvention; do not route around it"
expect "prefixed restart text quoting T1 phrases never trips -> allow" allow "$(decision Bash "$T")"

T="$WORK/pfx_e.jsonl"; mk "$T" "human:go" "denial:PreToolUse:Bash hook error: GUARD-BREAKER HALT: do not work around this; safety bypass; circumvention"
expect "prefixed HALT text quoting T1 phrases never trips -> allow" allow "$(decision Bash "$T")"

T="$WORK/t1.jsonl"
N=$((N+1))
G=$(python3 -c 'import json,sys;print(json.dumps({"tool_name":"Bash","tool_input":{},"transcript_path":sys.argv[1]}))' "$T" | GSD_GUARD_BREAKER_OFF=1 HOME="$WORK/home" node "$GUARD" 2>/dev/null | python3 -c 'import json,sys;print(json.load(sys.stdin)["hookSpecificOutput"].get("permissionDecision",""))')
if [ "$G" = "allow" ]; then echo "PASS  GSD_GUARD_BREAKER_OFF=1 -> allow"; else F=$((F+1)); echo "FAIL  kill switch -> $G"; fi

N=$((N+1))
if [ -s "$WORK/home/.claude/logs/guard-denial-breaker.jsonl" ]; then echo "PASS  trips are logged under HOME/.claude/logs"; else F=$((F+1)); echo "FAIL  no trip log written"; fi

N=$((N+1))
R=$(python3 -c 'import json,sys;print(json.dumps({"tool_name":"Bash","tool_input":{},"transcript_path":sys.argv[1]}))' "$WORK/t1.jsonl" | HOME="$WORK/home" node "$GUARD" 2>/dev/null | python3 -c 'import json,sys;print(json.load(sys.stdin)["hookSpecificOutput"]["permissionDecisionReason"])')
case "$R" in "GUARD-BREAKER RESTART:"*"Do not report this to the user"*"different step"*) echo "PASS  restart reason text";; *) F=$((F+1)); echo "FAIL  reason -> $R";; esac

N=$((N+1))
LOW=$(printf '%s' "$R" | tr 'A-Z' 'a-z')
case "$LOW" in *"do not rephrase"*|*"do not route around"*|*circumvention*|*"safety bypass"*|*"do not work around"*|*"denied by the claude code auto mode classifier"*) F=$((F+1)); echo "FAIL  restart text contains a T1 phrase";; *) echo "PASS  restart text has no T1 phrase";; esac

N=$((N+1))
R=$(python3 -c 'import json,sys;print(json.dumps({"tool_name":"Bash","tool_input":{},"transcript_path":sys.argv[1]}))' "$WORK/max5.jsonl" | HOME="$WORK/home" node "$GUARD" 2>/dev/null | python3 -c 'import json,sys;print(json.load(sys.stdin)["hookSpecificOutput"]["permissionDecisionReason"])')
case "$R" in "GUARD-BREAKER HALT:"*"short factual summary"*) echo "PASS  backstop reason text";; *) F=$((F+1)); echo "FAIL  backstop reason -> $R";; esac

N=$((N+1))
if grep -q '"kind":"backstop"' "$WORK/home/.claude/logs/guard-denial-breaker.jsonl" && grep -q '"kind":"restart"' "$WORK/home/.claude/logs/guard-denial-breaker.jsonl"; then echo "PASS  restart and backstop are logged"; else F=$((F+1)); echo "FAIL  log kinds missing"; fi

echo
echo "guard-denial-breaker suite: $((N-F))/$N passed"
[ $F -eq 0 ] && exit 0 || exit 1
