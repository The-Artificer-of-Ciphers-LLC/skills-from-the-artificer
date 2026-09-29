#!/usr/bin/env bash
# PreToolUse(Bash) guard: a gsd-test / gsd-verify-and-record.cjs dispatch that
# passes every FORM check (has --bench, has nohup, tree is clean, single
# flight) can still be launched against a runner that cannot actually RUN.
# The sibling guards in this family all enforce the SHAPE of the dispatch;
# none of them checks whether the environment underneath it is viable.
#
# Verified incidents, both 2026-09-13 on a freshly-migrated workstation:
#   (a) the legacy pre-Go bash `gsd-test` script was still on PATH. It has no
#       --base/--head/--bench flags and targets a `gsd-test:node22` image that
#       no longer exists. Dispatch exited 125 with "pull access denied" after
#       burning a full round trip.
#   (b) after installing the Go client, there was no local `docker` binary.
#       The Go runner shells out to `docker` with DOCKER_HOST=ssh://<bench>
#       (internal/dockerexec/dockerexec.go). With no docker CLI the run
#       produced ZERO containers and hung for 26 minutes in total silence
#       before being killed. Containers should appear within seconds.
#
# strip_heredocs / GSD_HUMAN_OVERRIDE=1 early exit / unwrap_dash_c / the
# open+chain+gsd_target+pos_pattern command-position detector and its
# is_invocation gate / the deny() JSON shape / the --dry-run early exit are
# reused VERBATIM from gsd-bench-pin-guard.sh so this guard cannot drift from
# what the rest of the family agrees counts as a real dispatch.
#
# Checks run cheapest-first and SHORT-CIRCUIT: all local (instant) checks
# before the one remote (network-bound) check, and the first failure denies
# immediately. This keeps the guard well inside the hook timeout even when
# the bench is unreachable.
set -euo pipefail

input="$(cat)"
cmd="$(printf '%s' "$input" | jq -r '.tool_input.command // empty' 2>/dev/null || true)"
[ -z "$cmd" ] && exit 0

# Heredoc BODIES are data, not commands -- a doc/fixture that merely QUOTES an
# example invocation must not be denied. Copied verbatim from
# gsd-async-poll-guard.sh / gsd-test-clean-tree-guard.sh.
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
cmd_scan="$(strip_heredocs "$cmd")"

if printf '%s' "$cmd" | grep -q 'GSD_HUMAN_OVERRIDE=1'; then
  exit 0
fi

# Unwrap the literal quoted PAYLOAD of a `bash -c "..."` / `sh -c '...'`
# argument -- and ONLY that specific argument -- so its content becomes plain
# unquoted text sitting in command position right after `-c`. Copied verbatim
# from gsd-async-poll-guard.sh.
unwrap_dash_c() {
  printf '%s' "$1" \
    | sed -E 's/((bash|sh)[[:space:]]+-c[[:space:]]+)"([^"]*)"/\1\3/g' \
    | sed -E "s/((bash|sh)[[:space:]]+-c[[:space:]]+)'([^']*)'/\1\3/g"
}
cmd_unwrapped="$(unwrap_dash_c "$cmd_scan")"

# Command-POSITION detection, not substring detection -- copied verbatim from
# gsd-async-poll-guard.sh / gsd-bench-pin-guard.sh. Note we match against
# cmd_unwrapped, NOT a mask_quotes'd variant (see gsd-bench-pin-guard.sh
# header for why mask_quotes is skipped here).
open='(^|[;&|{(!]|(^|[^[:alnum:]_-])(do|then|else|while|until))'
chain='((nohup|env|time|sudo|xargs)[[:space:]]+|node[[:space:]]+|(bash|sh)[[:space:]]+-c[[:space:]]+)*'
gsd_target='(gsd-test|gsd-verify-and-record(\.cjs)?)'
pos_pattern="${open}[[:space:]]*${chain}[\"']?[[:alnum:]_./-]*${gsd_target}([^[:alnum:]_-]|\$)"

is_invocation=0
if printf '%s' "$cmd_unwrapped" | grep -Eq "$pos_pattern"; then
  is_invocation=1
fi
[ "$is_invocation" -eq 1 ] || exit 0

deny() {
  jq -n --arg r "$1" '{hookSpecificOutput:{hookEventName:"PreToolUse",permissionDecision:"deny",permissionDecisionReason:$r}}'
  exit 0
}

# --dry-run is decision-only and burns no bench capacity -- let it through
# without a viability check.
if printf '%s' "$cmd_unwrapped" | grep -Eq '(^|[[:space:]])--dry-run([[:space:]]|=|$)'; then
  exit 0
fi

# --- 1. LOCAL: docker client present -----------------------------------
if ! command -v docker >/dev/null 2>&1; then
  deny "gsd-test-viability-guard BLOCKED — no local \`docker\` binary on PATH.

The Go runner shells out to the local \`docker\` CLI with
DOCKER_HOST=ssh://<bench> to talk to the remote daemon (see
internal/dockerexec/dockerexec.go in gsd-test-runner). Without a docker
client here, the run can never start a container. On 2026-09-13 this exact
gap produced ZERO containers on the bench and hung in total silence for 26
minutes before being killed — containers should appear within seconds.

Remedy (client only — the daemon stays remote, do not install Docker
Desktop or start a local daemon):
  brew install docker

(Human-only escape, never for the agent: re-issue prefixed with
GSD_HUMAN_OVERRIDE=1.)"
fi

# --- 2. LOCAL: gsd-test present ------------------------------------------
if ! command -v gsd-test >/dev/null 2>&1; then
  deny "gsd-test-viability-guard BLOCKED — no \`gsd-test\` binary on PATH.

There is nothing here for the dispatch to invoke.

Remedy: install the Go release binary from open-gsd/gsd-test-runner.

(Human-only escape, never for the agent: re-issue prefixed with
GSD_HUMAN_OVERRIDE=1.)"
fi

# --- 3. LOCAL: it's the Go client, not the legacy bash script -----------
help_out="$(gsd-test --help 2>&1 || true)"
if ! printf '%s' "$help_out" | grep -q -- '-head' || ! printf '%s' "$help_out" | grep -q -- '-bench'; then
  deny "gsd-test-viability-guard BLOCKED — \`gsd-test\` on PATH is the legacy
bash client, not the Go runner.

The legacy pre-Go bash \`gsd-test\` script has no --base/--head/--bench flags
and targets a \`gsd-test:node22\` image that no longer exists. On 2026-09-13
a dispatch through it exited 125 with \"pull access denied\" after burning a
full round trip.

Remedy: install the Go release binary from open-gsd/gsd-test-runner and make
sure it comes before the legacy script on PATH.

(Human-only escape, never for the agent: re-issue prefixed with
GSD_HUMAN_OVERRIDE=1.)"
fi

# --- 4. LOCAL: config.toml exists, not the legacy `hosts` layout --------
config_path="$HOME/.config/gsd-test/config.toml"
if [ ! -f "$config_path" ]; then
  deny "gsd-test-viability-guard BLOCKED — no config.toml at
$config_path.

The Go client reads config.toml. A bare \`hosts\` file in that directory is
the legacy layout and means a stale install.

Remedy: get the real config from your documented setup in
docs/configuration.md in the gsd-test-runner repo. Do NOT hand-write or
invent a config.toml — pull the one your setup actually documents.

(Human-only escape, never for the agent: re-issue prefixed with
GSD_HUMAN_OVERRIDE=1.)"
fi

# --- 5. LOCAL: named bench actually exists in config.toml ---------------
bench="$(printf '%s' "$cmd_unwrapped" | sed -nE "s/.*--bench[[:space:]=]+[\"']?([A-Za-z0-9_.-]+).*/\1/p" | head -1)"

if [ -n "$bench" ]; then
  if ! grep -Eq "name[[:space:]]*=[[:space:]]*[\"']?${bench}[\"']?" "$config_path"; then
    known="$(grep -E 'name[[:space:]]*=' "$config_path" | tr -d '\r' | sed -E 's/^[[:space:]]*//' | tr '\n' '|' | sed -E 's/\|$//; s/\|/, /g')"
    deny "gsd-test-viability-guard BLOCKED — --bench '$bench' does not appear
in $config_path.

No \`name = \"$bench\"\` line was found under a [[benches]] block.

name = lines actually found: ${known:-<none found>}

Remedy: pin to a bench that is actually configured, or get an updated
config.toml from your documented setup (do not hand-write one).

(Human-only escape, never for the agent: re-issue prefixed with
GSD_HUMAN_OVERRIDE=1.)"
  fi
fi

# --- 6. REMOTE: bench docker daemon answers, bounded, one retry ---------
if [ -n "$bench" ]; then
  probe_daemon() {
    DOCKER_HOST="ssh://${bench}" docker version --format '{{.Server.Version}}' >/tmp/gsd-test-viability-guard.$$.out 2>&1 &
    local pid=$!
    local waited=0
    while kill -0 "$pid" 2>/dev/null; do
      if [ "$waited" -ge 12 ]; then
        kill -9 "$pid" 2>/dev/null || true
        wait "$pid" 2>/dev/null || true
        rm -f /tmp/gsd-test-viability-guard.$$.out
        return 1
      fi
      sleep 1
      waited=$((waited + 1))
    done
    wait "$pid" 2>/dev/null
    local rc=$?
    rm -f /tmp/gsd-test-viability-guard.$$.out
    return $rc
  }

  if ! probe_daemon; then
    if ! probe_daemon; then
      deny "gsd-test-viability-guard BLOCKED — bench '$bench' did not answer a
bounded docker version probe (two attempts).

Reproduce directly:
  DOCKER_HOST=\"ssh://$bench\" docker version --format '{{.Server.Version}}'

If this is a one-off transient ssh hiccup, retrying by hand may succeed —
this guard already retried once before denying.

(Human-only escape, never for the agent: re-issue prefixed with
GSD_HUMAN_OVERRIDE=1.)"
    fi
  fi
fi

exit 0
