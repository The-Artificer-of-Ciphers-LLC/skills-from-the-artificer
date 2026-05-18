#!/usr/bin/env bash
# PreToolUse hook for cost-routing.
# Warns (or blocks) when Read, Grep, or Glob is invoked — these should
# almost always be delegated to haiku-scout rather than run in the main
# opus context.
#
# Modes (via env vars, none required):
#   COST_ROUTING_BLOCK=1   → upgrade warning to a hard `deny`
#   COST_ROUTING_BYPASS=1  → silence the hook entirely (one-shot escape)

set -euo pipefail

input="$(cat)"

tool_name="$(printf '%s' "$input" | jq -r '.tool_name // empty')"

case "$tool_name" in
  Read|Grep|Glob) ;;
  *) exit 0 ;;
esac

if [ "${COST_ROUTING_BYPASS:-0}" = "1" ]; then
  exit 0
fi

message="cost-routing: ${tool_name} invoked in main context. Prefer dispatching haiku-scout for read-only lookup. Set COST_ROUTING_BYPASS=1 to silence for legitimate one-shot reads, or COST_ROUTING_BLOCK=1 to upgrade this warning into a hard deny."

if [ "${COST_ROUTING_BLOCK:-0}" = "1" ]; then
  jq -n --arg msg "$message" '{
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: $msg
    }
  }'
  exit 0
fi

# Soft warn — print to stderr; tool call proceeds.
printf '%s\n' "$message" >&2
exit 0
