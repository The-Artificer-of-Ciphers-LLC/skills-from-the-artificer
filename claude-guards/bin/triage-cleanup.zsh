#!/bin/zsh
# triage-cleanup.zsh — end-of-run cleanup for /triage-review (macOS, zsh).
#
#   triage-cleanup.zsh [--apply] [--repo PATH] [--max-age-days N]
#
# Default is a DRY RUN that prints what would be removed and the bytes it would
# free. --apply performs it. Always exits 0 on a partial failure so a cleanup
# problem never masks the run's real result; failures are listed at the end.
#
# What it removes (in this order):
#   1. the run's artifacts under <repo>/.gsd/triage/ (named files only; helpers
#      and anything else in that directory are kept)
#   2. dead worktree registrations (`git worktree prune`)
#   3. scratch worktrees registered under /private/tmp or /tmp that are CLEAN,
#      have no live process inside them, and whose work is already pushed
#      (detached HEAD contained in a remote branch, or branch tip == remote tip,
#      or branch merged into origin's default branch). Anything else is KEPT
#      and listed, never deleted.
#   4. stale per-session scratch dirs under /private/tmp/claude-<uid>/ with no
#      file touched in --max-age-days (default 2) and no live process cwd inside
#      them. Directories still registered as worktrees are never removed here.
#
# zsh note: globs below use (N) so an empty match is not a "no matches found"
# abort, which is the exact failure the previous inline `rm … archive-*` hit.

emulate -L zsh
setopt null_glob pipe_fail no_unset

typeset apply=0 repo="" max_age=2
while (( $# )); do
  case "$1" in
    --apply) apply=1 ;;
    --repo) repo="$2"; shift ;;
    --max-age-days) max_age="$2"; shift ;;
    *) print -u2 "unknown arg: $1"; exit 2 ;;
  esac
  shift
done

[[ -n "$repo" ]] || repo="$(git rev-parse --show-toplevel 2>/dev/null)"
[[ -n "$repo" && -d "$repo" ]] || { print -u2 "triage-cleanup: not in a git repo and no --repo"; exit 2; }

typeset -a failures
typeset freed=0
typeset mode="DRY-RUN"; (( apply )) && mode="APPLY"
print "triage-cleanup [$mode] repo=$repo max-age-days=$max_age"

bytes_of() { du -sk "$1" 2>/dev/null | awk '{print $1*1024}'; }

typeset -A cat_count cat_bytes
remove_path() { # remove_path <path> <label>; scratch dirs are summarised, artifacts listed
  typeset p="$1" label="$2" b
  b=$(bytes_of "$p"); [[ -n "$b" ]] || b=0
  if (( apply )); then
    if rm -rf -- "$p"; then
      freed=$(( freed + b ))
      [[ "$label" == artifact ]] && print "  removed  $label: $p"
    else failures+=("rm $p"); return; fi
  else
    freed=$(( freed + b ))
    [[ "$label" == artifact ]] && print "  would remove  $label: $p"
  fi
  cat_count[$label]=$(( ${cat_count[$label]:-0} + 1 ))
  cat_bytes[$label]=$(( ${cat_bytes[$label]:-0} + b ))
}

# live cwd map: every directory a running process is sitting in
typeset live_cwds
live_cwds="$(lsof -a -d cwd -Fn 2>/dev/null | sed -n 's/^n//p')"
in_use() { # in_use <dir>  -> 0 when some process cwd is inside it
  typeset d="${1%/}"
  print -r -- "$live_cwds" | awk -v d="$d" 'index($0, d)==1 && (length($0)==length(d) || substr($0, length(d)+1, 1)=="/") {f=1} END{exit f?0:1}'
}

# --- 1. run artifacts --------------------------------------------------------
print "1. run artifacts"
typeset T="$repo/.gsd/triage"
typeset f
for f in 00-run.json 10-worklist.md 20-diagnosis 30-decisions.json 40-oos-queue.json 90-summary.md _raw _memtrace.lock; do
  [[ -e "$T/$f" ]] && remove_path "$T/$f" "artifact"
done
for f in "$T"/archive-*(N); do remove_path "$f" "artifact"; done

# --- 2. dead registrations ---------------------------------------------------
print "2. git worktree prune"
if (( apply )); then git -C "$repo" worktree prune -v 2>&1 | sed 's/^/  /'; else git -C "$repo" worktree prune --dry-run -v 2>&1 | sed 's/^/  would: /'; fi

# --- 3. scratch worktrees under /tmp ----------------------------------------
print "3. scratch worktrees under /private/tmp"
typeset default_branch
default_branch="$(git -C "$repo" symbolic-ref --quiet --short refs/remotes/origin/HEAD 2>/dev/null)"
[[ -n "$default_branch" ]] || default_branch="origin/next"
typeset -a kept
typeset wt_path="" wt_head="" wt_branch="" line
typeset -a entries
while IFS= read -r line; do
  case "$line" in
    "worktree "*) wt_path="${line#worktree }"; wt_head=""; wt_branch="" ;;
    "HEAD "*) wt_head="${line#HEAD }" ;;
    "branch "*) wt_branch="${line#branch refs/heads/}" ;;
    "")
      [[ -n "$wt_path" ]] && entries+=("$wt_path|$wt_head|$wt_branch")
      wt_path=""
      ;;
  esac
done < <(git -C "$repo" worktree list --porcelain; print)

typeset e p h br pushed rtip b
for e in "${entries[@]}"; do
  p="${e%%|*}"; h="${${e#*|}%%|*}"; br="${e##*|}"
  [[ "$p" == /private/tmp/* || "$p" == /tmp/* ]] || continue
  [[ -d "$p" ]] || continue
  if in_use "$p"; then kept+=("$p (process inside)"); continue; fi
  if [[ -n "$(git -C "$p" status --porcelain 2>/dev/null)" ]]; then kept+=("$p (uncommitted changes)"); continue; fi
  pushed=0
  if [[ -z "$br" ]]; then
    [[ -n "$(git -C "$repo" branch -r --contains "$h" 2>/dev/null)" ]] && pushed=1
  else
    rtip="$(git -C "$repo" rev-parse --verify --quiet "refs/remotes/origin/$br" 2>/dev/null)"
    [[ -n "$rtip" && "$rtip" == "$h" ]] && pushed=1
    git -C "$repo" merge-base --is-ancestor "$h" "$default_branch" 2>/dev/null && pushed=1
  fi
  if (( ! pushed )); then kept+=("$p (work not on a remote: ${br:-detached $h[1,10]})"); continue; fi
  b=$(bytes_of "$p"); [[ -n "$b" ]] || b=0
  if (( apply )); then
    if git -C "$repo" worktree remove "$p" 2>/dev/null; then freed=$(( freed + b )); print "  removed  worktree: $p"
    else failures+=("worktree remove $p"); fi
  else
    freed=$(( freed + b )); print "  would remove  worktree: $p ($(( b / 1048576 )) MB)"
  fi
done
(( apply )) && git -C "$repo" worktree prune
for p in "${kept[@]}"; do print "  kept: $p"; done

# --- 4. stale session scratch -----------------------------------------------
print "4. stale session scratch under /private/tmp/claude-$UID (idle > ${max_age}d)"
typeset base="/private/tmp/claude-$UID" d proj sess
typeset -a registered
registered=("${(@f)$(git -C "$repo" worktree list --porcelain | sed -n 's/^worktree //p')}")
touched_recently() { [[ -n "$(find "$1" -type f -mtime -"$max_age" -print -quit 2>/dev/null)" ]]; }
holds_worktree() { local w; for w in "${registered[@]}"; do [[ "$w" == "$1"/* || "$w" == "$1" ]] && return 0; done; return 1; }
if [[ -d "$base" ]]; then
  for d in "$base"/*(N/); do
    if [[ "${d:t}" == -* ]]; then          # project-slug dir holding session-uuid dirs
      for sess in "$d"/*(N/); do
        if in_use "$sess" || touched_recently "$sess" || holds_worktree "$sess"; then continue; fi
        remove_path "$sess" "session scratch"
      done
      [[ -z "$(ls -A "$d" 2>/dev/null)" ]] && (( apply )) && rmdir "$d" 2>/dev/null
    else                                    # loose top-level scratch (wt-*, sec*, ...)
      if in_use "$d" || touched_recently "$d" || holds_worktree "$d"; then continue; fi
      remove_path "$d" "scratch"
    fi
  done
fi

# --- report ------------------------------------------------------------------
print "---"
typeset k
for k in ${(k)cat_count}; do
  [[ "$k" == artifact ]] && continue
  print "  $k: ${cat_count[$k]} dir(s), $(( ${cat_bytes[$k]} / 1048576 )) MB"
done
print "$mode: $(( freed / 1048576 )) MB $( (( apply )) && print freed || print reclaimable )"
if (( ${#failures} )); then print "FAILED:"; printf '  %s\n' "${failures[@]}"; fi
print "leftover in $T:"; ls -A "$T" 2>/dev/null | sed 's/^/  /'
exit 0
