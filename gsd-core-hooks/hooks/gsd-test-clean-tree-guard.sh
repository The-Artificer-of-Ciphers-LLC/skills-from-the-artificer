#!/usr/bin/env bash
# PreToolUse(Bash) guard for gsd-test invocations. Three independent false-green
# traps, each verified against a real incident on 2026-07-17 (issue #2335 work):
#
#   1. DIRTY TREE — gsd-test is REF-BASED. It resolves --base/--head to SHAs and
#      shallow-clones + `git merge`s them (runner docs/architecture.md:27:
#      "refs … Converts --base and --head string refs to SHAs";
#      docs/troubleshooting.md:149: "constructs a PR-merged worktree by running a
#      real git merge of your current HEAD into the base branch"). Uncommitted
#      changes are NEVER tested. Incident: a failing-first test was edited into
#      the worktree, never committed, and the bench returned 25308/25308 PASS on
#      unmodified `next` — read as "the bug does not reproduce".
#
#   2. PIPE MASKS EXIT CODE — a pipeline exits with its LAST command's status, so
#      `gsd-test … | tail` exits 0 even when the verdict is `failed`. Incident: a
#      run with 5 real failures exited 0 through `| tail -12`. CLAUDE.md sanctions
#      gating on exit 0, so this converts a red suite into a green push.
#
#   3. IMPLICIT SHA — record-gsd-verdict.sh (PostToolUse) fires when the tool call
#      COMPLETES and binds the pass to `git rev-parse HEAD` AT RECORD TIME. For a
#      backgrounded run HEAD can advance between dispatch and completion.
#      Incident: a passing run of f1a91072 (unmodified `next`) was recorded
#      against 5bdb3cde9 — a commit whose suite FAILS with 5 failures. gsd-test
#      emits no resolved sha, so the sha must come from the invocation itself.
#      Requiring `--head <40-hex>` makes the tested commit explicit and parseable.
#
# The tool is correct in all three; the INVOCATION was wrong each time.
#
# Human-only override: prefix with GSD_HUMAN_OVERRIDE=1 (logged). The agent is
# FORBIDDEN by CLAUDE.md from ever emitting this token on its own initiative.
set -euo pipefail

input="$(cat)"
cmd="$(printf '%s' "$input" | jq -r '.tool_input.command // empty' 2>/dev/null || true)"
[ -z "$cmd" ] && exit 0

# Heredoc BODIES are data, not commands. Without stripping them, writing docs or
# fixtures that merely QUOTE an example (`cat > f <<EOF` … `gsd-test --head HEAD`
# … `EOF`) parses as a real invocation and is denied. A gate that blocks
# documentation is a gate that gets disabled. Keep the line bearing `<<WORD` —
# that line IS a real command.
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

# Match only a REAL invocation: a segment whose COMMAND WORD is gsd-test (after
# env assignments, optionally path-qualified). Deliberately stricter than
# record-gsd-verdict.sh's substring matcher — that one is record-only, so a false
# positive there exits harmlessly. This is a DENY gate: a substring match blocks
# any command merely MENTIONING gsd-test in a quoted string. Both false positives
# below actually fired during development.
gsd_test_seg=""
find_gsd_test_segment() {
  local seg
  while IFS= read -r seg || [ -n "$seg" ]; do
    seg="$(printf '%s' "$seg" | sed -E 's/^[[:space:]]+//; s/[[:space:]]+$//')"
    [ -z "$seg" ] && continue
    seg="$(printf '%s' "$seg" | sed -E 's/^([A-Za-z_][A-Za-z0-9_]*=[^[:space:]]*[[:space:]]+)+//')"
    if printf '%s' "$seg" | grep -Eq '^([^[:space:]]*/)?gsd-test([[:space:]]|$)'; then
      gsd_test_seg="$seg"
      return 0
    fi
  done < <(printf '%s' "$cmd_scan" | sed -E "s/'[^']*'/QQ/g; s/\"[^\"]*\"/QQ/g" | sed -E 's/&&/\n/g; s/\|\|/\n/g' | tr ';|&\n' '\n')
  return 1
}
find_gsd_test_segment || exit 0

# The gsd-test STATEMENT keeps its pipe. Segments above split on `|`, so
# gsd_test_seg never contains a pipe and can't tell `gsd-test | tail` (piped
# gsd-test — a hazard) from `git show|grep; gsd-test …` (a piped NEIGHBOR — not).
# Statements split on `;` `&&` `||` `&` but NOT `|`, so the gsd-test statement
# retains any pipe applied TO gsd-test, and Trap 2 can scope to it.
gsd_test_stmt=""
find_gsd_test_statement() {
  local stmt first
  while IFS= read -r stmt || [ -n "$stmt" ]; do
    stmt="$(printf '%s' "$stmt" | sed -E 's/^[[:space:]]+//; s/[[:space:]]+$//')"
    [ -z "$stmt" ] && continue
    first="$(printf '%s' "$stmt" | sed -E 's/^([A-Za-z_][A-Za-z0-9_]*=[^[:space:]]*[[:space:]]+)+//')"
    if printf '%s' "$first" | grep -Eq '^([^[:space:]]*/)?gsd-test([[:space:]]|$)'; then
      gsd_test_stmt="$stmt"
      return 0
    fi
  done < <(printf '%s' "$cmd_scan" | sed -E "s/'[^']*'/QQ/g; s/\"[^\"]*\"/QQ/g" | sed -E 's/&&/\n/g; s/\|\|/\n/g' | tr ';&' '\n')
  return 1
}
find_gsd_test_statement || true

repo_root="$(git rev-parse --show-toplevel 2>/dev/null || echo .)"

deny() {
  jq -n --arg r "$1" '{hookSpecificOutput:{hookEventName:"PreToolUse",permissionDecision:"deny",permissionDecisionReason:$r}}'
  exit 0
}

# Informational invocations run no tests and emit no verdict — no hazard applies.
# Scoped to the gsd-test SEGMENT, not the whole command line: whole-cmd matching
# let an unrelated `echo --version` elsewhere in a compound command exempt a REAL
# run (a hole in the gate). Trailing context accepts shell operators, so
# `gsd-test --version; grep …` is not wrongly denied.
if printf '%s' "$gsd_test_seg" | grep -Eq -- '(^|[[:space:]])(--version|--help|--probe-benches|-h)([^[:alnum:]_-]|$)'; then
  exit 0
fi

if printf '%s' "$cmd" | grep -q 'GSD_HUMAN_OVERRIDE=1'; then
  mkdir -p "$repo_root/.gsd"
  printf '%s  HUMAN_OVERRIDE gsd-test: %s\n' \
    "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$cmd" >> "$repo_root/.gsd/override.log"
  exit 0
fi

# ── Trap 2: pipe masks the exit code ─────────────────────────────────────────
# Scoped to the gsd-test STATEMENT: only a pipe applied to gsd-test masks ITS
# exit code. A piped neighbor (`git show|grep; gsd-test …`) is harmless and must
# not be denied. pipefail anywhere in the command restores the real status.
if printf '%s' "$gsd_test_stmt" | grep -q '|' && ! printf '%s' "$cmd_scan" | grep -q 'pipefail'; then
  deny "gsd-test BLOCKED — piping masks the exit code.

A pipeline exits with its LAST command's status, so \`gsd-test … | tail\` exits 0
even when the verdict is {\"outcome\":\"failed\"}. Verified: a run with 5 real
failures exited 0 through \`| tail -12\`. CLAUDE.md sanctions gating on exit 0, so
this silently converts a red suite into a green push.

Run it UNPIPED (the verdict is ONE line; failures print inline as they happen).
For a long run, detach it yourself and poll the artifact from disk -- NEVER
run_in_background:true (the harness clamps at 600000ms and kills the run
silently, with an empty log and no pass marker):
  nohup node .claude/hooks/gsd-verify-and-record.cjs --head <literal-40-hex> > <log> 2>&1 &
then poll .git/gsd-passes/<sha>.json for the marker, or the
\`{\"type\":\"verdict\"\` line in <log>.
If you must pipe, prefix \`set -o pipefail;\` so the real status survives.

Gate on the verdict's outcome:\"passed\" — never on a pipeline's exit code."
fi

# run/wait/submit are the run-and-die interface: different front door, no --head.
if printf '%s' "$gsd_test_seg" | grep -Eq '^([^[:space:]]*/)?gsd-test[[:space:]]+(run|wait|submit)([[:space:]]|$)'; then
  exit 0
fi

real_head="$(git -C "$repo_root" rev-parse HEAD 2>/dev/null || echo '?')"
given_sha="$(printf '%s' "$gsd_test_seg" | grep -Eo -- '--head[[:space:]=]+[0-9a-f]{40}' | grep -Eo '[0-9a-f]{40}' | head -n1 || true)"

# An explicit ref that is NOT current HEAD (a sha, or origin/main, a tag…) is a
# deliberate ref-vs-ref run: the working tree is irrelevant to it by
# construction, and the recorder binds the pass to that ref's sha — which, not
# being HEAD, cannot clear HEAD's push gate. Allow it.
if [ -n "$given_sha" ] && [ "$given_sha" != "$real_head" ]; then
  exit 0
fi
if printf '%s' "$gsd_test_seg" | grep -Eq -- '--head[[:space:]=]+' \
   && ! printf '%s' "$gsd_test_seg" | grep -Eq -- '--head[[:space:]=]+(HEAD|[0-9a-f]{40})([[:space:]]|$)'; then
  exit 0
fi

# ── Trap 3: the tested sha must be explicit ──────────────────────────────────
if [ -z "$given_sha" ]; then
  deny "gsd-test BLOCKED — name the tested commit EXPLICITLY as a full sha.

\`--head HEAD\` is resolved by gsd-test at DISPATCH, but record-gsd-verdict.sh
binds the verdict at COMPLETION using \`git rev-parse HEAD\` — for a backgrounded
run those are different commits, so the pass lands on code that was never tested.

This already happened (2026-07-17): a passing run of unmodified \`next\` was
recorded against 5bdb3cde9, a commit whose suite FAILS with 5 failures. The push
gate would have cleared it.

Run this (sha = current HEAD):
  gsd-test --base next --head $real_head

The recorder parses that sha and binds the verdict to exactly what ran."
fi

# ── Trap 1: dirty tree ───────────────────────────────────────────────────────
# Reached only when --head IS current HEAD: the agent intends this run to cover
# "my work". porcelain excludes .gitignore'd paths, so .gsd/ and scratch are fine.
dirty="$(git -C "$repo_root" status --porcelain 2>/dev/null || true)"
if [ -n "$dirty" ]; then
  deny "gsd-test BLOCKED — working tree is dirty, so this run would NOT test your changes.

gsd-test is ref-based: it resolves --head to a SHA and shallow-clones + merges it
(runner docs/architecture.md:27, docs/troubleshooting.md:149). Your uncommitted
edits are invisible to it. Running now tests $real_head and returns a green
verdict about code you did not write — a FALSE GREEN. This exact mistake made a
failing-first regression test report 25308/25308 PASS against unmodified \`next\`.

Uncommitted:
$dirty

Required: commit first, then re-run with the NEW sha as LITERAL 40-hex:
  git rev-parse HEAD                 # step 1 — get the new sha
  gsd-test --base next --head <paste-that-literal-40-hex-sha>
(--base/--head are the documented double-dash flags; base is \`next\`, not the
tool's \`main\` default. Classic executor, no subcommand. Do NOT write
\`--head \$(git rev-parse HEAD)\`: this hook and record-gsd-verdict.sh both match
raw COMMAND TEXT, never expanded argv, so a substitution is read as a non-HEAD
ref — it skips the dirty-tree check above AND records no pass, leaving the push
gate red after a full run.)

A failing-first test MUST be committed before the run that proves it red —
otherwise you are not proving anything.

(Human-only escape, never for the agent: re-issue prefixed with GSD_HUMAN_OVERRIDE=1 — it is logged.)"
fi

exit 0
