#!/usr/bin/env bash
# PreToolUse(Bash) guard: block launching a gsd-test / gsd-verify-and-record.cjs
# run when THIS WORKTREE already has one in flight. Launching a second run
# after amending the tree orphans the first run's local driver AND its bench
# containers, starving the shared benches.
#
# Detection preamble (set -euo pipefail through the deny() emitter) is copied
# VERBATIM from gsd-async-poll-guard.sh, which itself documents copying from
# gsd-test-clean-tree-guard.sh -- same convention.
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

# --- New logic: single-flight enforcement per worktree -----------------

# Anchored at the START of the args string: the process must actually BE a
# gsd-test / gsd-verify-and-record invocation, not merely a shell whose argv
# happens to quote one (the harness shell running this very command does).
live_re_for() {
  printf '%s' "^([^[:space:]]*/)?(gsd-test|node[[:space:]]+[^[:space:]]*gsd-verify-and-record(\.cjs)?)[[:space:]].*--head[[:space:]=]+$1([^0-9a-f]|\$)"
}

# A. Extract target sha from the masked command.
target_sha="$(printf '%s' "$cmd_masked" | grep -oE -- '--head[[:space:]=]+[0-9a-f]{40}' | head -1 | grep -oE '[0-9a-f]{40}' || true)"
[ -z "$target_sha" ] && exit 0

# B. Per-worktree state dir. Uses the per-worktree git-dir (for a linked
# worktree this is <common>/worktrees/<name>), NOT the common git dir, so
# parallel worktrees do not block each other -- that is intentional.
#
# The hook process cwd is NOT the launching worktree (it is often the main
# checkout), so the worktree comes from the hook payload .cwd and git runs with
# -C. Only when .cwd is absent or not a directory does this fall back to the
# hook process cwd.
payload_cwd="$(printf '%s' "$input" | jq -r '.cwd // empty' 2>/dev/null || true)"
git_dir=""
if [ -n "$payload_cwd" ] && [ -d "$payload_cwd" ]; then
  git_dir="$(git -C "$payload_cwd" rev-parse --absolute-git-dir 2>/dev/null || true)"
else
  git_dir="$(git rev-parse --git-dir 2>/dev/null || true)"
  [ -n "$git_dir" ] && git_dir="$(cd "$git_dir" && pwd)"
fi
[ -z "$git_dir" ] && exit 0
inflight="$git_dir/gsd-inflight"
mkdir -p "$inflight"

# Bench scoping. The bench set is re-read from the gsd-test config on EVERY
# invocation (never hard-coded) so a newly configured bench is guarded at once.
# Only name = "..." keys inside [[benches]] tables count. If the config yields
# no benches the wildcard sentinel is returned so an unreadable config
# conservatively blocks rather than failing open.
configured_benches() {
  local out
  out="$(awk '
    /^[[:space:]]*\[\[benches\]\]/ { inb=1; next }
    /^[[:space:]]*\[/ { inb=0; next }
    inb && /^[[:space:]]*name[[:space:]]*=/ {
      v=$0; sub(/^[^=]*=/, "", v); sub(/[[:space:]]*#.*$/, "", v)
      gsub(/["[:space:]]/, "", v)
      if (v != "") print v
    }' "$HOME/.config/gsd-test/config.toml" 2>/dev/null | sort -u || true)"
  if [ -z "$out" ]; then printf '*\n'; else printf '%s\n' "$out"; fi
}

# expand_benches SPEC: "*" (or empty) means every configured bench, else names.
expand_benches() {
  local spec="$1" out
  case " $spec " in
    *" * "*) configured_benches; return 0 ;;
  esac
  out="$(printf '%s' "$spec" | tr -s '[:space:]' '\n' | grep -v '^$' | sort -u || true)"
  if [ -z "$out" ]; then configured_benches; else printf '%s\n' "$out"; fi
}

# Requested bench spec: --bench NAME / --bench=NAME, comma-separated allowed.
# No --bench means the run fans out over all benches.
req_spec="$(printf '%s' "$cmd_masked" | grep -oE -- '--bench[[:space:]=]+[^[:space:]]+' \
  | sed -E 's/^--bench[[:space:]=]+//' | tr ',' ' ' | tr '\n' ' ' || true)"
req_spec="$(printf '%s' "$req_spec" | tr -s '[:space:]' ' ' | sed -E 's/^ +| +$//g' || true)"
[ -z "$req_spec" ] && req_spec="*"

# C. Liveness helper -- anchored match (see live_re_for above) means a process
# merely quoting/mentioning the sha (e.g. this very hook's own shell) never
# counts as live, so the bracket-trick self-match guard is no longer needed.
# `ps` output is captured to a variable FIRST, then grepped via a here-string
# -- piping `ps | grep -Eq` directly is unsafe under `set -o pipefail`: `-q`
# exits the moment it finds a match, SIGPIPEing `ps` mid-write, and pipefail
# then reports the pipeline's exit status as `ps`'s 141 rather than grep's 0,
# which callers (`! sha_is_live`) read as "not live" and wrongly prune a live
# marker. Capturing first drains `ps` before grep runs, so there is no pipe
# left open for it to be SIGPIPEd against.
sha_is_live() {
  local out
  out="$(ps -eo args= 2>/dev/null)"
  grep -Eq -- "$(live_re_for "$1")" <<<"$out"
}

# proc_bench_spec SHA: the bench spec a LIVE run for SHA was actually launched
# with, read from its process args (never from the marker file, which other
# sessions/versions write EMPTY). Unions every `--bench NAME` / `--bench=NAME`
# value (comma-separated allowed) across matching process lines. Prints nothing
# when the process has no --bench. `ps` is captured first, then grepped via a
# here-string (same pipefail/SIGPIPE convention as sha_is_live).
proc_bench_spec() {
  local out lines
  out="$(ps -eo args= 2>/dev/null)"
  lines="$(grep -E -- "$(live_re_for "$1")" <<<"$out" || true)"
  [ -z "$lines" ] && return 0
  grep -oE -- '--bench[[:space:]=]+[^[:space:]]+' <<<"$lines" \
    | sed -E 's/^--bench[[:space:]=]+//' | tr ',' ' ' | tr '\n' ' ' \
    | tr -s '[:space:]' ' ' | sed -E 's/^ +| +$//g' || true
}

# D. Prune dead markers.
if [ -d "$inflight" ]; then
  find "$inflight" -maxdepth 1 -type f | while IFS= read -r f; do
    sha="$(basename "$f")"
    if ! printf '%s' "$sha" | grep -Eq '^[0-9a-f]{40}$'; then
      rm -f "$f"
    elif ! sha_is_live "$sha"; then
      rm -f "$f"
    fi
  done
fi

# E. Decide based on remaining markers.
same_match=0
other_shas=""
conflict_benches=""
used_benches=""
req_list="$(expand_benches "$req_spec")"
for f in "$inflight"/*; do
  [ -e "$f" ] || continue
  sha="$(basename "$f")"
  # Live process args first (authoritative); else marker content; else empty,
  # which expands to every bench (a run with no --bench fans out over all).
  marker_spec="$(proc_bench_spec "$sha" || true)"
  [ -z "$marker_spec" ] && marker_spec="$(cat "$f" 2>/dev/null || true)"
  marker_list="$(expand_benches "$marker_spec")"
  used_benches="$used_benches
$marker_list"
  if [ "$sha" = "$target_sha" ]; then
    same_match=1
  else
    # A different sha only conflicts when the two runs share a bench.
    overlap="$(comm -12 <(printf '%s\n' "$req_list" | sort -u) <(printf '%s\n' "$marker_list" | sort -u) \
      | grep -v '^[[:space:]]*$' || true)"
    if [ -n "$overlap" ]; then
      other_shas="$other_shas $sha"
      conflict_benches="$conflict_benches
$overlap"
    fi
  fi
done
conflict_benches="$(printf '%s\n' "$conflict_benches" | grep -v '^[[:space:]]*$' | sort -u | tr '\n' ' ' || true)"
conflict_benches="${conflict_benches% }"
used_list="$(printf '%s\n' "$used_benches" | grep -v '^[[:space:]]*$' | sort -u || true)"
all_list="$(configured_benches)"
free_benches="$(comm -23 <(printf '%s\n' "$all_list" | sort -u) <(printf '%s\n' "$used_list" | sort -u) \
  | grep -v '^[[:space:]]*$' | grep -vx '\*' | tr '\n' ' ' || true)"
free_benches="${free_benches% }"

if [ "$same_match" -eq 1 ]; then
  # `|| true`: under `set -e` the command substitution inherits the while
  # loop's exit status, and the loop's last command is the per-line `grep -Eq`,
  # which fails on any final non-matching process line -- i.e. almost always.
  # Without it the guard EXITS 1 BEFORE emitting its deny, silently failing
  # OPEN on the exact path it exists to block. (Found 2026-08-08: bash -n
  # passed, runtime did not.)
  pids="$(ps -eo pid=,args= 2>/dev/null | while IFS= read -r line; do
    p="${line%% *}"; a="${line#* }"
    printf '%s' "$a" | grep -Eq -- "$(live_re_for "$target_sha")" && printf '%s ' "$p"
  done || true)"
  pids="${pids% }"
  deny "gsd-test-single-flight-guard BLOCKED — sha $target_sha is ALREADY in flight from
this worktree (pids: $pids).

Do not launch it twice. Poll the artifact instead:
  $git_dir/gsd-passes/$target_sha.json     (pass marker)
  or grep the run log for the \`{\"type\":\"verdict\"\` line.

(Human-only escape, never for the agent: re-issue prefixed with
GSD_HUMAN_OVERRIDE=1.)"
fi

if [ -n "$(printf '%s' "$other_shas" | tr -d '[:space:]')" ]; then
  if [ -n "$free_benches" ]; then
    free_line="free benches: $free_benches
Re-launch pinned to a free bench instead, e.g. --bench ${free_benches%% *}"
  else
    free_line="free benches: none"
  fi

  inflight_lines=""
  cleanup_lines=""
  for sha in $other_shas; do
    pids="$(ps -eo pid=,args= 2>/dev/null | while IFS= read -r line; do
      p="${line%% *}"; a="${line#* }"
      printf '%s' "$a" | grep -Eq -- "$(live_re_for "$sha")" && printf '%s ' "$p"
    done || true)"
    pids="${pids% }"
    inflight_lines="${inflight_lines}  in flight: $sha  (pids: $pids)
"
    cleanup_lines="${cleanup_lines}  kill $pids
  ssh <bench> \"docker ps -q --filter label=sh.gsd-test.branch=$sha | xargs -r docker rm -f\"
  rm $inflight/$sha
"
  done

  deny "gsd-test-single-flight-guard BLOCKED — this worktree already has a
gsd-test run IN FLIGHT for a different sha on an overlapping bench.

${inflight_lines}  requested: $target_sha  (bench: $req_spec)
conflicting benches: $conflict_benches
$free_line

gsd-test is the LAST action before push, not a mid-work checkpoint. It is
sha-bound, so amending the tree after launching abandons the run -- and
abandoning it does NOT clean it up: TaskStop kills only a polling loop, while
the nohup'd driver and BOTH bench containers keep running to completion and
starve the shared benches.

Finish the tree FIRST -- proofread the artifact, run the cheap gates (lint,
--check generators) -- and launch ONCE.

If you genuinely must abandon the in-flight run, clean it up explicitly:
${cleanup_lines}NEVER blanket-sweep containers -- the benches are shared and host prod workloads.

(Human-only escape, never for the agent: re-issue prefixed with
GSD_HUMAN_OVERRIDE=1.)"
fi

# F. No conflicting run -- mark this sha in flight and allow.
printf '%s\n' "$req_spec" > "$inflight/$target_sha"
exit 0
