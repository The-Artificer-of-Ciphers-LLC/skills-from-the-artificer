#!/usr/bin/env bash
# PreToolUse(Bash|Monitor) guard: a `pgrep -f "<cmd> <args>"` wait-loop matches
# its OWN command line -- the waiter's argv literally CONTAINS the pattern it
# is grepping for -- so the pgrep never stops matching and the loop never
# terminates, even after the watched job has long since finished.
#
# Verified incident: a waiter on `gsd-verify-and-record.cjs --head 98fb7aad5`
# never exited because its own argv contained that exact string; the pass
# marker had been written minutes earlier and the loop just spun forever.
#
# Required alternative: poll the ARTIFACT, never the process --
#   loop on `[ -f <marker-file> ]`, or
#   `grep -qE '"type":"verdict"' <log>`
# and bound the iteration count so the watcher itself terminates even if the
# artifact never appears.
#
# Both Bash and Monitor tool_input carry the command under the same key,
# `.tool_input.command` -- confirmed against this rule's own test fixture
# (a Monitor call shaped identically to the Bash one). If a future Monitor
# schema moves the command elsewhere, this script needs a matching update.
#
# Human-only override: prefix with GSD_HUMAN_OVERRIDE=1 (logged, same
# convention as gsd-test-clean-tree-guard.sh).
set -euo pipefail

input="$(cat)"
cmd="$(printf '%s' "$input" | jq -r '.tool_input.command // empty' 2>/dev/null || true)"
[ -z "$cmd" ] && exit 0

# Heredoc BODIES are data, not commands -- a doc/fixture that merely QUOTES an
# example pgrep waiter must not be denied. Copied verbatim from
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
# JSON payload quoting `pgrep`/`while`/`sleep` as test input (e.g. `printf
# '%s' '{"tool_input":{"command":"while pgrep ... do ... done"}}' |
# this-guard.sh`) is a self-test, not a waiter -- and critically, keywords
# like `while`/`do` only need a non-alnum char (a `"` or `:` is enough) to
# their left to look like command position, so leaving JSON quoting
# unmasked lets a fixture's embedded `while pgrep ...` false-positive. By
# this point any live bash -c / sh -c payload has already been unwrapped
# above, so every quote left standing is genuinely inert data.
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

if printf '%s' "$cmd" | grep -q 'GSD_HUMAN_OVERRIDE=1'; then
  exit 0
fi

# Command-POSITION detection, not substring detection: `pgrep`/loop-keyword/
# `sleep` only count when they occupy command position -- the first word of
# the command, or immediately following one of `;` `&` `|` `{` `(` `!`
# (single chars cover `&&`/`||` too), the keywords `do`/`then`/`else`/
# `while`/`until`, or a launcher prefix (`nohup`, `env`, `time`, `node`,
# `sudo`, `xargs`, `bash -c`, `sh -c`, chainable). This is what lets
# `grep '[g]sd-test'` and `ps -ax -o pid,command | grep '[g]sd-test'` through
# (their `pgrep`-shaped text, if any, sits inside a grep pattern argument,
# never command position).
open='(^|[;&|{(!]|(^|[^[:alnum:]_-])(do|then|else|while|until))'
chain='((nohup|env|time|sudo|xargs)[[:space:]]+|node[[:space:]]+|(bash|sh)[[:space:]]+-c[[:space:]]+)*'
pos_pattern() {
  printf '%s[[:space:]]*%s["'"'"']?[[:alnum:]_./-]*%s([^[:alnum:]_-]|$)' "$open" "$chain" "$1"
}

has_pgrep=0
printf '%s' "$cmd_detect" | grep -Eq "$(pos_pattern 'pgrep')" && has_pgrep=1

has_loop=0
if printf '%s' "$cmd_detect" | grep -Eq "$(pos_pattern '(while|until|for|seq)')"; then
  has_loop=1
fi

has_sleep=0
printf '%s' "$cmd_detect" | grep -Eq "$(pos_pattern 'sleep')" && has_sleep=1

if [ "$has_pgrep" -eq 1 ] && [ "$has_loop" -eq 1 ] && [ "$has_sleep" -eq 1 ]; then
  jq -n --arg r "gsd-pgrep-waiter-guard BLOCKED — this loops on \`pgrep\`
combined with a loop construct and \`sleep\` -- the SELF-MATCH trap.

A waiter's own argv contains the very pattern it greps for
(\`pgrep -f \"gsd-verify-and-record.cjs --head <sha>\"\`), so the process ALWAYS
matches its own command line and the loop NEVER terminates. Verified incident:
a waiter on \`gsd-verify-and-record.cjs --head 98fb7aad5\` spun forever even
though the pass marker had been written minutes earlier -- the watched job was
long done, the waiter never noticed.

Required alternative -- poll the ARTIFACT, never the process, and never a
foreground \`sleep\`-based loop (the Bash tool kills those at its 600000ms
ceiling with exit 137, indistinguishable from the watched job failing):
  - MANY notifications, or one-per-event until a known end: use the
    Monitor tool with a command that emits a line per event and exits
    when done.
  - ONE notification when a condition becomes true: use Bash with
    run_in_background:true and
      until [ -f .git/gsd-passes/<sha>.json ] || grep -qE '\"type\":\"verdict\"' <log>; do
        sleep 30
      done
    -- the harness notifies you once the backgrounded command exits.

(Human-only escape, never for the agent: re-issue prefixed with
GSD_HUMAN_OVERRIDE=1.)" '{hookSpecificOutput:{hookEventName:"PreToolUse",permissionDecision:"deny",permissionDecisionReason:$r}}'
  exit 0
fi

exit 0
