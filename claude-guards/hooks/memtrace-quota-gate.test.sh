#!/usr/bin/env bash
# Behavioral suite for memtrace-quota-gate.cjs (PreToolUse deny while Memtrace is in cooldown).
#   bash claude-guards/hooks/memtrace-quota-gate.test.sh
set -uo pipefail
cd "$(dirname "$0")" || exit 1
HERE="$(pwd)"
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT
export HOME="$WORK/home"; mkdir -p "$HOME"
export MEMTRACE_QUOTA_STATE="$WORK/quota.json"
N=0; F=0
expect() { N=$((N+1)); if [ "$3" = "$2" ]; then echo "PASS  $1"; else F=$((F+1)); echo "FAIL  $1 -> got [$3], want [$2]"; fi; }
has() { case "$3" in *"$2"*) N=$((N+1)); echo "PASS  $1";; *) N=$((N+1)); F=$((F+1)); echo "FAIL  $1 -> [$3] lacks [$2]";; esac; }
gate() { printf '{"hook_event_name":"PreToolUse","tool_name":"mcp__memtrace__%s"}' "$1" | node "$HERE/memtrace-quota-gate.cjs"; }
dec() { node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{try{console.log(JSON.parse(d).hookSpecificOutput.permissionDecision)}catch{console.log("allow")}})'; }
MONTH='{"error":"quota_exceeded","message":"Monthly query limit reached (1)","quota":{"blocked":true,"periodEnd":"2099-01-01T00:00:00.000Z"}}'
mark() { node -e "require('$HERE/memtrace-quota-state.cjs').markBlocked($MONTH)"; }

expect "not blocked -> allow" allow "$(gate find_code | dec)"
mark
expect "blocked -> deny find_code" deny "$(gate find_code | dec)"
OUT="$(gate find_symbol)"
has "deny reason has return time" "until 20" "$OUT"
has "deny reason names codegraph_explore" codegraph_explore "$OUT"
expect "hookEventName PreToolUse" PreToolUse "$(printf '%s' "$OUT" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>console.log(JSON.parse(d).hookSpecificOutput.hookEventName))')"
for t in list_indexed_repositories get_repository_stats get_directory_tree fleet_status; do
  expect "unbilled $t allowed" allow "$(gate $t | dec)"
done
expect "escape hatch off -> allow" allow "$(GSD_MEMTRACE_QUOTA_GATE=off gate find_code | dec)"
expect "garbage stdin fails open" "" "$(echo '{{{' | node "$HERE/memtrace-quota-gate.cjs")"

node -e 'const f=process.env.MEMTRACE_QUOTA_STATE,s=JSON.parse(require("fs").readFileSync(f));s.probeAfter=Date.now()-1;require("fs").writeFileSync(f,JSON.stringify(s))'
expect "probe due -> first call allowed" allow "$(gate find_code | dec)"
expect "second call denied (probe serialized)" deny "$(gate find_code | dec)"
echo '{"blocked":true,"until":1,"probeAfter":0}' >"$MEMTRACE_QUOTA_STATE"
expect "expired cooldown -> allow" allow "$(gate find_code | dec)"
echo 'garbage' >"$MEMTRACE_QUOTA_STATE"
expect "corrupt state -> allow" allow "$(gate find_code | dec)"

echo; echo "$((N-F))/$N passed"; [ "$F" -eq 0 ]
