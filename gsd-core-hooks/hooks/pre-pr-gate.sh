#!/usr/bin/env bash
# PreToolUse(Bash) gate — machine-enforced. Cannot be satisfied by prose,
# intent, or assertion; only by an actual passing gsd-test run on THIS commit.
#
#   1) git push
#        HARD-BLOCK unless .gsd/last-pass.json records outcome:"passed" for the
#        current HEAD sha (written by record-gsd-verdict.sh from a real gsd-test
#        verdict line). CLAUDE.md: `gsd-test` MUST exit 0 before ANY git push —
#        ABSOLUTE, non-substitutable.
#
#   2) gh pr create/edit/ready/merge  (on OUR OWN PRs only)
#        Requires the same passing verdict AND the pre-PR review gates
#        (GSD_PR_GATES_OK=1). Exempt when the command names a PR authored by
#        somebody else - reviewing/merging a submitted, already-CI-green
#        contributor PR is not this gate's business. Fail-closed on any doubt.
#
# Human-only override for the push block: prefix the command with
# GSD_HUMAN_OVERRIDE=1. The agent is FORBIDDEN by CLAUDE.md from ever emitting
# this token. Every use is appended to .gsd/override.log.
set -euo pipefail

input="$(cat)"
cmd="$(printf '%s' "$input" | jq -r '.tool_input.command // empty' 2>/dev/null || true)"
[ -z "$cmd" ] && exit 0

repo_root="$(git rev-parse --show-toplevel 2>/dev/null || echo .)"
# git COMMON dir is shared across linked worktrees; per-sha pass markers live
# under it so N branches verify + ship in parallel without a single-file race.
common_dir="$(git rev-parse --git-common-dir 2>/dev/null || echo "$repo_root/.git")"
# `--git-common-dir` returns a path relative to the CURRENT WORKING DIRECTORY,
# not to repo_root. Joining it to repo_root produced garbage whenever this hook
# ran from a subdirectory: cwd 3 levels deep yields `../../../.git`, which became
# `<repo_root>/../../../.git` -> `/Users/.git`. The per-sha marker was then never
# found, the gate fell through to the stale legacy `.gsd/last-pass.json`, and a
# legitimately-verified push was denied. It only ever worked from the repo root,
# where git happens to return a bare `.git`. Resolve against cwd instead.
case "$common_dir" in
  /*) : ;;
  *) common_dir="$(cd "$common_dir" 2>/dev/null && pwd || echo "$repo_root/.git")" ;;
esac

deny() {
  jq -n --arg r "$1" '{hookSpecificOutput:{hookEventName:"PreToolUse",permissionDecision:"deny",permissionDecisionReason:$r}}'
  exit 0
}

# The sha this command actually ships = HEAD of the worktree it runs in. A cheap
# agent ships a branch from that branch's own worktree with a leading
# `cd <dir> && …`; honor that dir, else fall back to the session worktree. This
# is what lets a non-foreground agent record + ship without tying up the primary
# session. Fail-closed: an unresolved/empty sha matches no marker, so a push of
# an unknown sha is blocked, not allowed.
shipped_sha() {
  local d
  d="$(printf '%s' "$cmd" | grep -oE '(^|&&|;|\|)[[:space:]]*cd[[:space:]]+[^[:space:]&;|]+' | head -n1 | sed -E 's/.*cd[[:space:]]+//')"
  if [ -n "$d" ] && [ -d "$d" ]; then
    git -C "$d" rev-parse HEAD 2>/dev/null || true
  else
    git -C "$repo_root" rev-parse HEAD 2>/dev/null || true
  fi
}

# A REAL passing gsd-test verdict is recorded for the sha being shipped?
# Two sanctioned record forms, each binding the pass to an exact --head sha — a
# false green remains impossible; only the pass's *production* (no foreground
# required) and *storage* (shared, per-sha) were relaxed:
#   - <git-common-dir>/gsd-passes/<sha>.json  (per-sha, worktree-independent;
#     written by scripts/gsd-verify-and-record.cjs — spawns the real gsd-test as
#     a child and records only outcome:"passed" for that sha)
#   - <repo>/.gsd/last-pass.json              (legacy single-file, sha-bound;
#     written by record-gsd-verdict.sh from a foreground verdict)
# Either satisfies the gate iff its recorded sha == the shipped sha.
verdict_ok() {
  local sha="${1:-$(shipped_sha)}"
  [ -n "$sha" ] || return 1
  local m="$common_dir/gsd-passes/$sha.json"
  if [ -f "$m" ] && [ "$(jq -r '.outcome // empty' "$m" 2>/dev/null || true)" = "passed" ]; then
    return 0
  fi
  local vf="$repo_root/.gsd/last-pass.json"
  [ -f "$vf" ] || return 1
  [ "$(jq -r '.outcome // empty' "$vf" 2>/dev/null || true)" = "passed" ] \
    && [ "$(jq -r '.sha // empty' "$vf" 2>/dev/null || true)" = "$sha" ]
}

# Documentation/changeset-only exemption (#2576 backfill): a push (or PR) that ships
# NO executable code cannot regress behavior, so it is exempt from the gsd-test
# verdict requirement. The gate exists to keep untested CODE off shared branches —
# not to burn a full (OS × Node) suite run on a one-line changeset `pr:` backfill
# or a docs edit. Runtime-loaded text is NOT doc-only: gsd-core/workflows/*.md,
# agents/*.md, and commands/**/*.md ARE the product the runtime loads, so a path
# with a subdirectory (e.g. `gsd-core/workflows/execute-phase.md`) is excluded by
# the `[^/]+\.md` root-only anchor. Allowed: .changeset/*.md, docs/**,
# .out-of-scope/**, .github PR/issue templates, and root-level *.md (README,
# CONTRIBUTING, CHANGELOG, …).
# `.out-of-scope/**` qualifies on this block's own criterion: it is the
# rejected-capability knowledge base — prose consulted by /triage-review when
# dispositioning a request. Nothing under it is loaded by the runtime or
# executed, so it cannot regress behavior.
# Range = <upstream>..HEAD (the files the push/PR will actually change on the
# remote). A branch with no configured upstream (first push) fails closed.
#
# The directory-prefix branches MUST carry a trailing `.*`: the pattern is
# whole-line anchored (`^…$`), so a bare `docs/` alternative matches only the
# literal string "docs/" and never a real path like `docs/README.md`. Without
# the `.*` those branches are dead and the documented exemption silently never
# fires — the failure mode is a false GATE (safe but wrong), so it stayed
# invisible. Keep `[^/]+\.md` anchored WITHOUT `.*` — that one is deliberately
# root-only, so runtime-loaded text under a subdirectory
# (gsd-core/workflows/*.md, agents/*.md, commands/**/*.md) stays gated.
DOC_ONLY_RE='^(\.changeset/[^/]+\.md|docs/.*|\.out-of-scope/.*|\.github/(PULL_REQUEST_TEMPLATE|ISSUE_TEMPLATE)/.*|[^/]+\.md)$'
is_doc_only_path() { printf '%s' "$1" | grep -qE "$DOC_ONLY_RE"; }
# The worktree this command actually ships from — same leading `cd <dir>`
# honoring as shipped_sha(). Without this the doc-only classification inspected
# the SESSION worktree while the sha came from the pushed one, so a push driven
# from a linked worktree was classified against the wrong files.
push_worktree() {
  local d
  d="$(printf '%s' "$cmd" | grep -oE '(^|&&|;|\|)[[:space:]]*cd[[:space:]]+[^[:space:]&;|]+' | head -n1 | sed -E 's/.*cd[[:space:]]+//')"
  if [ -n "$d" ] && [ -d "$d" ]; then printf '%s' "$d"; else printf '%s' "$repo_root"; fi
}

head_changes_are_doc_only() {
  local wt base files line cand
  wt="$(push_worktree)"
  # Compare against the INTEGRATION branch, never the branch's own upstream.
  # The gate asks "does this ship executable code onto a shared branch", which is
  # answered relative to what the branch MERGES INTO. Using `@{u}` answered a
  # different question ("what is new since I last pushed") and broke outright after
  # a rebase: this repo mandates rebasing before push (next requires up-to-date),
  # which leaves `@{u}` pointing at the stale pre-rebase remote counterpart, so even
  # the three-dot merge-base is stale and the range absorbs every upstream commit the
  # rebase pulled in. Measured: 79 files via `@{u}...HEAD` vs 1 via `origin/next...HEAD`
  # for a one-file docs branch. A docs-only push was denied as a result.
  #
  # A branch created FOR this change has no upstream until `git push -u`
  # CREATES it — so without this fallback the documented exemption could never
  # fire on the FIRST push of a docs-only branch, which is exactly when it is
  # needed (every docs PR, and the one-line changeset `pr:` backfills this
  # exemption was added for, burned a full OS x Node suite run for nothing).
  for cand in origin/next next origin/main main; do
    if git -C "$wt" rev-parse --verify --quiet "$cand" >/dev/null 2>&1; then base="$cand"; break; fi
  done
  [ -n "$base" ] || return 1
  # Three-dot (merge-base): only changes introduced ON this branch. Two-dot
  # against a MOVING integration branch would fold commits that landed on
  # `next` into this push's file list.
  files="$(git -C "$wt" diff --name-only "$base...HEAD" 2>/dev/null || true)"
  [ -n "$files" ] || return 0   # nothing to push → trivially doc-only
  while IFS= read -r line; do
    [ -n "$line" ] || continue
    is_doc_only_path "$line" || return 1
  done <<< "$files"
  return 0
}

# Is this command (any chained segment) a `git push`? Fail-closed but precise:
# strips leading env assignments and git global flags, then requires `push`
# as the git subcommand.
is_git_push() {
  local seg
  while IFS= read -r seg || [ -n "$seg" ]; do
    seg="$(printf '%s' "$seg" | sed -E 's/^[[:space:]]+//; s/[[:space:]]+$//')"
    [ -z "$seg" ] && continue
    seg="$(printf '%s' "$seg" | sed -E 's/^([A-Za-z_][A-Za-z0-9_]*=[^[:space:]]*[[:space:]]+)+//')"
    if printf '%s' "$seg" | grep -Eq '^git([[:space:]]+(-C[[:space:]]+[^[:space:]]+|-c[[:space:]]+[^[:space:]]+|--[^[:space:]=]+(=[^[:space:]]+)?|-[A-Za-z]+))*[[:space:]]+push([[:space:]]|$)'; then
      return 0
    fi
  done < <(printf '%s' "$cmd" | sed -E 's/&&/\n/g; s/\|\|/\n/g' | tr ';|\n' '\n')
  return 1
}

# 1) git push gate
if is_git_push; then
  if printf '%s' "$cmd" | grep -q 'GSD_HUMAN_OVERRIDE=1'; then
    mkdir -p "$repo_root/.gsd"
    printf '%s  HUMAN_OVERRIDE push: %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$cmd" >> "$repo_root/.gsd/override.log"
    exit 0
  fi
  if head_changes_are_doc_only; then exit 0; fi
  if verdict_ok; then exit 0; fi
  ship="$(shipped_sha)"
  deny "PUSH BLOCKED — no passing gsd-test verdict for the sha being pushed (${ship:0:9}).
gsd-test MUST report outcome:\"passed\" on THAT commit before any git push (CLAUDE.md, ABSOLUTE). Machine-enforced: this cannot be cleared by reasoning, by intent, or by claiming the tests are unrelated/flaky/expected.
Record it (no foreground needed — any agent, any worktree; run from inside the target worktree):
  node ${GSD_VERIFY_WRAPPER:-.claude/hooks/gsd-verify-and-record.cjs} --base next --head <40-hex-sha> [--bench <name>]
It runs the real gsd-test and, ONLY on outcome:\"passed\", records the pass for that exact sha — then the push unblocks. (Foreground \`gsd-test run\` also works, via the legacy recorder.)
If outcome is failed / reaped / infra_error: HALT and fix or surface it. Do not push.
(Human-only escape, never for the agent: re-issue prefixed with GSD_HUMAN_OVERRIDE=1 — it is logged.)"
fi

# 2) PR create/ready/merge gate, plus SUBSTANTIVE `gh pr edit` only.
# `gh pr edit` is gated iff it mutates PR-contract fields (--title/--body/
# --body-file/--base). A label/assignee/reviewer/milestone-only edit is
# bookkeeping — it ships no code and is NOT gated.
pr_gated() {
  printf '%s' "$cmd" | grep -Eq 'gh[[:space:]]+pr[[:space:]]+(create|ready|merge)([[:space:]]|$)' && return 0
  if printf '%s' "$cmd" | grep -Eq 'gh[[:space:]]+pr[[:space:]]+edit([[:space:]]|$)'; then
    printf '%s' "$cmd" | grep -Eq -- '--(body-file|body|title|base)([[:space:]=]|$)' && return 0
  fi
  return 1
}
# REVIEW-AND-MERGE EXEMPTION: the pre-PR gates govern code THIS session is
# shipping - they exist so untested work of ours never reaches a shared branch.
# Acting on a PR somebody ELSE authored is the opposite operation: the code is
# already submitted, its own CI has already run, and we are reviewing/merging it.
# Requiring a local gsd-test verdict there gates the wrong thing entirely - our
# HEAD sha has no relationship to the contributor's branch, so the verdict is
# unsatisfiable by construction (observed: merging PR #2779 demanded a pass for
# 542d97d0, the review session's own unrelated HEAD).
#
# Exempt iff the command names an explicit PR number AND that PR's author is not
# the authenticated user. FAIL-CLOSED in every uncertain case: no number (e.g. a
# bare `gh pr merge`, which targets the CURRENT branch's PR - our own work),
# unknown author, unknown viewer, or any `gh` failure all fall through to the
# full gate. `gh pr create` never carries a number, so it is never exempt.
gh_bounded() {
  if command -v timeout >/dev/null 2>&1; then timeout 10 gh "$@"
  elif command -v gtimeout >/dev/null 2>&1; then gtimeout 10 gh "$@"
  else gh "$@"; fi
}
third_party_pr() {
  local n author viewer
  n="$(printf '%s' "$cmd" | grep -oE 'gh[[:space:]]+pr[[:space:]]+(merge|edit|ready)[[:space:]]+[0-9]+' | head -n1 | grep -oE '[0-9]+$' || true)"
  [ -n "$n" ] || return 1
  author="$(gh_bounded pr view "$n" --json author --jq '.author.login' 2>/dev/null || true)"
  [ -n "$author" ] || return 1
  viewer="$(gh_bounded api user --jq '.login' 2>/dev/null || true)"
  [ -n "$viewer" ] || return 1
  [ "$author" != "$viewer" ]
}

if pr_gated; then
  if third_party_pr; then exit 0; fi
  if ! head_changes_are_doc_only && ! verdict_ok; then
    ship="$(shipped_sha)"
    deny "PR BLOCKED — no passing gsd-test verdict for the sha being shipped (${ship:0:9}). Record it first from inside the target worktree: node ${GSD_VERIFY_WRAPPER:-.claude/hooks/gsd-verify-and-record.cjs} --base next --head <40-hex-sha> (machine-enforced; CLAUDE.md ABSOLUTE). Doc/changeset-only PRs are exempt — if you intended a docs-only PR, ensure every changed file is under .changeset/, docs/, .github templates, or a root-level *.md."
  fi
  if ! printf '%s' "$cmd" | grep -q 'GSD_PR_GATES_OK=1'; then
    deny "PRE-PR GATES REQUIRED (CLAUDE.md ORTHOGONAL REVIEW): gsd-test has passed, but the two orthogonal reviews are still outstanding. Run BOTH /code-review (correctness, logic, performance, edge cases) AND /security-review (injection, secrets, traversal, unsafe argv, prompt-injection), with AT LEAST ONE of them in an ISOLATED reviewer context — a fresh subagent that did not author the change — plus \`npm run lint:ci\`. FIX every finding at any severity BEFORE opening/updating a PR; findings do not get deferred. NOTE: /codex is NOT used in this repo — the orthogonal pair above replaces the old adversarial-review step. To proceed after genuinely running them, prefix the command with GSD_PR_GATES_OK=1."
  fi
  exit 0
fi

exit 0
