#!/usr/bin/env bash
# PreToolUse(Bash) gate — hard-deny LOCAL test execution.
#
# CLAUDE.md (ABSOLUTE): "NEVER run `node --test` locally. A spawned-local
# `node --test` (--test-timeout=Infinity, one child per file) orphans the
# workstation when a test leaks a handle and leaves container/mirror relics.
# Drive tests through gsd-test instead."
#
# CLAUDE.md asserts this hook exists and is machine-enforced. Until 2026-07-17
# it did not exist and was registered nowhere — the protection was documented
# but imaginary. This file closes that gap.
#
# Tests are AUTHORED with the node:test API; they are EXECUTED only via
# `gsd-test` (classic executor, no subcommand), which runs them in a disposable,
# reaped, ephemeral container on a Bench with full (OS × Node) fan-out.
#
# Human-only override: prefix with GSD_HUMAN_OVERRIDE=1 (logged). The agent is
# FORBIDDEN by CLAUDE.md from ever emitting this token on its own initiative.
set -euo pipefail

input="$(cat)"
cmd="$(printf '%s' "$input" | jq -r '.tool_input.command // empty' 2>/dev/null || true)"
[ -z "$cmd" ] && exit 0

repo_root="$(git rev-parse --show-toplevel 2>/dev/null || echo .)"

deny() {
  jq -n --arg r "$1" '{hookSpecificOutput:{hookEventName:"PreToolUse",permissionDecision:"deny",permissionDecisionReason:$r}}'
  exit 0
}

if printf '%s' "$cmd" | grep -q 'GSD_HUMAN_OVERRIDE=1'; then
  mkdir -p "$repo_root/.gsd"
  printf '%s  HUMAN_OVERRIDE local-test: %s\n' \
    "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$cmd" >> "$repo_root/.gsd/override.log"
  exit 0
fi

# Split on shell operators so a chained/backgrounded segment can't smuggle a
# local run past the matcher (`git status && node --test`).
matched=""
while IFS= read -r seg || [ -n "$seg" ]; do
  seg="$(printf '%s' "$seg" | sed -E 's/^[[:space:]]+//; s/[[:space:]]+$//')"
  [ -z "$seg" ] && continue
  # Strip leading env assignments (FOO=1 node --test).
  seg="$(printf '%s' "$seg" | sed -E 's/^([A-Za-z_][A-Za-z0-9_]*=[^[:space:]]*[[:space:]]+)+//')"

  # Every matcher below is ANCHORED to the segment's COMMAND WORD (^), never a
  # substring. A substring match denies any command that merely MENTIONS the
  # phrase in a quoted string — `echo "never run node --test"`, a grep pattern,
  # a heredoc. That is not theoretical: the substring form of this matcher
  # blocked an `echo` describing the rule, and the sibling clean-tree guard hit
  # the identical bug. Anchoring keeps the block exact.
  # `gsd-test` cannot match: its command word is `gsd-test`, not node/npm/npx.

  # 1) node --test (incl. --test-only/--test-timeout/--test-reporter...).
  if printf '%s' "$seg" | grep -Eq '^([^[:space:]]*/)?(npx[[:space:]]+)?node([[:space:]]+-[^[:space:]]+)*[[:space:]]+--test([[:space:]=-]|$)'; then
    matched="node --test"; break
  fi

  # 2) npm/pnpm/yarn test | npm run test[:*] | npm t
  #    `npm run lint`, `npm run build`, `npm run changeset` stay allowed.
  if printf '%s' "$seg" | grep -Eq '^([^[:space:]]*/)?(npm|pnpm|yarn)([[:space:]]+run)?[[:space:]]+test([:@[:space:]]|$)'; then
    matched="$(printf '%s' "$seg" | grep -Eo '^([^[:space:]]*/)?(npm|pnpm|yarn)([[:space:]]+run)?[[:space:]]+test[^[:space:]]*' | head -n1)"; break
  fi
  if printf '%s' "$seg" | grep -Eq '^([^[:space:]]*/)?npm[[:space:]]+t([[:space:]]|$)'; then
    matched="npm t"; break
  fi
# Replace quoted spans with QQ BEFORE tokenizing. The operator split breaks on
# `|`, which does not respect quoting, so a pipe INSIDE a quoted argument used to
# start a new segment whose command word could be the banned phrase even though
# nothing of the sort was ever invoked. That defeated the ^ anchors above and
# blocked ordinary work -- on 2026-07-26 a plain ripgrep whose PATTERN contained
# the phrase was denied, as was the very patch fixing this. A REAL local
# invocation is never quoted, so detection strength is unchanged.
#
# KEEP THE PROCESS SUBSTITUTION ON ONE LINE WITH NO COMMENTS INSIDE IT. A comment
# holding an unmatched apostrophe inside < <( ... ) breaks parsing at RUNTIME with
# "bad substitution" while `bash -n` still PASSES -- that silently took this whole
# gate DOWN on 2026-07-26 (every command allowed, real invocations included).
done < <(printf '%s' "$cmd" | sed -E "s/'[^']*'/QQ/g; s/\"[^\"]*\"/QQ/g" | sed -E 's/&&/\n/g; s/\|\|/\n/g' | tr ';|&\n' '\n')

[ -z "$matched" ] && exit 0

deny "LOCAL TEST EXECUTION BLOCKED — \`$matched\`

CLAUDE.md (ABSOLUTE): NEVER run \`node --test\` / \`npm test\` / \`npm run test\`
locally. A spawned-local run (--test-timeout=Infinity, one child per file)
ORPHANS THE WORKSTATION when a test leaks a handle, and leaves container/mirror
relics behind.

Tests are AUTHORED with node:test but EXECUTED only via gsd-test, which runs
them in a disposable, reaped, ephemeral container with full (OS × Node) fan-out:

  git rev-parse HEAD                 # step 1 -- get the sha
  gsd-test --base next --head <paste-that-literal-40-hex-sha>

The sha MUST be literal 40-hex. \`--head HEAD\` is DENIED by the clean-tree
guard, and \`--head \$(git rev-parse HEAD)\` is worse: both hooks match the raw
COMMAND TEXT, never expanded argv, so a substitution reads as a non-HEAD ref
(skipping the dirty-tree check) while record-gsd-verdict.sh finds no 40-hex and
fails closed -- the run burns minutes and the push gate is still red after it.

Commit first — gsd-test is ref-based and never reads your working tree, so an
uncommitted change tests nothing (see gsd-test-clean-tree-guard.sh). Run it
UNPIPED and gate on the verdict line's outcome:\"passed\", not on a pipeline's
exit code.

This gate is not substitutable. If gsd-test is slow, red, or erroring: HALT and
surface it — do NOT fall back to local tests (CLAUDE.md HALT-ON-RED).

(Human-only escape, never for the agent: re-issue prefixed with GSD_HUMAN_OVERRIDE=1 — it is logged.)"
