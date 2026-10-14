# shell-integration.sh — source this from .zshrc OR .bashrc to make guarding
# and reaping automatic for node --test runs.
#
# Usage: add to your shell rc:
#   source "$HOME/.claude/skills/test-orphan-guard/assets/shell-integration.sh"
#
# Opt-in auto-reap (debounced to once per 60s, runs in background):
#   export TEST_ORPHAN_GUARD_AUTOREAP=1
#   (set BEFORE sourcing, or before the precmd/PROMPT_COMMAND fires)

# Safe under set -u: we only reference vars after guarding them.

TEST_ORPHAN_GUARD_DIR="${TEST_ORPHAN_GUARD_DIR:-$HOME/.claude/skills/test-orphan-guard}"

# ---------------------------------------------------------------------------
# `node` wrapper: route `node --test ...` through guarded-test.sh;
# pass everything else straight to the real node binary.
# Resolve the REAL binary at source time, bypassing the function itself.
# ---------------------------------------------------------------------------
if [[ -n "${ZSH_VERSION-}" ]]; then
  # zsh: use commands[] hash; fall back to whence -p
  _test_orphan_realnode="${commands[node]-}"
  if [[ -z "$_test_orphan_realnode" ]]; then
    _test_orphan_realnode="$(whence -p node 2>/dev/null || true)"
  fi
elif [[ -n "${BASH_VERSION-}" ]]; then
  _test_orphan_realnode="$(type -P node 2>/dev/null || true)"
else
  _test_orphan_realnode="$(command -v node 2>/dev/null || true)"
fi

node() {
  local _realnode="$_test_orphan_realnode"
  # Safety: if we couldn't resolve the real binary, fall back to command node
  if [[ -z "$_realnode" ]]; then
    command node "$@"
    return
  fi
  # Route --test invocations through the guard wrapper
  if [[ "$*" == *"--test"* ]]; then
    "$TEST_ORPHAN_GUARD_DIR/scripts/guarded-test.sh" "$_realnode" "$@"
  else
    "$_realnode" "$@"
  fi
}

# ---------------------------------------------------------------------------
# Convenience aliases
# ---------------------------------------------------------------------------
alias gtest="$TEST_ORPHAN_GUARD_DIR/scripts/guarded-test.sh"
alias reap-tests="$TEST_ORPHAN_GUARD_DIR/scripts/reap-test-orphans.sh"

# ---------------------------------------------------------------------------
# OPT-IN background autoreap (only when TEST_ORPHAN_GUARD_AUTOREAP=1)
# Debounced: at most once per 60 seconds using a timestamp file.
# Runs reap-test-orphans.sh --quiet in the background; never blocks the prompt.
# ---------------------------------------------------------------------------
_test_orphan_autoreap() {
  if [[ "${TEST_ORPHAN_GUARD_AUTOREAP-}" != "1" ]]; then
    return
  fi

  local stamp_file="$HOME/.cache/test-orphan-guard/last-autoreap"
  local now
  now="$(date +%s 2>/dev/null)" || return

  local last=0
  if [[ -f "$stamp_file" ]]; then
    last="$(cat "$stamp_file" 2>/dev/null)" || last=0
    # Guard against non-numeric content
    [[ "$last" =~ ^[0-9]+$ ]] || last=0
  fi

  local elapsed=$(( now - last ))
  if (( elapsed < 60 )); then
    return
  fi

  # Update timestamp before launching to prevent concurrent fires
  mkdir -p "$(dirname "$stamp_file")"
  printf '%s\n' "$now" > "$stamp_file"

  # Run in background, disowned, with all output suppressed
  "$TEST_ORPHAN_GUARD_DIR/scripts/reap-test-orphans.sh" --quiet \
    >/dev/null 2>&1 &
  disown "$!" 2>/dev/null || true
}

if [[ -n "${ZSH_VERSION-}" ]]; then
  # zsh: hook via precmd
  if [[ " ${precmd_functions[*]-} " == *" _test_orphan_autoreap "* ]]; then
    : # already registered (re-source guard)
  else
    precmd_functions+=(_test_orphan_autoreap)
  fi
elif [[ -n "${BASH_VERSION-}" ]]; then
  # bash: append to PROMPT_COMMAND (deduplicated)
  case "${PROMPT_COMMAND-}" in
    *_test_orphan_autoreap*) ;;  # already registered
    *)
      PROMPT_COMMAND="${PROMPT_COMMAND:+${PROMPT_COMMAND}; }_test_orphan_autoreap"
      ;;
  esac
fi

# Source-time output: intentionally silent.
