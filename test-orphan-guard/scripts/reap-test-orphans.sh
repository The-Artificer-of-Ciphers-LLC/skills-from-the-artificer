#!/usr/bin/env bash
# reap-test-orphans.sh — kill leftover/runaway node --test processes
# SAFETY-CRITICAL: conservative over aggressive; prefer not killing.
# See skills/test-orphan-guard for full context.

export PATH="/usr/bin:/bin:/usr/sbin:/sbin:/opt/homebrew/bin:$PATH"

set -u
# NOTE: do NOT use set -e — individual ps calls on a just-died pid will fail, that's expected.

# ---------------------------------------------------------------------------
# Tunables (env-overridable)
# ---------------------------------------------------------------------------
CPU_THRESHOLD="${CPU_THRESHOLD:-20}"
RUNAWAY_AGE_SECONDS="${RUNAWAY_AGE_SECONDS:-180}"
CONFIRM_DELAY="${CONFIRM_DELAY:-2}"
TEST_MATCH="${TEST_MATCH:-(--test|\.test\.[cm]?js)}"
GUARD_STATE_DIR="${GUARD_STATE_DIR:-$HOME/.cache/test-orphan-guard}"

DRY_RUN="${DRY_RUN:-0}"
QUIET="${QUIET:-0}"

# ---------------------------------------------------------------------------
# Flag parsing
# ---------------------------------------------------------------------------
for _arg in "$@"; do
  case "$_arg" in
    --dry-run) DRY_RUN=1 ;;
    --quiet)   QUIET=1 ;;
    --help)
      cat <<'HELP'
Usage: reap-test-orphans.sh [--dry-run] [--quiet] [--help]

Kills leftover/runaway node --test processes.

Env vars (with defaults):
  CPU_THRESHOLD=20           % CPU to consider a process "hot"
  RUNAWAY_AGE_SECONDS=180    min age (seconds) for runaway classification
  CONFIRM_DELAY=2            seconds between two CPU samples for runaway confirm
  TEST_MATCH=...             ERE matching node --test command lines
  GUARD_STATE_DIR=~/.cache/test-orphan-guard
  DRY_RUN=1                  same as --dry-run
  QUIET=1                    same as --quiet

Classification:
  orphan   -- ppid == 1 (reparented to init; killed without second sample)
  runaway  -- %cpu >= CPU_THRESHOLD AND age >= RUNAWAY_AGE_SECONDS (confirmed
             by a second CPU sample taken CONFIRM_DELAY seconds later)

Safety exclusions:
  - This script's own PID and PPID
  - PIDs whose process group is registered in active-pgids (in-progress runs
    launched by guarded-test.sh)
  - Anything containing "node_repl" in the command line
HELP
      exit 0
      ;;
    --) ;;
    *)  ;;
  esac
done

# ---------------------------------------------------------------------------
# Helper: print only when NOT in quiet mode
# ---------------------------------------------------------------------------
log() {
  if [[ "$QUIET" != "1" ]]; then
    printf '%s\n' "$*"
  fi
}

# ---------------------------------------------------------------------------
# Helper: convert ps etime string -> seconds
# Handles: SS, MM:SS, HH:MM:SS, D-HH:MM:SS
# ---------------------------------------------------------------------------
etime_to_seconds() {
  local etime="$1"
  local days=0 hours=0 mins=0 secs=0

  # Strip leading/trailing whitespace
  etime="${etime#"${etime%%[! ]*}"}"
  etime="${etime%"${etime##*[! ]}"}"

  # Check for day prefix: D-HH:MM:SS
  if [[ "$etime" == *-* ]]; then
    days="${etime%%-*}"
    etime="${etime#*-}"
  fi

  # Count colons to figure out what's left
  local colon_count
  colon_count="$(printf '%s' "$etime" | tr -cd ':' | wc -c)"
  colon_count="${colon_count// /}"

  case "$colon_count" in
    0)  secs="$etime" ;;
    1)  mins="${etime%%:*}"; secs="${etime##*:}" ;;
    2)  hours="${etime%%:*}"; etime="${etime#*:}"; mins="${etime%%:*}"; secs="${etime##*:}" ;;
    *)  secs=0 ;;  # Unexpected format; treat as 0 (conservative: don't kill)
  esac

  # Strip leading zeros to avoid octal interpretation in arithmetic
  days=$((10#${days:-0}))
  hours=$((10#${hours:-0}))
  mins=$((10#${mins:-0}))
  secs=$((10#${secs:-0}))

  printf '%d' $(( days * 86400 + hours * 3600 + mins * 60 + secs ))
}

# ---------------------------------------------------------------------------
# Helper: compare floating-point CPU value to integer threshold
# Conservative: truncate (floor) so we only flag when clearly above threshold
# ---------------------------------------------------------------------------
cpu_above_threshold() {
  local cpu_str="$1"
  local threshold="$2"
  # Strip decimal part (floor)
  local cpu_int="${cpu_str%%.*}"
  # Guard against empty or non-numeric
  [[ "$cpu_int" =~ ^[0-9]+$ ]] || return 1
  (( cpu_int >= threshold ))
}

# ---------------------------------------------------------------------------
# Helper: extract the "test file" from a command string
# Last token looking like a path or ending in .cjs/.js/.mjs; else last token
# ---------------------------------------------------------------------------
extract_testfile() {
  local cmd="$1"
  local last_path=""
  local last_token=""
  local token
  for token in $cmd; do
    last_token="$token"
    if [[ "$token" == *"/"* ]] || [[ "$token" =~ \.(c?js|mjs)$ ]]; then
      last_path="$token"
    fi
  done
  if [[ -n "$last_path" ]]; then
    printf '%s' "$last_path"
  else
    printf '%s' "$last_token"
  fi
}

# ---------------------------------------------------------------------------
# Setup: ensure state dir and active-pgids file exist
# ---------------------------------------------------------------------------
mkdir -p "$GUARD_STATE_DIR"
touch "$GUARD_STATE_DIR/active-pgids" 2>/dev/null || true

# ---------------------------------------------------------------------------
# Prune the active-pgids registry: remove pgids with no live process
# ---------------------------------------------------------------------------
prune_registry() {
  local registry="$GUARD_STATE_DIR/active-pgids"
  local tmp_registry
  tmp_registry="$(mktemp "$GUARD_STATE_DIR/.pgids-prune.XXXXXX")"
  while IFS= read -r pgid; do
    [[ -z "$pgid" ]] && continue
    [[ ! "$pgid" =~ ^[0-9]+$ ]] && continue
    if pgrep -g "$pgid" >/dev/null 2>&1; then
      printf '%s\n' "$pgid" >> "$tmp_registry"
    fi
  done < "$registry"
  mv "$tmp_registry" "$registry"
}

prune_registry

# Load active pgids into an indexed array (numeric pgid keys) for lookup
declare -a ACTIVE_PGIDS
while IFS= read -r pgid; do
  [[ -z "$pgid" ]] && continue
  [[ ! "$pgid" =~ ^[0-9]+$ ]] && continue
  ACTIVE_PGIDS["$pgid"]=1
done < "$GUARD_STATE_DIR/active-pgids"

MY_PID=$$
MY_PPID=$PPID

# ---------------------------------------------------------------------------
# PASS 1: enumerate candidates via pgrep -f node
# ---------------------------------------------------------------------------
declare -a TARGET_PIDS=()
# Indexed array (numeric pid keys): pid -> "ppid|etime|cpu|age_secs|reason|cmd"
declare -a PID_INFO=()

# Pids whose classification is ONLY runaway (not also orphan) need second sample
declare -a RUNAWAY_ONLY_PIDS=()

while IFS= read -r pid; do
  [[ -z "$pid" ]] && continue
  [[ ! "$pid" =~ ^[0-9]+$ ]] && continue

  # Skip self and parent
  [[ "$pid" == "$MY_PID" ]] && continue
  [[ "$pid" == "$MY_PPID" ]] && continue

  # Read process details in a single ps call; fails gracefully if pid is gone
  local_info="$(ps -ww -o ppid=,stat=,etime=,%cpu=,command= -p "$pid" 2>/dev/null)"
  [[ -z "$local_info" ]] && continue

  # Parse: ppid stat etime %cpu command...
  # We read the first 4 fields as tokens; the rest is the command.
  read -r ppid stat etime cpu rest_cmd <<< "$local_info"

  cmd="$rest_cmd"

  # Require all key fields
  [[ -z "$ppid" ]]  && continue
  [[ -z "$etime" ]] && continue
  [[ -z "$cpu" ]]   && continue
  [[ -z "$cmd" ]]   && continue

  # Must be a TEST process: command matches TEST_MATCH (ERE)
  if ! printf '%s' "$cmd" | grep -qE "$TEST_MATCH"; then
    continue
  fi

  # Must NOT contain node_repl
  if printf '%s' "$cmd" | grep -q 'node_repl'; then
    continue
  fi

  # Check process-group safety exclusion
  local_pgid="$(ps -o pgid= -p "$pid" 2>/dev/null)"
  local_pgid="${local_pgid// /}"  # trim all spaces
  if [[ -n "$local_pgid" ]] && [[ "${ACTIVE_PGIDS[$local_pgid]+_}" ]]; then
    continue  # member of an active guarded run -- skip
  fi

  # Compute age in seconds
  age_secs="$(etime_to_seconds "$etime")"

  # Classify
  reason=""
  ppid_trimmed="${ppid// /}"

  # Orphan: ppid == 1
  if [[ "$ppid_trimmed" == "1" ]]; then
    reason="orphan"
  fi

  # Runaway: high CPU AND old enough
  if cpu_above_threshold "$cpu" "$CPU_THRESHOLD" && (( age_secs >= RUNAWAY_AGE_SECONDS )); then
    if [[ -z "$reason" ]]; then
      reason="runaway"
    else
      reason="orphan+runaway"
    fi
  fi

  [[ -z "$reason" ]] && continue

  # Store for reporting and second-pass
  PID_INFO["$pid"]="${ppid_trimmed}|${etime}|${cpu}|${age_secs}|${reason}|${cmd}"
  TARGET_PIDS+=("$pid")

  if [[ "$reason" == "runaway" ]]; then
    RUNAWAY_ONLY_PIDS+=("$pid")
  fi

done < <(pgrep -f node 2>/dev/null)

# ---------------------------------------------------------------------------
# PASS 2: confirm runaway-only pids with a second CPU sample
# ---------------------------------------------------------------------------
if (( ${#RUNAWAY_ONLY_PIDS[@]} > 0 )); then
  sleep "$CONFIRM_DELAY"

  declare -a CONFIRMED_TARGETS=()
  for pid in "${TARGET_PIDS[@]}"; do
    info="${PID_INFO[$pid]+}"
    [[ -z "${PID_INFO[$pid]+_}" ]] && continue
    info="${PID_INFO[$pid]}"
    reason="$(printf '%s' "$info" | cut -d'|' -f5)"

    if [[ "$reason" == "runaway" ]]; then
      # Re-read CPU for second sample
      cpu2="$(ps -ww -o %cpu= -p "$pid" 2>/dev/null)"
      cpu2="${cpu2// /}"
      if [[ -z "$cpu2" ]]; then
        # Process gone -- drop from targets
        unset "PID_INFO[$pid]"
        continue
      fi
      if cpu_above_threshold "$cpu2" "$CPU_THRESHOLD"; then
        CONFIRMED_TARGETS+=("$pid")
      else
        # CPU dropped -- not a confirmed runaway; don't kill (conservative)
        unset "PID_INFO[$pid]"
      fi
    else
      # orphan or orphan+runaway -- no second sample needed
      CONFIRMED_TARGETS+=("$pid")
    fi
  done

  TARGET_PIDS=("${CONFIRMED_TARGETS[@]+"${CONFIRMED_TARGETS[@]}"}")
fi

# ---------------------------------------------------------------------------
# No targets?
# ---------------------------------------------------------------------------
if (( ${#TARGET_PIDS[@]} == 0 )); then
  log "No leftover test processes found."
  exit 0
fi

# ---------------------------------------------------------------------------
# Print table (used in both dry-run and live-kill paths)
# ---------------------------------------------------------------------------
print_table() {
  printf '%-8s %-8s %-12s %-8s %-14s %s\n' \
    "PID" "PPID" "AGE" "%CPU" "REASON" "TESTFILE"
  printf '%-8s %-8s %-12s %-8s %-14s %s\n' \
    "-------" "-------" "-----------" "-------" "-------------" "--------"
  local pid
  for pid in "${TARGET_PIDS[@]}"; do
    [[ -z "${PID_INFO[$pid]+_}" ]] && continue
    local info="${PID_INFO[$pid]}"
    local ppid;     ppid="$(printf '%s' "$info" | cut -d'|' -f1)"
    local etime;    etime="$(printf '%s' "$info" | cut -d'|' -f2)"
    local cpu;      cpu="$(printf '%s' "$info" | cut -d'|' -f3)"
    local reason;   reason="$(printf '%s' "$info" | cut -d'|' -f5)"
    local cmd;      cmd="$(printf '%s' "$info" | cut -d'|' -f6-)"
    local testfile; testfile="$(extract_testfile "$cmd")"
    printf '%-8s %-8s %-12s %-8s %-14s %s\n' \
      "$pid" "$ppid" "$etime" "$cpu" "$reason" "$testfile"
  done
}

if [[ "$DRY_RUN" == "1" ]]; then
  printf '[dry-run] would kill:\n'
  print_table
  exit 0
fi

# ---------------------------------------------------------------------------
# Kill phase
# ---------------------------------------------------------------------------
# In non-quiet mode, show the table before killing
if [[ "$QUIET" != "1" ]]; then
  printf 'Reaping %d test process(es):\n' "${#TARGET_PIDS[@]}"
  print_table
fi

# SIGTERM all targets — array expansion: each pid is its own arg (NOT a joined string)
kill -TERM "${TARGET_PIDS[@]}" 2>/dev/null || true

sleep 2

# Identify survivors
declare -a SURVIVORS=()
for pid in "${TARGET_PIDS[@]}"; do
  if ps -p "$pid" >/dev/null 2>&1; then
    SURVIVORS+=("$pid")
  fi
done

# SIGKILL survivors
if (( ${#SURVIVORS[@]} > 0 )); then
  kill -KILL "${SURVIVORS[@]}" 2>/dev/null || true
  sleep 1
fi

# Final count
terminated=0
force_killed=0

for pid in "${TARGET_PIDS[@]}"; do
  if ps -p "$pid" >/dev/null 2>&1; then
    : # still alive after SIGKILL -- unusual; just note it
    continue
  fi
  # Determine if it was a survivor (force-killed) or fell on first SIGTERM
  was_survivor=0
  for s in "${SURVIVORS[@]+"${SURVIVORS[@]}"}"; do
    if [[ "$s" == "$pid" ]]; then
      was_survivor=1
      break
    fi
  done
  if (( was_survivor )); then
    (( force_killed++ )) || true
  else
    (( terminated++ )) || true
  fi
done

total_reaped=$(( terminated + force_killed ))

# In quiet mode, only print this summary line (and only when something was reaped)
if (( total_reaped > 0 )); then
  printf 'Reaped %d test process(es): %d terminated, %d force-killed\n' \
    "$total_reaped" "$terminated" "$force_killed"
fi

exit 0
