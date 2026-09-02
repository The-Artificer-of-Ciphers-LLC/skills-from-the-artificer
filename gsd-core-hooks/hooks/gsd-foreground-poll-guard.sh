#!/usr/bin/env bash
# PreToolUse(Bash) guard: a FOREGROUND poll loop -- `while`/`until`/`for` combined
# with a command-position `sleep >= 10s` -- is killed at the Bash tool's hard
# 600000ms ceiling with exit 137. That kill is INDISTINGUISHABLE from the
# watched job failing: the process dies mid-wait on anything slower than 10
# minutes, and nothing in the output says "the ceiling hit", only that the
# command exited nonzero.
#
# Observed 2026-08-06/07: six consecutive foreground pollers watching
# `gsd-verify-and-record.cjs` runs were killed at the ceiling while the runs
# themselves were fine -- only the watchers died. From the outside this reads
# as "you just sit here stupidly waiting for a poll that will never come
# back."
#
# Required alternative:
#   - MANY notifications, or one-per-event until a known end: use the
#     Monitor tool with a command that emits a line per event and exits when
#     done.
#   - ONE notification when a condition becomes true: use Bash with
#     run_in_background:true and `until <cond>; do sleep 30; done` -- the
#     harness notifies you once the backgrounded command exits, so the 600s
#     ceiling never applies to YOUR foreground turn.
#
# Human-only override: prefix with GSD_HUMAN_OVERRIDE=1 (logged, same
# convention as the sibling guards).
#
# Registered for Bash ONLY -- never for Monitor. A Monitor command
# legitimately contains `while true; do ... sleep 45; done` (that IS the
# sanctioned long-lived polling form); blocking it there would defeat the
# entire remedy this guard exists to enforce.
set -euo pipefail

input="$(cat)"
cmd="$(printf '%s' "$input" | jq -r '.tool_input.command // empty' 2>/dev/null || true)"
[ -z "$cmd" ] && exit 0

# Sanctioned single-notification form: run_in_background:true means the
# harness itself notifies on completion, so the 600s foreground ceiling
# never applies -- allow unconditionally.
run_in_bg="$(printf '%s' "$input" | jq -r '.tool_input.run_in_background // empty' 2>/dev/null || true)"
[ "$run_in_bg" = "true" ] && exit 0

# Heredoc BODIES are data, not commands -- a doc/fixture that merely QUOTES an
# example poll loop must not be denied. Copied verbatim from
# gsd-pgrep-waiter-guard.sh.
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
# a quoted string is genuinely live code, not inert data.
unwrap_dash_c() {
  printf '%s' "$1" \
    | sed -E 's/((bash|sh)[[:space:]]+-c[[:space:]]+)"([^"]*)"/\1\3/g' \
    | sed -E "s/((bash|sh)[[:space:]]+-c[[:space:]]+)'([^']*)'/\1\3/g"
}
cmd_unwrapped="$(unwrap_dash_c "$cmd_scan")"

# Erase the CONTENTS of every remaining quoted span (both ' and ", handling
# `\"` escapes inside double-quoted spans so a JSON payload doesn't leave a
# dangling quote that swallows the rest of the line). A fixture that PIPES a
# JSON payload quoting `while`/`sleep` as test input is a self-test, not a
# poller -- and critically, keywords like `while`/`do` only need a non-alnum
# char (a `"` or `:` is enough) to their left to look like command position,
# so leaving JSON quoting unmasked lets a fixture's embedded `while ... do`
# false-positive. By this point any live bash -c / sh -c payload has already
# been unwrapped above, so every quote left standing is genuinely inert data.
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
cmd_detect="$(mask_quotes "$cmd_unwrapped")"

# Command-POSITION detection, not substring detection: reused verbatim from
# gsd-pgrep-waiter-guard.sh -- a loop keyword / `sleep` only counts when it
# occupies command position -- the first word of the command, or immediately
# following one of `;` `&` `|` `{` `(` `!` (single chars cover `&&`/`||` too),
# the keywords `do`/`then`/`else`/`while`/`until`, or a launcher prefix
# (`nohup`, `env`, `time`, `node`, `sudo`, `xargs`, `bash -c`, `sh -c`,
# chainable).
open='(^|[;&|{(!]|(^|[^[:alnum:]_-])(do|then|else|while|until))'
chain='((nohup|env|time|sudo|xargs)[[:space:]]+|node[[:space:]]+|(bash|sh)[[:space:]]+-c[[:space:]]+)*'
pos_pattern() {
  printf '%s[[:space:]]*%s["'"'"']?[[:alnum:]_./-]*%s([^[:alnum:]_-]|$)' "$open" "$chain" "$1"
}

has_loop=0
printf '%s' "$cmd_detect" | grep -Eq "$(pos_pattern '(while|until|for)')" && has_loop=1

has_sleep=0
printf '%s' "$cmd_detect" | grep -Eq "$(pos_pattern 'sleep')" && has_sleep=1

[ "$has_loop" -eq 1 ] && [ "$has_sleep" -eq 1 ] || exit 0

# Extract the numeric argument of every command-position `sleep`. A
# non-numeric/variable interval (e.g. `sleep "$n"`, which mask_quotes above
# erases entirely, or `sleep $n`, which is left as a literal `$n`) is treated
# as >= 10 -- conservative, since we cannot know its runtime value.
sleep_call="${open}[[:space:]]*${chain}sleep[[:space:]]+[^;&|)}]*"
has_slow_sleep=0
while IFS= read -r match; do
  [ -z "$match" ] && continue
  arg="$(printf '%s' "$match" | sed -E 's/.*sleep[[:space:]]+//' | awk '{print $1}')"
  if printf '%s' "$arg" | grep -Eq '^[0-9]+$'; then
    [ "$arg" -ge 10 ] && has_slow_sleep=1
  else
    # empty (quoted-away) or non-numeric/variable -- conservative >= 10
    has_slow_sleep=1
  fi
done <<EOF
$(printf '%s' "$cmd_detect" | grep -Eo "$sleep_call" || true)
EOF

[ "$has_slow_sleep" -eq 1 ] || exit 0

jq -n --arg r "gsd-foreground-poll-guard BLOCKED — this is a FOREGROUND poll
loop (a \`while\`/\`until\`/\`for\` construct combined with \`sleep >= 10s\`).

The Bash tool hard-caps at 600000ms and KILLS the process at that ceiling with
exit 137. A foreground poll loop like this ALWAYS dies mid-wait on anything
slower than 10 minutes, and the kill is INDISTINGUISHABLE from the watched
job actually failing. Observed 2026-08-06/07: six consecutive foreground
pollers watching \`gsd-verify-and-record.cjs\` runs were killed at the
ceiling while the runs themselves were fine -- only the watchers died.

Required alternative:
  - MANY notifications, or one-per-event until a known end: use the
    Monitor tool with a command that emits a line per event and exits
    when done.
  - ONE notification when a condition becomes true: use Bash with
    run_in_background:true and a loop like
      until <cond>; do sleep 30; done
    -- the harness notifies you once the backgrounded command exits, so
    the 600s ceiling never applies to your foreground turn.

(Human-only escape, never for the agent: re-issue prefixed with
GSD_HUMAN_OVERRIDE=1.)" '{hookSpecificOutput:{hookEventName:"PreToolUse",permissionDecision:"deny",permissionDecisionReason:$r}}'
exit 0
