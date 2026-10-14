#!/usr/bin/env bash
# guarded-test.sh — run a test command in its own process group and guarantee
# the whole group is torn down when the command exits for ANY reason
# (success, failure, Ctrl-C), so no child node processes leak.
#
# Usage: guarded-test.sh <command> [args...]
#
# NOTE: kill of -PGID uses the negative-pid form. Under `set -m` (job control),
# the backgrounded child becomes its own process-group leader, meaning its
# pgid == its pid. Sending SIGTERM/-PGID therefore kills the whole group.

export PATH="/usr/bin:/bin:/usr/sbin:/sbin:/opt/homebrew/bin:$PATH"

set -u
# NOTE: do NOT use set -e; we want to capture the child's exit code cleanly.

GUARD_STATE_DIR="${GUARD_STATE_DIR:-$HOME/.cache/test-orphan-guard}"

# ---------------------------------------------------------------------------
# Usage guard
# ---------------------------------------------------------------------------
if (( $# == 0 )); then
  printf 'Usage: guarded-test.sh <command> [args...]\n' >&2
  exit 2
fi

mkdir -p "$GUARD_STATE_DIR"
touch "$GUARD_STATE_DIR/active-pgids" 2>/dev/null || true

# ---------------------------------------------------------------------------
# Enable job control so the backgrounded child becomes its own process-group
# leader (pgid == child pid). This is what makes `kill -TERM -"$child"` work.
# ---------------------------------------------------------------------------
set -m

# ---------------------------------------------------------------------------
# Launch the test command in the background
# ---------------------------------------------------------------------------
"$@" &
child=$!

# ---------------------------------------------------------------------------
# Register the child's pgid in the active-pgids registry so that
# reap-test-orphans.sh won't kill processes that belong to this live run.
# Under set -m, pgid == pid for the group leader (our child).
# ---------------------------------------------------------------------------
printf '%s\n' "$child" >> "$GUARD_STATE_DIR/active-pgids"

# ---------------------------------------------------------------------------
# Cleanup: idempotent (guarded by _cleanup_ran flag)
# Sends SIGTERM to the entire process group, waits, then SIGKILL survivors.
# Then removes this child's pgid from the registry.
# ---------------------------------------------------------------------------
_cleanup_ran=0

cleanup() {
  if (( _cleanup_ran )); then
    return
  fi
  _cleanup_ran=1

  # Terminate the whole process group (negative-pid = process group signal)
  kill -TERM -"$child" 2>/dev/null || true
  sleep 2
  # Force-kill any survivors in the group
  kill -KILL -"$child" 2>/dev/null || true

  # Remove $child from the active-pgids registry.
  # Use a temp file + mv to avoid relying on `sed -i` (BSD/GNU differ).
  local registry="$GUARD_STATE_DIR/active-pgids"
  local tmp_registry
  tmp_registry="$(mktemp "$GUARD_STATE_DIR/.pgids-cleanup.XXXXXX")"
  # grep -vx: remove lines that are exactly "$child" (numeric pgid match)
  grep -vx "$child" "$registry" > "$tmp_registry" 2>/dev/null || true
  mv "$tmp_registry" "$registry"
}

trap cleanup EXIT INT TERM

# ---------------------------------------------------------------------------
# Wait for the child and capture its exit code.
# The EXIT trap (cleanup) will run after wait returns.
# ---------------------------------------------------------------------------
wait "$child"
rc=$?

exit $rc
