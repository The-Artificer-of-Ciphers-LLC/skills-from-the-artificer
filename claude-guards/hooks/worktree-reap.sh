#!/bin/bash
# worktree-reap.sh
#
# Claude Code hook: removes worktrees and local branches whose work has
# already landed in the default branch, so they stop accumulating. Runs after
# every Bash call (async) and at SessionStart.
#
# "Landed" means ONE of:
#   ancestor  the branch tip is an ancestor of the default branch
#             (plain merge / fast-forward).
#   squash    GitHub reports a MERGED pull request for the branch whose
#             head SHA equals the local branch tip (so the work is pushed and
#             nothing was added after the merge), whose base is the default
#             branch, and whose merge commit is already in the LOCAL default
#             branch. This is the squash-merge case, where `is-ancestor` is
#             always false because the squash rewrites the commits.
#
# Worktree safety: a worktree is removed only if its branch has landed AND its
# working tree is clean AND it is not locked AND it is not in use (a live
# process cwd inside it, or HEAD/index/logs touched within
# WORKTREE_REAP_MIN_AGE_SECONDS, default 86400). It never touches the main
# checkout, a detached-HEAD worktree, the default branch, or any worktree
# outside <repo>/.claude/worktrees/.
#
# Branch safety: a local branch is deleted only if it has landed, is not the
# default branch, and is not checked out in any worktree. A branch that landed
# only as an `ancestor` must also be older than the minimum age, so a fresh
# empty branch is not mistaken for finished work. `ancestor` branches are
# deleted with `git branch -d`; `squash` branches need `-D` (git cannot see the
# squash), so that route relies on the PR check above instead of git's own.
#
# Remote branches are opt-in (WORKTREE_REAP_REMOTE=1) and only deleted when the
# remote tip equals the local tip and no OPEN pull request is based on the
# branch (deleting a stacked PR's base would close its child PR).
#
# GitHub is consulted at SessionStart, after commands that usually follow a
# merge (gh pr merge, git pull/fetch/switch/checkout), or at most once per
# WORKTREE_REAP_GH_INTERVAL seconds (default 1800). WORKTREE_REAP_NO_GH=1
# disables it. Without gh, only the `ancestor` route runs.
#
# WORKTREE_REAP_DRYRUN=1 prints what would be removed and touches nothing.
# Always exits 0: a cleanup hook must never block the command it follows.

set -u

REAP_LOG="${WORKTREE_REAP_LOG:-$HOME/.claude/hooks/worktree-reap.log}"
STAMP_DIR="${WORKTREE_REAP_STAMP_DIR:-$HOME/.claude/hooks}"

HOOK_INPUT="$(cat 2>/dev/null || true)"

# Newest mtime (epoch seconds) among the files git touches when a worktree is used.
newest_activity() {
    local gitdir="$1" f m best=0
    for f in HEAD index ORIG_HEAD logs/HEAD; do
        [ -e "$gitdir/$f" ] || continue
        m="$(stat -f %m "$gitdir/$f" 2>/dev/null || stat -c %Y "$gitdir/$f" 2>/dev/null || echo 0)"
        [ "$m" -gt "$best" ] 2>/dev/null && best="$m"
    done
    echo "$best"
}

main() {
    local toplevel common_dir
    toplevel="$(git rev-parse --show-toplevel 2>/dev/null)" || return 0
    [ -n "$toplevel" ] || return 0
    common_dir="$(git -C "$toplevel" rev-parse --git-common-dir 2>/dev/null)" || return 0
    [ -n "$common_dir" ] || return 0
    case "$common_dir" in
        /*) : ;;
        *) common_dir="$toplevel/$common_dir" ;;
    esac
    # Run from inside a linked worktree: act on the main checkout's view of the repo.
    # Paths stay exactly as git prints them (no pwd -P): `git worktree list`
    # reports the same spelling, and a symlinked /var vs /private/var mismatch
    # would otherwise stop the main checkout and candidates from matching.
    case "$common_dir" in
        */.git) toplevel="${common_dir%/.git}" ;;
    esac

    local default_branch=""
    if git -C "$toplevel" show-ref --verify --quiet refs/heads/main; then
        default_branch="main"
    elif git -C "$toplevel" show-ref --verify --quiet refs/heads/master; then
        default_branch="master"
    else
        return 0
    fi

    local candidates_dir="$toplevel/.claude/worktrees"
    local porcelain
    porcelain="$(git -C "$toplevel" worktree list --porcelain 2>/dev/null)" || return 0
    [ -n "$porcelain" ] || return 0

    local live_cwds
    live_cwds="$(lsof -a -d cwd -Fn 2>/dev/null | sed -n 's/^n//p')" || live_cwds=""
    local min_age="${WORKTREE_REAP_MIN_AGE_SECONDS:-86400}" now
    now="$(date +%s)"

    local dryrun=0 reap_remote=0
    [ "${WORKTREE_REAP_DRYRUN:-0}" = "1" ] && dryrun=1
    [ "${WORKTREE_REAP_REMOTE:-0}" = "1" ] && reap_remote=1

    # ---- GitHub availability / throttle -------------------------------------
    local gh_ok=0 stamp key gh_interval="${WORKTREE_REAP_GH_INTERVAL:-1800}"
    if [ "${WORKTREE_REAP_NO_GH:-0}" != "1" ] && command -v gh >/dev/null 2>&1; then
        key="$(printf '%s' "$toplevel" | cksum | awk '{print $1}')"
        stamp="$STAMP_DIR/.worktree-reap-gh-$key"
        local eager=0 last=0
        case "$HOOK_INPUT" in
            *SessionStart*|*"gh pr merge"*|*"git pull"*|*"git fetch"*|*"git switch"*|*"git checkout"*) eager=1 ;;
        esac
        [ -f "$stamp" ] && last="$(stat -f %m "$stamp" 2>/dev/null || stat -c %Y "$stamp" 2>/dev/null || echo 0)"
        if [ "$eager" -eq 1 ] || [ $((now - last)) -ge "$gh_interval" ]; then
            gh_ok=1
            [ "$dryrun" -eq 1 ] || touch "$stamp" 2>/dev/null || true
        fi
    fi

    # ---- landed(): has this branch's work reached the default branch? -------
    # Sets LANDED_VIA to "ancestor" or "squash". Returns 0 if landed.
    LANDED_VIA=""
    landed() {
        local br="$1" tip lines head base merge
        LANDED_VIA=""
        if git -C "$toplevel" merge-base --is-ancestor "$br" "$default_branch" 2>/dev/null; then
            LANDED_VIA="ancestor"
            return 0
        fi
        [ "$gh_ok" -eq 1 ] || return 1
        tip="$(git -C "$toplevel" rev-parse "refs/heads/$br" 2>/dev/null)" || return 1
        lines="$(cd "$toplevel" && gh pr list --state merged --head "$br" --limit 10 \
            --json headRefOid,baseRefName,mergeCommit \
            --jq '.[] | "\(.headRefOid) \(.baseRefName) \(.mergeCommit.oid)"' 2>/dev/null)" || return 1
        [ -n "$lines" ] || return 1
        while read -r head base merge; do
            [ "$head" = "$tip" ] || continue
            [ "$base" = "$default_branch" ] || continue
            [ -n "$merge" ] || continue
            if git -C "$toplevel" merge-base --is-ancestor "$merge" "$default_branch" 2>/dev/null; then
                LANDED_VIA="squash"
                return 0
            fi
        done <<<"$lines"
        return 1
    }

    log_line() { echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) $toplevel $*" >>"$REAP_LOG"; }

    # Deletes a landed local branch with the right flag. Echoes nothing.
    delete_local_branch() {
        local br="$1" via="$2" flag="-d"
        [ "$via" = "squash" ] && flag="-D"
        git -C "$toplevel" branch "$flag" "$br" >/dev/null 2>>"$REAP_LOG"
    }

    # Opt-in: delete origin/<br> when it matches the local tip and nothing is based on it.
    maybe_delete_remote() {
        local br="$1" tip="$2" rsha open
        [ "$reap_remote" -eq 1 ] || return 0
        [ "$gh_ok" -eq 1 ] || return 0
        rsha="$(git -C "$toplevel" ls-remote --heads origin "refs/heads/$br" 2>/dev/null | awk '{print $1}')"
        [ -n "$rsha" ] || return 0
        if [ "$rsha" != "$tip" ]; then
            log_line "SKIP_REMOTE_TIP_DIFFERS $br"
            return 0
        fi
        open="$(cd "$toplevel" && gh pr list --state open --base "$br" --json number --jq '.[].number' 2>/dev/null)" || return 0
        if [ -n "$open" ]; then
            log_line "SKIP_REMOTE_HAS_OPEN_CHILD_PR $br"
            return 0
        fi
        if [ "$dryrun" -eq 1 ]; then
            echo "DRYRUN: would delete remote branch 'origin/$br'"
            return 0
        fi
        if git -C "$toplevel" push origin --delete "$br" >/dev/null 2>>"$REAP_LOG"; then
            log_line "REMOTE $br"
            remote_count=$((remote_count + 1))
        fi
    }

    local wt_count=0 br_count=0 remote_count=0
    local wt_path="" wt_branch=""
    local checked_out=$'\n'   # newline-delimited set of branches checked out anywhere

    process_record() {
        [ -n "$wt_path" ] || return 0
        [ -n "$wt_branch" ] && checked_out="${checked_out}${wt_branch}"$'\n'

        [ "$wt_path" = "$toplevel" ] && return 0            # main checkout
        [ -n "$wt_branch" ] || return 0                      # detached HEAD
        [ "$wt_branch" = "$default_branch" ] && return 0
        case "$wt_path" in "$candidates_dir"/*) : ;; *) return 0 ;; esac

        local wt_base lock_marker
        wt_base="$(basename "$wt_path")"
        lock_marker="$common_dir/worktrees/$wt_base/locked"
        [ -f "$lock_marker" ] && return 0

        if printf '%s\n' "$live_cwds" | awk -v p="$wt_path" 'index($0,p"/")==1 || $0==p{f=1} END{exit !f}'; then
            return 0
        fi
        local act
        act="$(newest_activity "$common_dir/worktrees/$wt_base")"
        [ $((now - act)) -lt "$min_age" ] && return 0

        landed "$wt_branch" || return 0

        [ -n "$(git -C "$wt_path" status --porcelain 2>/dev/null)" ] && return 0

        local via="$LANDED_VIA" tip
        tip="$(git -C "$toplevel" rev-parse "refs/heads/$wt_branch" 2>/dev/null)"
        if [ "$dryrun" -eq 1 ]; then
            echo "DRYRUN: would remove worktree '$wt_path' (branch '$wt_branch', landed via $via)"
            return 0
        fi
        if git -C "$toplevel" worktree remove "$wt_path" 2>>"$REAP_LOG"; then
            delete_local_branch "$wt_branch" "$via" || true
            log_line "WORKTREE $wt_branch via=$via"
            wt_count=$((wt_count + 1))
            maybe_delete_remote "$wt_branch" "$tip"
        else
            log_line "FAILED_REMOVE $wt_branch"
        fi
    }

    while IFS= read -r line; do
        case "$line" in
            "worktree "*) wt_path="${line#worktree }"; wt_branch="" ;;
            "branch "*)   wt_branch="${line#branch refs/heads/}" ;;
            "")           process_record; wt_path=""; wt_branch="" ;;
            *) : ;;
        esac
    done <<<"$porcelain"
    process_record

    # ---- Branch sweep: local branches with no worktree ----------------------
    local br via tip logf mt
    while IFS= read -r br; do
        [ -n "$br" ] || continue
        [ "$br" = "$default_branch" ] && continue
        case "$checked_out" in *$'\n'"$br"$'\n'*) continue ;; esac
        landed "$br" || continue
        via="$LANDED_VIA"
        if [ "$via" = "ancestor" ]; then
            # A fresh empty branch is trivially an ancestor; require age.
            logf="$common_dir/logs/refs/heads/$br"
            [ -e "$logf" ] || continue
            mt="$(stat -f %m "$logf" 2>/dev/null || stat -c %Y "$logf" 2>/dev/null || echo "$now")"
            [ $((now - mt)) -lt "$min_age" ] && continue
        fi
        tip="$(git -C "$toplevel" rev-parse "refs/heads/$br" 2>/dev/null)"
        if [ "$dryrun" -eq 1 ]; then
            echo "DRYRUN: would delete local branch '$br' (landed via $via)"
            maybe_delete_remote "$br" "$tip"
            continue
        fi
        if delete_local_branch "$br" "$via"; then
            log_line "BRANCH $br via=$via tip=$tip"
            br_count=$((br_count + 1))
            maybe_delete_remote "$br" "$tip"
        else
            log_line "FAILED_BRANCH $br"
        fi
    done < <(git -C "$toplevel" for-each-ref --format='%(refname:short)' refs/heads 2>/dev/null)

    if [ -f "$REAP_LOG" ]; then
        tail -500 "$REAP_LOG" >"$REAP_LOG.tmp" 2>/dev/null && mv "$REAP_LOG.tmp" "$REAP_LOG"
    fi
    git -C "$toplevel" worktree prune >/dev/null 2>&1 || true

    if [ $((wt_count + br_count + remote_count)) -gt 0 ]; then
        echo "{\"systemMessage\":\"worktree-reap: removed $wt_count worktree(s), $br_count branch(es), $remote_count remote branch(es) (landed in $default_branch)\"}"
    fi
    return 0
}

main || true
exit 0
