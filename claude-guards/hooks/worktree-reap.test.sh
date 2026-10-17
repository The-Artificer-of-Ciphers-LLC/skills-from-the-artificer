#!/bin/bash
# worktree-reap.test.sh - behavioural tests for worktree-reap.sh using real
# temporary git repos, a bare "origin", and a fake `gh` on PATH.
#
#   bash claude-guards/hooks/worktree-reap.test.sh
set -u

HERE="$(cd "$(dirname "$0")" && pwd)"
HOOK="$HERE/worktree-reap.sh"
PASS=0; FAIL=0
T="$(cd "$(mktemp -d)" && pwd -P)"   # real path: git reports /private/var, not /var, on macOS
trap 'rm -rf "$T"' EXIT

ok()   { PASS=$((PASS+1)); echo "  ok   $1"; }
bad()  { FAIL=$((FAIL+1)); echo "  FAIL $1"; }
check() { # check <description> <command...> : passes when the command succeeds
    local d="$1"; shift
    if "$@" >/dev/null 2>&1; then ok "$d"; else bad "$d"; fi
}
has_branch()    { git -C "$REPO" show-ref --verify --quiet "refs/heads/$1"; }
has_remote()    { git -C "$REPO" ls-remote --exit-code --heads origin "$1" >/dev/null 2>&1; }
has_worktree()  { git -C "$REPO" worktree list --porcelain | grep -q "^worktree $1\$"; }
gone_branch()   { ! has_branch "$1"; }
gone_remote()   { ! has_remote "$1"; }
gone_worktree() { ! has_worktree "$1"; }

# ---- fake gh ---------------------------------------------------------------
FAKE_BIN="$T/bin"; FAKE_DIR="$T/fakegh"; mkdir -p "$FAKE_BIN" "$FAKE_DIR/merged" "$FAKE_DIR/open-base"
cat >"$FAKE_BIN/gh" <<'EOF'
#!/bin/bash
[ "${FAKE_GH_FAIL:-0}" = 1 ] && exit 1
state=""; head=""; base=""
while [ $# -gt 0 ]; do
  case "$1" in --state) state="$2"; shift ;; --head) head="$2"; shift ;; --base) base="$2"; shift ;; esac
  shift
done
f=""
[ "$state" = merged ] && f="$FAKE_GH_DIR/merged/${head//\//__}"
[ "$state" = open ]   && f="$FAKE_GH_DIR/open-base/${base//\//__}"
[ -n "$f" ] && [ -f "$f" ] && cat "$f"
exit 0
EOF
chmod +x "$FAKE_BIN/gh"
export FAKE_GH_DIR="$FAKE_DIR"

fake_merged() { # fake_merged <branch> <headsha> <base> <mergesha>
    echo "$2 $3 $4" >"$FAKE_DIR/merged/${1//\//__}"
}
fake_open_child() { echo 7 >"$FAKE_DIR/open-base/${1//\//__}"; }

# ---- fixture ---------------------------------------------------------------
new_repo() {
    rm -rf "$T/origin.git" "$T/repo" "$FAKE_DIR"/merged/* "$FAKE_DIR"/open-base/* "$T/log" "$T"/stamp*
    mkdir -p "$T/stamp"
    git init -q --bare -b main "$T/origin.git"
    git clone -q "$T/origin.git" "$T/repo" 2>/dev/null
    REPO="$T/repo"
    git -C "$REPO" config user.email t@t; git -C "$REPO" config user.name t
    git -C "$REPO" checkout -q -b main 2>/dev/null
    echo base >"$REPO/f"; git -C "$REPO" add f; git -C "$REPO" commit -q -m base
    git -C "$REPO" push -q -u origin main 2>/dev/null
    mkdir -p "$REPO/.claude/worktrees"
}
# branch with one commit, pushed, then SQUASH-merged into main (not an ancestor)
squash_merged_branch() { # <branch> -> sets TIP, MERGE
    local b="$1"
    git -C "$REPO" checkout -q -b "$b" main
    echo "$b" >"$REPO/$(echo "$b" | tr / _)"; git -C "$REPO" add -A; git -C "$REPO" commit -q -m "work $b"
    TIP="$(git -C "$REPO" rev-parse HEAD)"
    git -C "$REPO" push -q origin "$b" 2>/dev/null
    git -C "$REPO" checkout -q main
    git -C "$REPO" merge -q --squash "$b" >/dev/null 2>&1
    git -C "$REPO" commit -q -m "squash $b (#1)"
    MERGE="$(git -C "$REPO" rev-parse HEAD)"
    git -C "$REPO" push -q origin main 2>/dev/null
}
run_hook() { # extra env as args; stdin is a SessionStart payload
    ( cd "$REPO" && echo '{"hook_event_name":"SessionStart"}' | env \
        PATH="$FAKE_BIN:$PATH" WORKTREE_REAP_LOG="$T/log" WORKTREE_REAP_STAMP_DIR="$T/stamp" \
        WORKTREE_REAP_MIN_AGE_SECONDS=0 "$@" bash "$HOOK" )
}

echo "== squash-merged branch, PR head == local tip, merge commit in main"
new_repo; squash_merged_branch feat/a; fake_merged feat/a "$TIP" main "$MERGE"
run_hook >/dev/null
check "local branch deleted" gone_branch feat/a
check "remote branch kept by default" has_remote feat/a
check "main untouched" has_branch main

echo "== a commit added after the PR head (tip != headRefOid)"
new_repo; squash_merged_branch feat/b; fake_merged feat/b "$TIP" main "$MERGE"
git -C "$REPO" checkout -q feat/b; echo extra >"$REPO/extra"; git -C "$REPO" add -A; git -C "$REPO" commit -q -m extra; git -C "$REPO" checkout -q main
run_hook >/dev/null
check "branch kept (has work after merge)" has_branch feat/b

echo "== merged PR whose base is not the default branch (stacked PR)"
new_repo; squash_merged_branch feat/c; fake_merged feat/c "$TIP" feat/other "$MERGE"
run_hook >/dev/null
check "branch kept (landed in another branch, not main)" has_branch feat/c

echo "== merge commit not yet in local main"
new_repo; squash_merged_branch feat/d; fake_merged feat/d "$TIP" main "0000000000000000000000000000000000000000"
run_hook >/dev/null
check "branch kept (merge commit unknown locally)" has_branch feat/d

echo "== no PR at all / gh failing"
new_repo; squash_merged_branch feat/e
run_hook >/dev/null
check "branch kept with no PR record" has_branch feat/e
fake_merged feat/e "$TIP" main "$MERGE"
run_hook FAKE_GH_FAIL=1 >/dev/null
check "branch kept when gh fails" has_branch feat/e
run_hook WORKTREE_REAP_NO_GH=1 >/dev/null
check "branch kept when gh disabled" has_branch feat/e

echo "== plain unmerged branch"
new_repo; git -C "$REPO" checkout -q -b feat/wip main; echo w >"$REPO/w"; git -C "$REPO" add -A; git -C "$REPO" commit -q -m wip; git -C "$REPO" checkout -q main
run_hook >/dev/null
check "unmerged branch kept" has_branch feat/wip

echo "== ancestor (merge-commit style) branch needs age"
new_repo; git -C "$REPO" branch feat/old main
run_hook WORKTREE_REAP_MIN_AGE_SECONDS=999999 >/dev/null
check "fresh ancestor branch kept under default age" has_branch feat/old
run_hook >/dev/null
check "ancestor branch deleted once old enough" gone_branch feat/old

echo "== default branch and checked-out branch are never deleted"
new_repo; squash_merged_branch feat/f; fake_merged feat/f "$TIP" main "$MERGE"
git -C "$REPO" checkout -q feat/f
run_hook >/dev/null
check "checked-out branch kept" has_branch feat/f
check "default branch kept" has_branch main

echo "== worktrees"
new_repo; squash_merged_branch feat/g; fake_merged feat/g "$TIP" main "$MERGE"
WT="$REPO/.claude/worktrees/g"; git -C "$REPO" worktree add -q "$WT" feat/g
check "fixture: worktree is registered before the hook runs" has_worktree "$WT"
run_hook >/dev/null
check "clean landed worktree removed" gone_worktree "$WT"
check "its branch deleted" gone_branch feat/g

new_repo; squash_merged_branch feat/h; fake_merged feat/h "$TIP" main "$MERGE"
WT="$REPO/.claude/worktrees/h"; git -C "$REPO" worktree add -q "$WT" feat/h; echo dirty >"$WT/untracked"
run_hook >/dev/null
check "dirty worktree kept" has_worktree "$WT"
check "its branch kept" has_branch feat/h

new_repo; squash_merged_branch feat/i; fake_merged feat/i "$TIP" main "$MERGE"
WT="$REPO/.claude/worktrees/i"; git -C "$REPO" worktree add -q "$WT" feat/i
run_hook WORKTREE_REAP_MIN_AGE_SECONDS=999999 >/dev/null
check "recently active worktree kept" has_worktree "$WT"

new_repo; squash_merged_branch feat/j; fake_merged feat/j "$TIP" main "$MERGE"
WT="$REPO/.claude/worktrees/j"; git -C "$REPO" worktree add -q "$WT" feat/j; git -C "$REPO" worktree lock "$WT"
run_hook >/dev/null
check "locked worktree kept" has_worktree "$WT"

new_repo; squash_merged_branch feat/k; fake_merged feat/k "$TIP" main "$MERGE"
WT="$T/outside-k"; git -C "$REPO" worktree add -q "$WT" feat/k
run_hook >/dev/null
check "worktree outside .claude/worktrees kept" has_worktree "$WT"
check "branch checked out there kept" has_branch feat/k

new_repo; squash_merged_branch feat/l; fake_merged feat/l "$TIP" main "$MERGE"
WT="$REPO/.claude/worktrees/l"; git -C "$REPO" worktree add -q "$WT" feat/l
( cd "$WT" && echo '{"hook_event_name":"SessionStart"}' | env PATH="$FAKE_BIN:$PATH" WORKTREE_REAP_LOG="$T/log" \
    WORKTREE_REAP_STAMP_DIR="$T/stamp" WORKTREE_REAP_MIN_AGE_SECONDS=0 bash "$HOOK" >/dev/null )
check "run from inside the worktree itself: it is protected by its live cwd" has_worktree "$WT"

echo "== dry run"
new_repo; squash_merged_branch feat/m; fake_merged feat/m "$TIP" main "$MERGE"
OUT="$(run_hook WORKTREE_REAP_DRYRUN=1)"
check "dry run deletes nothing" has_branch feat/m
check "dry run reports the branch" grep -q "would delete local branch 'feat/m'" <<<"$OUT"

echo "== dry run reports remote deletion for worktree-backed branches"
new_repo; squash_merged_branch feat/dw; fake_merged feat/dw "$TIP" main "$MERGE"
WT="$REPO/.claude/worktrees/dw"; git -C "$REPO" worktree add -q "$WT" feat/dw
OUT="$(run_hook WORKTREE_REAP_DRYRUN=1 WORKTREE_REAP_REMOTE=1)"
check "dry run lists the worktree" grep -q "would remove worktree" <<<"$OUT"
check "dry run lists the remote branch too" grep -q "would delete remote branch 'origin/feat/dw'" <<<"$OUT"
check "dry run still removed nothing" has_worktree "$WT"
check "dry run left the remote branch" has_remote feat/dw

echo "== remote deletion (opt-in)"
new_repo; squash_merged_branch feat/n; fake_merged feat/n "$TIP" main "$MERGE"
run_hook WORKTREE_REAP_REMOTE=1 >/dev/null
check "local deleted" gone_branch feat/n
check "remote deleted when opted in and tips match" gone_remote feat/n

new_repo; squash_merged_branch feat/o; fake_merged feat/o "$TIP" main "$MERGE"; fake_open_child feat/o
run_hook WORKTREE_REAP_REMOTE=1 >/dev/null
check "remote kept when an open PR is based on it" has_remote feat/o

new_repo; squash_merged_branch feat/p; fake_merged feat/p "$TIP" main "$MERGE"
git -C "$REPO" checkout -q feat/p; echo r >"$REPO/r"; git -C "$REPO" add -A; git -C "$REPO" commit -q -m r
git -C "$REPO" push -q origin feat/p 2>/dev/null; git -C "$REPO" reset -q --hard "$TIP"; git -C "$REPO" checkout -q main
run_hook WORKTREE_REAP_REMOTE=1 >/dev/null
check "remote kept when remote tip differs from local tip" has_remote feat/p

echo "== gh throttle"
new_repo; squash_merged_branch feat/q; fake_merged feat/q "$TIP" main "$MERGE"
touch "$T/stamp/.worktree-reap-gh-$(printf '%s' "$REPO" | cksum | awk '{print $1}')"
( cd "$REPO" && echo '{"tool_input":{"command":"ls"}}' | env PATH="$FAKE_BIN:$PATH" WORKTREE_REAP_LOG="$T/log" \
    WORKTREE_REAP_STAMP_DIR="$T/stamp" WORKTREE_REAP_MIN_AGE_SECONDS=0 bash "$HOOK" >/dev/null )
check "no gh call for an unrelated command within the interval" has_branch feat/q
( cd "$REPO" && echo '{"tool_input":{"command":"gh pr merge 5 --squash"}}' | env PATH="$FAKE_BIN:$PATH" WORKTREE_REAP_LOG="$T/log" \
    WORKTREE_REAP_STAMP_DIR="$T/stamp" WORKTREE_REAP_MIN_AGE_SECONDS=0 bash "$HOOK" >/dev/null )
check "gh pr merge triggers an immediate sweep" gone_branch feat/q

echo
echo "passed: $PASS  failed: $FAIL"
[ "$FAIL" -eq 0 ]
