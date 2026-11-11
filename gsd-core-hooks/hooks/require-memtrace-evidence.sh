#!/usr/bin/env bash
# Scope: gsd-core only — silent no-op in every other repo (override for tests: GSD_CORE_SCOPE_ANY=1).
[ "${GSD_CORE_SCOPE_ANY:-}" = 1 ] || git remote -v 2>/dev/null | grep -qiE '[:/]gsd-core(\.git)?/?[[:space:]]' || exit 0
# require-memtrace-evidence.sh — PreToolUse(Bash) gate (name kept so existing installs keep working)
#
# Blocks `gh pr review --approve` and `gh pr review --request-changes` unless the
# review body has an evidence section that names a blast-radius call.
#
# Accepted headings: "### Graph Evidence" (current), "### Memtrace Evidence" and
# "### CodeGraph Evidence" (older bodies). Accepted blast-radius calls:
# `codegraph impact` / codegraph_impact (CodeGraph, free) or get_impact (Memtrace).
#
# Changed for the Warden MVP: the gate no longer requires four Memtrace tool names
# (get_impact, get_symbol_context, recall_decision, find_code_review_issues) and no
# longer reads the Memtrace quota marker. Requiring Memtrace by name turned quota
# exhaustion into a denied post, which is one of the ways /review-open-prs kept
# stopping. Naming a call that did not run is still a violation of CLAUDE.md's
# Non-Rationalization and No-Bypass rules.
#
# Exempt: `gh pr review --comment` and `gh pr review` without --approve/--request-changes.

set -euo pipefail

input="$(cat)"
cmd="$(printf '%s' "$input" | jq -r '.tool_input.command // empty' 2>/dev/null || true)"
[ -z "$cmd" ] && exit 0

# Only intercept gh pr review with --approve or --request-changes
if ! printf '%s' "$cmd" | grep -qE 'gh[[:space:]]+pr[[:space:]]+review.*--(approve|request-changes)'; then
  exit 0
fi

deny() {
  jq -n --arg r "$1" '{hookSpecificOutput:{hookEventName:"PreToolUse",permissionDecision:"deny",permissionDecisionReason:$r}}'
  exit 0
}

# Extract the review body from --body-file or --body
body=""
if printf '%s' "$cmd" | grep -q -- '--body-file'; then
  # Handle --body-file /path, --body-file=/path, and quoted forms.
  #
  # Quoted patterns run FIRST. The bare [^ ]+ pattern below captures the quote
  # characters themselves, so -f then fails on a file that exists and the gate
  # denies with a misleading "No body found"; a quoted path containing a space is
  # additionally truncated at the space. Bare stays last, so unquoted paths behave
  # exactly as before.
  body_file="$(printf '%s' "$cmd" | sed -nE 's/.*--body-file[= ]+"([^"]*)".*/\1/p' | head -1)"
  [ -n "$body_file" ] || body_file="$(printf '%s' "$cmd" | sed -nE "s/.*--body-file[= ]+'([^']*)'.*/\1/p" | head -1)"
  [ -n "$body_file" ] || body_file="$(printf '%s' "$cmd" | sed -nE 's/.*--body-file[= ]+([^ ]+).*/\1/p' | head -1)"
  if [ -n "$body_file" ] && [ -f "$body_file" ]; then
    body="$(cat "$body_file")"
  fi
elif printf '%s' "$cmd" | grep -qE -- '--body[[:space:]]'; then
  body="$(printf '%s' "$cmd" | sed -nE 's/.*--body[[:space:]]+"([^"]*)".*/\1/p')"
fi

if [ -z "$body" ]; then
  deny "GRAPH EVIDENCE GATE: gh pr review --approve/--request-changes requires a --body-file whose content includes a '### Graph Evidence' section. No body found (pass a literal path, not \$VAR or \$(...)). Run \`codegraph impact <symbol>\` on the PR's changed symbols, document the target and finding in the section, then re-post."
fi

if ! printf '%s' "$body" | grep -qE '^### (Graph|Memtrace|CodeGraph) Evidence'; then
  deny "GRAPH EVIDENCE GATE: Review body is missing the '### Graph Evidence' section. Add it with the blast radius of the PR's changed symbols (\`codegraph impact <symbol>\`, or get_impact on a full-tier PR), the callers/callees checked, the recorded-decision check result, and the deterministic checks run."
fi

if ! printf '%s' "$body" | grep -qE 'codegraph[_ ]impact|get_impact'; then
  deny "GRAPH EVIDENCE GATE: The evidence section names no blast-radius call. Run \`codegraph impact <symbol>\` (or get_impact on a full-tier PR) on the PR's changed symbols and document the target + finding."
fi

exit 0
