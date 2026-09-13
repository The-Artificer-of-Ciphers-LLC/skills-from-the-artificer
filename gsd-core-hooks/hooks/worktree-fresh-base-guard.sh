#!/usr/bin/env bash
# PreToolUse guard: a worktree is NEVER created off a stale trunk.
#
# Incident that motivated it (2026-09-10): the main checkout sat on `next` at
# 66dbb104a0 while origin/next had moved 53 commits ahead, and its index still
# held the tree of 06eba5fdb0 — an ancestor 100+ commits back. Every worktree
# cut from `next` in that window inherited a trunk that was already stale, so
# branches were authored against code that had been rewritten upstream and the
# first rebase produced conflicts that had nothing to do with the change.
#
# The fix is not a reminder — it is to make the fetch part of worktree creation:
#
#   1. FETCH  — `git fetch origin next` runs before the tool call proceeds, so
#      refs/remotes/origin/next is current at the moment the worktree is cut.
#   2. FAST-FORWARD — if local `next` is strictly behind origin/next and is not
#      checked out in any worktree, it is advanced by compare-and-swap
#      update-ref. `git worktree add … next` then gets the fresh trunk. This is
#      never a rewrite: it runs only when `next` is a proven ancestor.
#   3. DENY — if local `next` is behind AND checked out somewhere (so it cannot
#      be moved from under a working tree), a worktree that would be based on it
#      is blocked with the exact command to resolve it.
#
# Scoped deliberately: only a base that NAMES the trunk (`next`, `origin/next`,
# or an omitted base while the current branch is `next`) is staleness-checked.
# Review worktrees cut from a PR head are legitimately behind origin/next and
# are left alone — a guard that blocks normal review is a guard that gets
# disabled. The fetch in step 1 still runs for those.
#
# Human-only override: prefix the command with GSD_WORKTREE_STALE_OK=1 (logged).
set -euo pipefail

input="$(cat)"

tool="$(printf '%s' "$input" | jq -r '.tool_name // empty' 2>/dev/null || true)"
cmd="$(printf '%s' "$input" | jq -r '.tool_input.command // empty' 2>/dev/null || true)"

repo_root="$(git rev-parse --show-toplevel 2>/dev/null || echo .)"

deny() {
  jq -n --arg r "$1" '{hookSpecificOutput:{hookEventName:"PreToolUse",permissionDecision:"deny",permissionDecisionReason:$r}}'
  exit 0
}

# Bound every network/git call. This Mac has no coreutils `timeout`; perl's
# alarm is the portable equivalent and perl is present at /usr/bin/perl.
# CLAUDE.md requires git subprocesses to be bounded (5-30s) and to degrade
# rather than hang.
bounded() {
  local secs="$1"; shift
  perl -e 'alarm shift; exec @ARGV or exit 127' "$secs" "$@"
}

# ── Heredoc bodies are data, not commands ────────────────────────────────────
# Without stripping them, a doc or fixture that merely QUOTES `git worktree add`
# inside `cat > f <<EOF … EOF` parses as a real invocation. Keep the line
# bearing `<<WORD` — that line IS a real command.
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

# ── Does this call create a worktree? ────────────────────────────────────────
# Two surfaces: the Bash form (`git worktree add`) and the harness EnterWorktree
# tool, which carries no command text. Anything else exits immediately — this
# hook is on the Bash matcher and must stay cheap for the calls it ignores.
base_tok=""
if [ "$tool" = "Bash" ]; then
  [ -z "$cmd" ] && exit 0
  cmd_scan="$(strip_heredocs "$cmd")"
  # git's GLOBAL options may sit between `git` and the subcommand, and several
  # of them take a separate value (`git -C /path worktree add …`). Matching only
  # value-less flags let `-C <path>` slip the gate entirely — verified as a live
  # bypass on 2026-09-10 before this alternation was added.
  git_pre='([[:space:]]+(-C|-c|--git-dir|--work-tree|--namespace|--exec-path|--config-env)[[:space:]]+[^[:space:]]+|[[:space:]]+-[^[:space:]]+)*'
  printf '%s' "$cmd_scan" | grep -Eq "git${git_pre}[[:space:]]+worktree[[:space:]]+add" || exit 0

  # A `-C <path>` names the repository the worktree is added to, which is not
  # necessarily the CWD. Check the repo the command actually targets.
  # A leading `cd <path> && git worktree add …` retargets the repository just as
  # `-C` does. Without this the gate would judge the SESSION repo's trunk and
  # could deny a worktree in an unrelated repo for staleness that is not its own
  # — a false deny, the failure mode that gets a gate switched off.
  cd_to="$(printf '%s' "$cmd_scan" | sed -n '1s/^[[:space:]]*cd[[:space:]][[:space:]]*\([^;&|]*\).*/\1/p' | sed 's/[[:space:]]*$//' | tr -d '"'"'"'"')"
  if [ -n "$cd_to" ] && [ -d "$cd_to" ]; then
    alt_root="$(git -C "$cd_to" rev-parse --show-toplevel 2>/dev/null || true)"
    [ -n "$alt_root" ] && repo_root="$alt_root"
  fi

  dash_c="$(printf '%s' "$cmd_scan" | sed -n 's/.*git[[:space:]][^;&|]*-C[[:space:]][[:space:]]*\([^[:space:]]*\).*worktree[[:space:]][[:space:]]*add.*/\1/p' | head -1)"
  if [ -n "$dash_c" ] && [ -d "$dash_c" ]; then
    alt_root="$(git -C "$dash_c" rev-parse --show-toplevel 2>/dev/null || true)"
    [ -n "$alt_root" ] && repo_root="$alt_root"
  fi

  if printf '%s' "$cmd" | grep -q 'GSD_WORKTREE_STALE_OK=1'; then
    mkdir -p "$repo_root/.gsd"
    printf '%s  HUMAN_OVERRIDE worktree-stale-base: %s\n' \
      "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$cmd" >> "$repo_root/.gsd/override.log"
    exit 0
  fi

  # Positional args of `git worktree add`: [<opts>] <path> [<commit-ish>].
  # The base is the SECOND positional when present, else HEAD. Options that
  # consume a value (-b/-B/--reason) must have that value skipped, or a branch
  # name gets misread as the base.
  seg="$(printf '%s' "$cmd_scan" | sed -n 's/.*worktree[[:space:]][[:space:]]*add//p')"
  skip_next=0
  n_pos=0
  for tok in $seg; do
    case "$tok" in
      ';'|'&&'|'||'|'|'|'&') break ;;
    esac
    if [ "$skip_next" -eq 1 ]; then skip_next=0; continue; fi
    case "$tok" in
      -b|-B|--reason) skip_next=1; continue ;;
      --*=*|-*) continue ;;
    esac
    n_pos=$((n_pos + 1))
    [ "$n_pos" -eq 2 ] && base_tok="$tok"
  done
  [ "$n_pos" -lt 2 ] && base_tok="HEAD"
fi

# ── Step 1: pull down origin/next ────────────────────────────────────────────
if ! fetch_err="$(bounded 25 git -C "$repo_root" fetch origin next 2>&1)"; then
  deny "Worktree creation BLOCKED — could not refresh origin/next.

A worktree cut from an unverified trunk is the failure this gate exists to stop:
the branch is authored against code that has already moved upstream, and the
staleness only surfaces at the first rebase as conflicts unrelated to the change.
Allowing the call after a failed fetch would silently reintroduce exactly that.

\`git fetch origin next\` said:
$fetch_err

Resolve the fetch (network, auth, remote name), then re-issue the command.

(Human-only escape, never for the agent: re-issue prefixed with
GSD_WORKTREE_STALE_OK=1 — it is logged to .gsd/override.log.)"
fi

remote_sha="$(git -C "$repo_root" rev-parse --verify --quiet origin/next 2>/dev/null || true)"
[ -z "$remote_sha" ] && exit 0

# ── Step 2: fast-forward local `next` when it is safe to do so ───────────────
# Only when `next` is a proven ancestor of origin/next (never a rewrite) and no
# worktree has it checked out (git refuses to move a ref out from under a
# working tree, and doing it by hand would strand that tree's index).
local_sha="$(git -C "$repo_root" rev-parse --verify --quiet refs/heads/next 2>/dev/null || true)"
next_checked_out=0
if [ -n "$local_sha" ]; then
  if git -C "$repo_root" worktree list --porcelain 2>/dev/null | grep -q '^branch refs/heads/next$'; then
    next_checked_out=1
  fi
  if [ "$local_sha" != "$remote_sha" ] \
     && git -C "$repo_root" merge-base --is-ancestor "$local_sha" "$remote_sha" 2>/dev/null \
     && [ "$next_checked_out" -eq 0 ]; then
    bounded 15 git -C "$repo_root" update-ref refs/heads/next "$remote_sha" "$local_sha" 2>/dev/null || true
    local_sha="$(git -C "$repo_root" rev-parse --verify --quiet refs/heads/next 2>/dev/null || true)"
  fi
fi

# EnterWorktree and other non-Bash surfaces carry no base to check. The fetch
# and the fast-forward above are the whole contribution there.
[ "$tool" != "Bash" ] && exit 0

# ── Step 3: block a worktree that would be based on a stale trunk ────────────
case "$base_tok" in
  next|refs/heads/next) ;;
  HEAD|'')
    cur="$(git -C "$repo_root" rev-parse --abbrev-ref HEAD 2>/dev/null || echo '?')"
    [ "$cur" = "next" ] || exit 0
    ;;
  *) exit 0 ;;   # a PR head or feature branch — legitimately behind; leave it
esac

base_sha="$(git -C "$repo_root" rev-parse --verify --quiet "${base_tok:-HEAD}^{commit}" 2>/dev/null || true)"
[ -z "$base_sha" ] && exit 0
[ "$base_sha" = "$remote_sha" ] && exit 0

git -C "$repo_root" merge-base --is-ancestor "$base_sha" "$remote_sha" 2>/dev/null || exit 0

behind="$(git -C "$repo_root" rev-list --count "$base_sha..$remote_sha" 2>/dev/null || echo '?')"
deny "Worktree creation BLOCKED — the base is $behind commit(s) behind origin/next.

Base named:  ${base_tok:-HEAD}  -> $(printf '%s' "$base_sha" | cut -c1-10)
origin/next: $(printf '%s' "$remote_sha" | cut -c1-10)  (just fetched by this gate)

origin/next WAS refreshed — the stale ref is your local \`next\`, and it could
not be advanced automatically because it is checked out in a working tree.
Cutting the worktree now would author the branch against $behind commits of
superseded trunk; the cost lands later as rebase conflicts that have nothing to
do with the change.

Update the checked-out trunk first, then re-issue:
  git -C $repo_root merge --ff-only origin/next
  <your git worktree add …>

If that working tree is dirty, park the changes first (git stash push -m …) —
they are recoverable — then fast-forward.

Alternatively base the worktree on the remote ref directly, which is already
current and needs no local update:
  git worktree add -b <branch> <path> origin/next

(Human-only escape, never for the agent: re-issue prefixed with
GSD_WORKTREE_STALE_OK=1 — it is logged to .gsd/override.log.)"
