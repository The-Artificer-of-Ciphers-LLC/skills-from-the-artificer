#!/usr/bin/env bash
# Behavioral suite for memtrace-quota-state.cjs (until rules, reasons, cooldownInfo, probes).
#   bash claude-guards/hooks/memtrace-quota-state.test.sh
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
js() { node -e "const q=require('$HERE/memtrace-quota-state.cjs');$1"; }
st() { node -e "const s=JSON.parse(require('fs').readFileSync('$MEMTRACE_QUOTA_STATE','utf8'));console.log($1)"; }
mark() { js "q.markBlocked($1)"; }
MONTH='{"error":"quota_exceeded","message":"Monthly query limit reached (21806)","quota":{"blocked":true,"monthlyLimit":20000,"monthlyUsed":21841,"periodEnd":"2099-01-01T00:00:00.000Z","plan":"pro_plus","throttleMode":false,"upgradeUrl":"https://www.memtrace.io/pricing"}}'
DAILY='{"error":"quota_exceeded","message":"Daily query limit reached (50)","quota":{"blocked":true,"periodEnd":"2099-01-01T00:00:00.000Z","throttleMode":true}}'

expect "no state -> not blocked" false "$(js 'console.log(q.isBlocked())')"
expect "no state -> cooldownInfo null" null "$(js 'console.log(JSON.stringify(q.cooldownInfo()))')"

mark "$MONTH"
expect "monthly reason" monthly "$(st s.reason)"
expect "monthly untilSource periodEnd" periodEnd "$(st s.untilSource)"
expect "monthly until capped at 24h" true "$(st 's.until-Date.now()<=24*3600e3+5000&&s.until-Date.now()>23*3600e3')"
expect "plan stored" pro_plus "$(st s.plan)"
expect "upgradeUrl stored" https://www.memtrace.io/pricing "$(st s.upgradeUrl)"
expect "monthlyUsed stored" 21841 "$(st s.monthlyUsed)"
expect "monthlyLimit stored" 20000 "$(st s.monthlyLimit)"
expect "isBlocked true" true "$(js 'console.log(q.isBlocked())')"
expect "cooldownInfo shape" "monthly:periodEnd:true" "$(js 'const c=q.cooldownInfo();console.log(c.reason+":"+c.untilSource+":"+(Number.isInteger(c.minutesLeft)&&c.untilIso.endsWith("Z")))')"
has "codegraphRoute has return time + codegraph_explore" "until 20" "$(js 'console.log(q.codegraphRoute())')"
has "codegraphRoute names codegraph_explore" codegraph_explore "$(js 'console.log(q.codegraphRoute())')"
has "CODEGRAPH_ROUTE still exported" Memtrace "$(js 'console.log(q.CODEGRAPH_ROUTE)')"

mark "$DAILY"
expect "daily reason" daily "$(st s.reason)"
expect "daily untilSource nextUtcMidnight" nextUtcMidnight "$(st s.untilSource)"
expect "daily until = next UTC midnight" true "$(st 'new Date(s.until).getUTCHours()===0&&s.until>Date.now()&&s.until-Date.now()<=24*3600e3')"

mark '"Authentication expired. Run memtrace auth login"'
expect "auth reason" auth "$(st s.reason)"
expect "auth ~5 min" true "$(st 's.until-Date.now()<=5*60e3+5000&&s.until-Date.now()>4*60e3')"
mark '"connect ECONNREFUSED 127.0.0.1:3030"'
expect "unreachable reason" unreachable "$(st s.reason)"

mark '{"error":"quota_exceeded","message":"Monthly query limit reached (1)"}'
expect "no periodEnd -> fallback 1h" fallback "$(st s.untilSource)"
expect "fallback ~1h" true "$(st 's.until-Date.now()>55*60e3&&s.until-Date.now()<=3600e3+5000')"

LONG="$(node -e 'console.log(JSON.stringify({results:"x".repeat(700)+" Authentication expired unreachable"}))')"
expect "long result mentioning auth is not a block" null "$(js "console.log(q.blockReasonOf($LONG))")"

# probes
mark "$MONTH"
expect "fresh cooldown: probe not due" false "$(js 'console.log(q.probeDue())')"
expect "claimProbe refuses when not due" false "$(js 'console.log(q.claimProbe())')"
js 'const f=process.env.MEMTRACE_QUOTA_STATE,s=JSON.parse(require("fs").readFileSync(f));s.probeAfter=Date.now()-1;require("fs").writeFileSync(f,JSON.stringify(s))'
expect "probeAfter past -> probeDue" true "$(js 'console.log(q.probeDue())')"
R="$( (js 'console.log("a"+q.claimProbe())' & js 'console.log("b"+q.claimProbe())' & wait) | sort | tr -d '\n')"
expect "concurrent claim: exactly one winner" 1 "$(printf '%s' "$R" | grep -o true | wc -l | tr -d ' ')"
expect "claim bumped probes" 1 "$(st s.probes)"
expect "after claim probe not due" false "$(js 'console.log(q.probeDue())')"
expect "after claim still blocked" true "$(js 'console.log(q.isBlocked())')"
mark "$MONTH"
expect "failed probe re-mark keeps probes" 1 "$(st s.probes)"
js 'q.clearBlocked()'
expect "clearBlocked -> not blocked" false "$(js 'console.log(q.isBlocked())')"
expect "expired state -> probeDue false" false "$(echo '{"blocked":true,"until":1,"probeAfter":0}' >"$MEMTRACE_QUOTA_STATE"; js 'console.log(q.probeDue())')"
expect "corrupt state fails open" false "$(echo 'garbage' >"$MEMTRACE_QUOTA_STATE"; js 'console.log(q.isBlocked())')"

echo; echo "$((N-F))/$N passed"; [ "$F" -eq 0 ]
