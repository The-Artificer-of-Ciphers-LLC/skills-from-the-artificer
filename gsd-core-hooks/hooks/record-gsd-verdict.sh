#!/usr/bin/env bash
# PostToolUse(Bash) recorder.
#
# When a sanctioned gsd-test front door (`gsd-test run` / `wait` / `submit`)
# reports a PASSING verdict, bind that pass to the current HEAD sha in
# .gsd/last-pass.json. The push gate (pre-pr-gate.sh) reads this file.
#
# This is the ONLY sanctioned writer of the push-gate artifact. The verdict
# line is the documented source of truth (gsd-test-runner ADR-0023): the final
# stdout line is {"type":"verdict","outcome":"passed|failed|reaped|infra_error",...}
# and `outcome` matches the exit code. Only `passed` records; every other
# outcome leaves the previous artifact untouched (so a later failure cannot
# masquerade as a pass, and a stale pass is invalidated by the HEAD-sha check
# in the gate).
#
# Do NOT hand-write, edit, or fake .gsd/last-pass.json or gsd-passes/<sha>.json.
set -euo pipefail

input="$(cat)"
cmd="$(printf '%s' "$input" | jq -r '.tool_input.command // empty' 2>/dev/null || true)"
[ -z "$cmd" ] && exit 0

# Only react to sanctioned Docker executor front doors. Matches both the
# classic executor (`gsd-test` — the default per getting-started.md) and the
# run-and-die subcommands (`gsd-test run|wait|submit`). The trailing bracket
# accepts shell operators (>, |, ;, &) so redirected/piped invocations record.
printf '%s' "$cmd" | grep -Eq '(^|[^[:alnum:]_-])gsd-test([[:space:]]+(run|wait|submit))?([[:space:]]|$|[^[:alnum:]_-])' || exit 0

# Extract tool stdout. `-r` unescapes when .stdout exists; fall back to the raw
# response for other shapes.
out="$(printf '%s' "$input" | jq -r '(.tool_response.stdout? // (.tool_response | tostring)) // ""' 2>/dev/null || true)"
[ -z "$out" ] && exit 0

# Grab the last verdict line (tolerate escaped quotes in fallback shapes).
verdict="$(printf '%s' "$out" | grep -E 'type.{0,8}verdict' | tail -n1 || true)"
[ -z "$verdict" ] && exit 0

outcome="$(printf '%s' "$verdict" | sed -n 's/.*outcome[\\":]*\([a-z_][a-z_]*\).*/\1/p' | head -n1)"
[ "$outcome" = "passed" ] || exit 0

repo_root="$(git rev-parse --show-toplevel 2>/dev/null || echo .)"
# git COMMON dir is shared across linked worktrees; per-sha pass markers live
# under it so N branches verify + ship in parallel without a single-file race
# (mirrors pre-pr-gate.sh / gsd-verify-and-record.cjs).
common_dir="$(git rev-parse --git-common-dir 2>/dev/null || echo "$repo_root/.git")"
case "$common_dir" in /*) : ;; *) common_dir="$repo_root/$common_dir" ;; esac

# Bind the pass to the sha THAT WAS ACTUALLY TESTED — parsed from the command's
# explicit `--head <40-hex>` — never to `git rev-parse HEAD` at record time.
#
# WHY: this hook fires when the tool call COMPLETES. For a backgrounded run HEAD
# can advance between dispatch and completion, so record-time HEAD is not what
# was tested. On 2026-07-17 that wrote {"outcome":"passed","sha":"5bdb3cde9…"}
# from a run of f1a91072 (unmodified `next`) — asserting a pass for a commit
# whose suite FAILS with 5 failures. The push gate would have cleared untested
# code. gsd-test emits no resolved sha in its output, so the sha must come from
# the invocation itself; gsd-test-clean-tree-guard.sh (PreToolUse) enforces that
# an explicit --head sha is present and equals HEAD.
#
# Fail CLOSED: no explicit sha → record nothing. A missing artifact blocks the
# push (recoverable); a wrong artifact clears an untested push (not).
sha="$(printf '%s' "$cmd" | grep -Eo -- '--head[[:space:]=]+[0-9a-f]{40}' | grep -Eo '[0-9a-f]{40}' | head -n1)"
[ -z "$sha" ] && exit 0

# The tested sha must still be a real object in this repo.
git -C "$repo_root" cat-file -e "${sha}^{commit}" 2>/dev/null || exit 0

ts="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
record='{"outcome":"passed","sha":"'"$sha"'","recorded_at":"'"$ts"'"}'

# PRIMARY record: per-sha marker under the shared git-common dir. This is the
# race-free store the gate checks FIRST (pre-pr-gate.sh verdict_ok). Keyed by
# sha, so concurrent sessions/worktrees verifying different commits cannot
# clobber each other. gsd-verify-and-record.cjs writes the same shape to the
# same path — the two writers agree by construction.
passes_dir="$common_dir/gsd-passes"
mkdir -p "$passes_dir"
printf '%s\n' "$record" > "$passes_dir/$sha.json"

# Best-effort self-pruning of stale, non-live per-sha markers. Shares the one
# rule implementation with gsd-verify-and-record.cjs (see lib/prune-gsd-passes.cjs)
# so the two writers cannot drift. Must never fail this hook.
hook_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
node "$hook_dir/lib/prune-gsd-passes.cjs" "$passes_dir" "$repo_root" >/dev/null 2>&1 || true

# LEGACY record: the single-file .gsd/last-pass.json. Kept for backward
# compatibility with older gate readers and for human inspection, but it is NO
# LONGER load-bearing — the per-sha marker above is the source of truth. A
# concurrent session verifying a different commit may overwrite this file; that
# is harmless because the gate resolves the shipped sha and checks that sha's
# own marker first.
mkdir -p "$repo_root/.gsd"
printf '%s\n' "$record" > "$repo_root/.gsd/last-pass.json"
exit 0
