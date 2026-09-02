#!/usr/bin/env bash
# PreToolUse(Bash) guard: a gsd-test / gsd-verify-and-record.cjs invocation is a
# LONG remote-runner dispatch. Running it through the Bash tool's own
# run_in_background:true or an explicit timeout is a false-green trap: the
# harness clamps at 600000ms and KILLS the process at that ceiling -- silently,
# leaving an EMPTY log and NO pass marker, not a visible failure.
#
# Verified incidents (2026-07-31): sha 6692ea63a dispatched with
# timeout:1200000 and sha 0a3c30c09 dispatched with timeout:1500000 were BOTH
# killed at the 600000ms harness ceiling before emitting a verdict line.
#
# Required form: detach the process yourself (nohup ... > <log> 2>&1 &) and
# poll the ARTIFACT from disk -- never the harness's background/timeout knobs:
#   nohup node .claude/hooks/gsd-verify-and-record.cjs --head <literal-40-hex> \
#     > <log> 2>&1 &
# then poll .git/gsd-passes/<sha>.json for the marker, or grep <log> for the
# `{"type":"verdict"` line.
#
# Human-only override: prefix with GSD_HUMAN_OVERRIDE=1 (logged, same
# convention as gsd-test-clean-tree-guard.sh). The agent is FORBIDDEN by
# CLAUDE.md from ever emitting this token on its own initiative.
set -euo pipefail

input="$(cat)"
cmd="$(printf '%s' "$input" | jq -r '.tool_input.command // empty' 2>/dev/null || true)"
[ -z "$cmd" ] && exit 0

# Heredoc BODIES are data, not commands -- a doc/fixture that merely QUOTES an
# example invocation must not be denied. Copied verbatim from
# gsd-test-clean-tree-guard.sh.
strip_heredocs() {
  printf '%s' "$1" | awk '
    BEGIN { delim="" }
    {
      if (delim != "") {
        line=$0; gsub(/^[ \t]+|[ \t]+$/, "", line)
        if (line == delim) delim=""
        next
      }
      if (match($0, /<<-?[ \t]*'\''?"?[A-Za-z_][A-Za-z0-9_]*'\''?"?/)) {
        d=substr($0, RSTART, RLENGTH)
        sub(/^<<-?[ \t]*/, "", d); gsub(/['\''"]/, "", d)
        delim=d
      }
      print
    }'
}
cmd_scan="$(strip_heredocs "$cmd")"

if printf '%s' "$cmd" | grep -q 'GSD_HUMAN_OVERRIDE=1'; then
  exit 0
fi

# Unwrap the literal quoted PAYLOAD of a `bash -c "..."` / `sh -c '...'`
# argument -- and ONLY that specific argument -- so its content becomes plain
# unquoted text sitting in command position right after `-c`. bash -c / sh -c
# executes its argument as a brand-new command line, so this is the one place
# a quoted string is genuinely live code, not inert data. This is the exact
# bypass a blanket "strip every quoted span" approach used to open: erasing
# the quotes AND the payload together let `bash -c "gsd-test --head <sha>"`
# slip through undetected. Unwrapping (not erasing) closes it.
unwrap_dash_c() {
  printf '%s' "$1" \
    | sed -E 's/((bash|sh)[[:space:]]+-c[[:space:]]+)"([^"]*)"/\1\3/g' \
    | sed -E "s/((bash|sh)[[:space:]]+-c[[:space:]]+)'([^']*)'/\1\3/g"
}
cmd_unwrapped="$(unwrap_dash_c "$cmd_scan")"

# Erase the CONTENTS of every remaining quoted span (both ' and ", handling
# `\"` escapes inside double-quoted spans so a JSON payload doesn't leave a
# dangling quote that swallows the rest of the line). By this point any live
# bash -c / sh -c payload has already been unwrapped above, so every quote
# left standing is genuinely inert data -- a grep pattern argument, a doc
# string, or a JSON fixture quoting a `gsd-test --head …` example as test
# data -- and erasing it prevents that data from being mistaken for a real
# command word.
mask_quotes() {
  printf '%s' "$1" | awk -v sq="'" '
    {
      s = $0; out = ""; n = length(s); i = 1; st = 0
      while (i <= n) {
        c = substr(s, i, 1)
        if (st == 0) {
          if (c == sq) { st = 1; i++ }
          else if (c == "\"") { st = 2; i++ }
          else { out = out c; i++ }
        } else if (st == 1) {
          if (c == sq) st = 0
          i++
        } else {
          if (c == "\\") i += 2
          else { if (c == "\"") st = 0; i++ }
        }
      }
      print out
    }'
}
cmd_masked="$(mask_quotes "$cmd_unwrapped")"

# Command-POSITION detection, not substring detection: `gsd-test` /
# `gsd-verify-and-record` only counts as an invocation when it occupies
# command position -- the first word of the command, or immediately
# following one of `;` `&` `|` `{` `(` `!` (single chars cover `&&`/`||` too,
# since a doubled operator is just two of the same char), the keywords
# `do`/`then`/`else`/`while`/`until`, or a launcher prefix (`nohup`, `env`,
# `time`, `node`, `sudo`, `xargs`, `bash -c`, `sh -c`, chainable). This is
# what lets `ls /path/to/gsd-test/runs` and `grep gsd-test somefile` through
# (the match is inside an argument/path, never command position) while still
# catching `bash -c "gsd-test …"` after the unwrap above.
open='(^|[;&|{(!]|(^|[^[:alnum:]_-])(do|then|else|while|until))'
chain='((nohup|env|time|sudo|xargs)[[:space:]]+|node[[:space:]]+|(bash|sh)[[:space:]]+-c[[:space:]]+)*'
gsd_target='(gsd-test|gsd-verify-and-record(\.cjs)?)'
pos_pattern="${open}[[:space:]]*${chain}[\"']?[[:alnum:]_./-]*${gsd_target}([^[:alnum:]_-]|\$)"

is_invocation=0
if printf '%s' "$cmd_masked" | grep -Eq "$pos_pattern"; then
  is_invocation=1
fi
[ "$is_invocation" -eq 1 ] || exit 0

deny() {
  jq -n --arg r "$1" '{hookSpecificOutput:{hookEventName:"PreToolUse",permissionDecision:"deny",permissionDecisionReason:$r}}'
  exit 0
}

run_in_bg="$(printf '%s' "$input" | jq -r '.tool_input.run_in_background // empty' 2>/dev/null || true)"
timeout_val="$(printf '%s' "$input" | jq -r 'if (.tool_input.timeout // null) == null then "" else (.tool_input.timeout|tostring) end' 2>/dev/null || true)"

has_nohup=0
printf '%s' "$cmd_masked" | grep -Eq '(^|[^[:alnum:]_-])nohup([^[:alnum:]_-]|$)' && has_nohup=1

# Trailing background `&` -- must be a REAL backgrounding operator, not `&&`.
has_bg_amp=0
if printf '%s' "$cmd_scan" | grep -Eq '[^&]&[[:space:]]*$'; then
  has_bg_amp=1
fi
if printf '%s' "$cmd_scan" | grep -Eq '^&[[:space:]]*$'; then
  has_bg_amp=1
fi

detached=0
[ "$has_nohup" -eq 1 ] && [ "$has_bg_amp" -eq 1 ] && detached=1

reason=""
if [ "$run_in_bg" = "true" ]; then
  reason="run_in_background:true"
elif [ -n "$timeout_val" ]; then
  reason="an explicit timeout (${timeout_val}ms)"
elif [ "$detached" -eq 0 ]; then
  reason="no nohup + trailing '&' detachment"
fi

[ -n "$reason" ] || exit 0

deny "gsd-async-poll-guard BLOCKED — this dispatches gsd-test or
gsd-verify-and-record.cjs with $reason.

The Bash tool's run_in_background/timeout machinery clamps at 600000ms and
KILLS the process at that ceiling -- silently, leaving an EMPTY log and NO
pass marker written, not a visible failure. This already happened twice on
2026-07-31: sha 6692ea63a (timeout:1200000) and sha 0a3c30c09
(timeout:1500000) were both killed at launch with zero verdict emitted.

Required form -- detach the process yourself and poll the artifact from disk:
  nohup node .claude/hooks/gsd-verify-and-record.cjs --head <literal-40-hex-sha> \\
    > <log> 2>&1 &

Then poll the ARTIFACT, never the harness's background/timeout flags:
  - .git/gsd-passes/<sha>.json for the marker, or
  - the \`{\"type\":\"verdict\"\` line inside <log>.

Do not pass run_in_background:true or timeout to Bash for this invocation.

(Human-only escape, never for the agent: re-issue prefixed with
GSD_HUMAN_OVERRIDE=1.)"
