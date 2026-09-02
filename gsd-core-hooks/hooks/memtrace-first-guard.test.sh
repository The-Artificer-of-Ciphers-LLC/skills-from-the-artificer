#!/usr/bin/env bash
# Regression suite for memtrace-first-guard.cjs. Run after ANY edit to the guard.
#   bash .claude/hooks/memtrace-first-guard.test.sh
# Fixtures are synthetic on purpose: an earlier version of this suite tested
# against the LIVE session transcript, which grows under the test and produced a
# false failure. Never point these at a real transcript.
set -uo pipefail
cd "$(dirname "$0")/../.." || exit 1
G=.claude/hooks/memtrace-first-guard.cjs
D=$(mktemp -d); trap 'rm -rf "$D"' EXIT
python3 - "$D" <<'PY'
import json,sys
d=sys.argv[1]
U=lambda t:{"type":"user","message":{"role":"user","content":t}}
TR={"type":"user","message":{"role":"user","content":[{"type":"tool_result","content":"ok"}]}}
MEM={"type":"assistant","message":{"role":"assistant","content":[{"type":"tool_use","name":"mcp__memtrace__find_symbol","input":{}}]}}
B={"type":"assistant","message":{"role":"assistant","content":[{"type":"tool_use","name":"Bash","input":{"command":"ls"}}]}}
def w(n,rows,compact=True):
    sep=(',',':') if compact else None
    open(f"{d}/{n}",'w').write("\n".join(json.dumps(r,separators=sep) for r in rows)+"\n")
w('stale.jsonl',[U("t1"),MEM,B,TR,U("t2"),B,TR])
w('fresh.jsonl',[U("t1"),B,TR,U("t2"),MEM,TR])
w('toolres.jsonl',[U("t"),MEM,TR,B,TR,B,TR])
w('spaced.jsonl',[U("t1"),MEM,B,TR,U("t2"),B,TR],compact=False)
w('nouser.jsonl',[B,MEM,TR])
PY
F=0
probe(){ r=$(printf '%s' "$2" | node "$G")
 d=$(printf '%s' "$r" | python3 -c 'import sys,json;s=sys.stdin.read();print(json.loads(s)["hookSpecificOutput"]["permissionDecision"] if s.strip() else "allow")')
 if [ "$d" = "$3" ]; then echo "PASS  $1"; else echo "FAIL  $1 -> $d (expected $3)"; F=1; fi; }
probe_env(){ r=$(GSD_MEMTRACE_FIRST_OVERRIDE=1 sh -c "printf '%s' \"\$1\" | node \"\$2\"" _ "$2" "$G")
 d=$(printf '%s' "$r" | python3 -c 'import sys,json;s=sys.stdin.read();print(json.loads(s)["hookSpecificOutput"]["permissionDecision"] if s.strip() else "allow")')
 if [ "$d" = "$3" ]; then echo "PASS  $1"; else echo "FAIL  $1 -> $d (expected $3)"; F=1; fi; }
j(){ python3 -c "import json,sys;print(json.dumps({'tool_name':sys.argv[1],'transcript_path':sys.argv[2],'tool_input':json.loads(sys.argv[3])}))" "$@"; }
S=$D/stale.jsonl
probe "stale memtrace -> deny"    "$(j Bash $S '{"command":"grep -n foo src/a.cts"}')" deny
probe "fresh memtrace -> allow"   "$(j Bash $D/fresh.jsonl '{"command":"grep -n foo src/a.cts"}')" allow
probe "spaced json -> deny"       "$(j Bash $D/spaced.jsonl '{"command":"grep -n foo src/a.cts"}')" deny
probe "tool results don't reset"  "$(j Bash $D/toolres.jsonl '{"command":"grep -n foo src/a.cts"}')" allow
probe "rg src/"                   "$(j Bash $S '{"command":"rg X src/"}')" deny
probe "sed -n src/"               "$(j Bash $S '{"command":"sed -n 1,9p src/a.cts"}')" deny
probe "grep -rl (callers Q)"      "$(j Bash $S '{"command":"grep -rl foo src/"}')" deny
probe "find -exec grep"           "$(j Bash $S '{"command":"find src -name x -exec grep -n f {} +"}')" deny
probe "Grep tool"                 "$(j Grep $S '{"pattern":"X","path":"src/"}')" deny
probe "Glob tool"                 "$(j Glob $S '{"pattern":"src/**/*.cts"}')" deny
probe "prose .md"                 "$(j Bash $S '{"command":"grep -n x CONTEXT.md"}')" allow
probe "config .json"              "$(j Bash $S '{"command":"grep -n x package.json"}')" allow
probe "docs/"                     "$(j Bash $S '{"command":"grep -rn x docs/adr/"}')" allow
probe "tests/"                    "$(j Bash $S '{"command":"grep -n x tests/a.test.cjs"}')" allow
probe "scripts/"                  "$(j Bash $S '{"command":"grep -n x scripts/a.cjs"}')" allow
probe "grep -c counting"          "$(j Bash $S '{"command":"grep -c foo src/a.cts"}')" allow
probe "find -name inventory"      "$(j Bash $S '{"command":"find src -name \"*.cts\" | wc -l"}')" allow
probe "build/git"                 "$(j Bash $S '{"command":"npm run build:lib && git status"}')" allow
probe "no user turn -> deny"      "$(j Bash $D/nouser.jsonl '{"command":"grep -n foo src/a.cts"}')" deny
probe "unreadable transcript"     "$(j Bash $D/nope.jsonl '{"command":"grep -n foo src/a.cts"}')" deny
probe "inline override prefix -> deny (not self-issuable)" "$(j Bash $S '{"command":"GSD_MEMTRACE_FIRST_OVERRIDE=1 grep -n f src/a.cts"}')" deny
probe_env "env override -> allow (human escape)" "$(j Bash $S '{"command":"grep -n f src/a.cts"}')" allow
echo; [ $F = 0 ] && echo "memtrace-first-guard: ALL PASS" || { echo "memtrace-first-guard: FAILURES"; exit 1; }
