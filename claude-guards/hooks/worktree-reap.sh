#!/bin/bash
# worktree-reap.sh
#
# Claude Code hook: removes git worktrees whose work has already landed
# (merged into the default branch, clean, unlocked) so they stop
# accumulating. Runs after `git merge` and at SessionStart.
#
# Safety: a worktree is only removed if ALL of the following hold:
#   1. its branch is fully merged into the repo's default branch
#   2. its working tree is clean (git status --porcelain is empty)
#   3. it is not locked
# It never touches the main checkout, a detached-HEAD worktree, the
# default branch itself, or any worktree outside <toplevel>/.claude/worktrees/.
#
# Set WORKTREE_REAP_DRYRUN=1 to log/print what would be removed without
# actually removing anything.

set -u

REAP_LOG="/Users/trekkie/.claude/hooks/worktree-reap.log"

# Consume any hook JSON on stdin without requiring it.
cat >/dev/null 2>&1 || true

main() {
    local toplevel
    toplevel="$(git rev-parse --show-toplevel 2>/dev/null)" || return 0
    [ -n "$toplevel" ] || return 0

    local default_branch=""
    if git -C "$toplevel" show-ref --verify --quiet refs/heads/main; then
        default_branch="main"
    elif git -C "$toplevel" show-ref --verify --quiet refs/heads/master; then
        default_branch="master"
    else
        return 0
    fi

    local common_dir
    common_dir="$(git -C "$toplevel" rev-parse --git-common-dir 2>/dev/null)" || return 0
    [ -n "$common_dir" ] || return 0
    case "$common_dir" in
        /*) : ;;
        *) common_dir="$toplevel/$common_dir" ;;
    esac

    local candidates_dir="$toplevel/.claude/worktrees"

    local porcelain
    porcelain="$(git -C "$toplevel" worktree list --porcelain 2>/dev/null)" || return 0
    [ -n "$porcelain" ] || return 0

    local dryrun=0
    [ "${WORKTREE_REAP_DRYRUN:-0}" = "1" ] && dryrun=1

    local reaped_count=0
    local wt_path="" wt_branch=""

    process_record() {
        [ -n "$wt_path" ] || return 0

        # Never touch the main checkout itself.
        if [ "$wt_path" = "$toplevel" ]; then
            return 0
        fi

        # Detached HEAD (no branch) cannot be proven merged — skip.
        if [ -z "$wt_branch" ]; then
            return 0
        fi

        # Never touch the default branch's worktree.
        if [ "$wt_branch" = "$default_branch" ]; then
            return 0
        fi

        # Restrict blast radius to agent worktrees under .claude/worktrees/.
        case "$wt_path" in
            "$candidates_dir"/*) : ;;
            *) return 0 ;;
        esac

        # Locked check via the marker file.
        local wt_base lock_marker
        wt_base="$(basename "$wt_path")"
        lock_marker="$common_dir/worktrees/$wt_base/locked"
        if [ -f "$lock_marker" ]; then
            return 0
        fi

        # Merged check: branch must be an ancestor of the default branch.
        if ! git -C "$toplevel" merge-base --is-ancestor "$wt_branch" "$default_branch" 2>/dev/null; then
            return 0
        fi

        # Clean working tree check.
        local status_out
        status_out="$(git -C "$wt_path" status --porcelain 2>/dev/null)"
        if [ -n "$status_out" ]; then
            return 0
        fi

        # Candidate qualifies for reaping.
        if [ "$dryrun" -eq 1 ]; then
            echo "DRYRUN: would remove worktree '$wt_path' (branch '$wt_branch')"
            return 0
        fi

        local ts
        ts="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
        if git -C "$toplevel" worktree remove "$wt_path" 2>>"$REAP_LOG"; then
            git -C "$toplevel" branch -d "$wt_branch" 2>>"$REAP_LOG" || true
            echo "$ts $toplevel $wt_branch" >>"$REAP_LOG"
            reaped_count=$((reaped_count + 1))
        else
            echo "$ts $toplevel FAILED_REMOVE $wt_branch" >>"$REAP_LOG"
        fi
    }

    while IFS= read -r line; do
        case "$line" in
            "worktree "*)
                wt_path="${line#worktree }"
                wt_branch=""
                ;;
            "branch "*)
                wt_branch="${line#branch refs/heads/}"
                ;;
            "")
                process_record
                wt_path=""
                wt_branch=""
                ;;
            *) : ;;
        esac
    done <<<"$porcelain"
    # Process the final record if the porcelain output had no trailing blank line.
    process_record

    if [ -f "$REAP_LOG" ]; then
        tail -500 "$REAP_LOG" >"$REAP_LOG.tmp" 2>/dev/null && mv "$REAP_LOG.tmp" "$REAP_LOG"
    fi

    git -C "$toplevel" worktree prune >/dev/null 2>&1 || true

    if [ "$reaped_count" -gt 0 ]; then
        echo "{\"systemMessage\":\"worktree-reap: removed $reaped_count merged worktree(s)\"}"
    fi

    return 0
}

main || true
exit 0
