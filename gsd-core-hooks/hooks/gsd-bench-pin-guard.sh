#!/usr/bin/env bash
# PreToolUse(Bash) guard: a gsd-test / gsd-verify-and-record.cjs dispatch that
# omits --bench silently lands on the FIRST bench in
# ~/.config/gsd-test/config.toml (holodeck). Every session that forgets the
# flag piles onto that same box while the other bench sits idle.
#
# Verified incidents:
#   (a) 2026-07-26 -- holodeck sat at 25-30 containers from ~12 concurrent
#       unpinned runs while another bench sat at 0. Install-suite tests are
#       pure filesystem work, and runInstall's execFileSync{timeout:60000}
#       throws ETIMEDOUT under that contention -- reported as REAL test
#       failures. The same commit passed cleanly on the other lane of that
#       same matrix run: the "failure" was queueing, not the code.
#   (b) 2026-08-09 -- sha 137a5ae8 queued 45+ minutes behind a five-deep
#       holodeck queue for what is normally a ~12-minute matrix, while plex2
#       sat idle the entire time. The agent had this exact rule written down
#       and still omitted --bench under load -- which is why it is now a
#       machine-enforced hook and not a note anyone can forget to reread.
#
# Rotation is holodeck and plex2 ONLY. cartographer was removed from rotation
# by user directive on 2026-08-02: at 4-core/7GB it runs a matrix in
# ~40-50min versus ~7-13min on the other two, and one run pinned there once
# spent 57 minutes before its containers even started.
#
# strip_heredocs / unwrap_dash_c / the open+chain+gsd_target+pos_pattern
# command-position detector, and the deny() JSON shape, are reused verbatim
# from gsd-async-poll-guard.sh so every guard in this family agrees on what
# counts as a real gsd-test/gsd-verify-and-record invocation.
#
# Deliberate DIFFERENCE from gsd-async-poll-guard.sh: this guard does NOT run
# mask_quotes. mask_quotes erases the CONTENTS of every quoted span, but the
# flag this hook greps for is routinely written `--bench "$BENCH"` or
# `--bench 'plex2'` -- masking would erase the bench name itself and produce
# a FALSE DENIAL of a command that is already correctly pinned. Since this
# hook only ever inspects text already known to be in command position (via
# pos_pattern), it does not need mask_quotes to avoid false-positives on
# unrelated quoted/path text the way the async-poll guard does.
set -euo pipefail

input="$(cat)"
cmd="$(printf '%s' "$input" | jq -r '.tool_input.command // empty' 2>/dev/null || true)"
[ -z "$cmd" ] && exit 0

# Heredoc BODIES are data, not commands -- a doc/fixture that merely QUOTES an
# example invocation must not be denied. Copied verbatim from
# gsd-async-poll-guard.sh / gsd-test-clean-tree-guard.sh.
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
# unquoted text sitting in command position right after `-c`. Copied verbatim
# from gsd-async-poll-guard.sh.
unwrap_dash_c() {
  printf '%s' "$1" \
    | sed -E 's/((bash|sh)[[:space:]]+-c[[:space:]]+)"([^"]*)"/\1\3/g' \
    | sed -E "s/((bash|sh)[[:space:]]+-c[[:space:]]+)'([^']*)'/\1\3/g"
}
cmd_unwrapped="$(unwrap_dash_c "$cmd_scan")"

# Command-POSITION detection, not substring detection -- copied verbatim from
# gsd-async-poll-guard.sh. Note we match against cmd_unwrapped, NOT a
# mask_quotes'd variant (see header comment for why mask_quotes is skipped
# here).
open='(^|[;&|{(!]|(^|[^[:alnum:]_-])(do|then|else|while|until))'
chain='((nohup|env|time|sudo|xargs)[[:space:]]+|node[[:space:]]+|(bash|sh)[[:space:]]+-c[[:space:]]+)*'
gsd_target='(gsd-test|gsd-verify-and-record(\.cjs)?)'
pos_pattern="${open}[[:space:]]*${chain}[\"']?[[:alnum:]_./-]*${gsd_target}([^[:alnum:]_-]|\$)"

is_invocation=0
if printf '%s' "$cmd_unwrapped" | grep -Eq "$pos_pattern"; then
  is_invocation=1
fi
[ "$is_invocation" -eq 1 ] || exit 0

deny() {
  jq -n --arg r "$1" '{hookSpecificOutput:{hookEventName:"PreToolUse",permissionDecision:"deny",permissionDecisionReason:$r}}'
  exit 0
}

# --dry-run is decision-only and burns no bench capacity -- let it through
# unpinned.
if printf '%s' "$cmd_unwrapped" | grep -Eq '(^|[[:space:]])--dry-run([[:space:]]|=|$)'; then
  exit 0
fi

# Accept --bench x / --bench=x / --bench "x" / --bench 'x'.
bench="$(printf '%s' "$cmd_unwrapped" | sed -nE "s/.*--bench[[:space:]=]+[\"']?([A-Za-z0-9_.-]+).*/\1/p" | head -1)"

if [ -z "$bench" ]; then
  deny "gsd-bench-pin-guard BLOCKED — this dispatches gsd-test /
gsd-verify-and-record.cjs with no --bench.

A bare run takes the FIRST bench in ~/.config/gsd-test/config.toml (holodeck).
Every session that omits the flag picks that same box, so runs stack on one
bench while the other sits idle. That is not just slow — under contention
install-class suites hit their 60s execFileSync ceiling and report ETIMEDOUT as
REAL test failures, making a verdict depend on who else is running.

Probe both, then pin the idle one:
  for b in plex2 holodeck; do printf \"%s: \" \$b; ssh \$b 'docker ps --format \"{{.Names}}\"|grep -c ^gsd-test-'; done

Then re-issue with the flag, e.g.:
  nohup node .claude/hooks/gsd-verify-and-record.cjs --head <literal-40-hex-sha> --bench <plex2|holodeck> > <log> 2>&1 &

Rotation is holodeck and plex2 ONLY. Pass --dry-run instead if you only want
the decision without burning bench capacity.

(Human-only escape, never for the agent: re-issue prefixed with
GSD_HUMAN_OVERRIDE=1.)"
fi

case "$bench" in
  holodeck|plex2) exit 0 ;;
esac

deny "gsd-bench-pin-guard BLOCKED — --bench '$bench' is not in the rotation.

Rotation is exactly holodeck (8-core/31GB) and plex2 (24-core/62GB).
cartographer was removed from rotation by user directive on 2026-08-02: at
4-core/7GB it runs a full matrix in ~40-50min versus ~7-13min on the other
two, and one run pinned there once spent 57 minutes before its containers
even started.

Probe both, then pin the idle one:
  for b in plex2 holodeck; do printf \"%s: \" \$b; ssh \$b 'docker ps --format \"{{.Names}}\"|grep -c ^gsd-test-'; done

Then re-issue with --bench plex2 or --bench holodeck.

(Human-only escape, never for the agent: re-issue prefixed with
GSD_HUMAN_OVERRIDE=1.)"
