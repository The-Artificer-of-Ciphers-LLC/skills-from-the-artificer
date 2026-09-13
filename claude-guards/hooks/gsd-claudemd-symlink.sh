#!/bin/sh
# Symlink the canonical (gitignored) gsd-core CLAUDE.md into the current worktree.
# Registered as a global SessionStart hook in ~/.claude/settings.json.
# No-ops outside gsd-core worktrees and never clobbers an existing CLAUDE.md.
canonical="/Users/trekkie/projects/gsd-core/CLAUDE.md"
case "$PWD" in
  /Users/trekkie/projects/gsd-core/.claude/worktrees/*)
    [ -e "$canonical" ] || exit 0
    [ -e "$PWD/CLAUDE.md" ] && exit 0   # never overwrite an existing one
    ln -s "$canonical" "$PWD/CLAUDE.md"
    ;;
esac
exit 0
