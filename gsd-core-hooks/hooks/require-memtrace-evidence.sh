#!/usr/bin/env bash
# require-memtrace-evidence.sh — PreToolUse(Bash) gate
#
# Blocks `gh pr review --approve` and `gh pr review --request-changes` unless
# the review body contains a "### Memtrace Evidence" section documenting the
# Memtrace graph tools actually called during the review.
#
# Required tools per the Batch PR Review Directive Phase B:
#   get_impact, get_symbol_context, recall_decision, find_code_review_issues
#
# This is a STRUCTURAL GATE. The evidence must be visible in the posted review
# body so it is auditable on GitHub. The section must list each required tool
# by name with its target symbol and key finding.
#
# Faking the section without running the tools is a separate, more serious
# violation of CLAUDE.md's Non-Rationalization and No-Bypass rules.
#
# Exempt: `gh pr review --comment` (direction comments don't require graph
# analysis) and `gh pr review` without --approve/--request-changes.

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
  deny "MEMTRACE EVIDENCE GATE: gh pr review --approve/--request-changes requires a --body-file whose content includes a '### Memtrace Evidence' section. No body found. Run the Memtrace pipeline (get_impact, get_symbol_context, recall_decision, find_code_review_issues on the PR's changed symbols), document findings in the section, then re-post."
fi

# Check for the Memtrace Evidence section header
if ! printf '%s' "$body" | grep -q '### Memtrace Evidence'; then
  deny "MEMTRACE EVIDENCE GATE: Review body is missing the required '### Memtrace Evidence' section. The Batch PR Review Directive (Phase B §1.11/§2/§3A.7/§4A/§4C) mandates Memtrace graph analysis for every PR review. Run the required tools against the PR's changed symbols and add the section documenting: get_impact (blast radius), get_symbol_context (callers/callees), recall_decision (recorded decisions/bans), find_code_review_issues (deterministic AST+graph review)."
fi

# Check for each required tool name in the evidence section
required_tools="get_impact get_symbol_context recall_decision find_code_review_issues"
missing=""
for tool in $required_tools; do
  if ! printf '%s' "$body" | grep -qF "$tool"; then
    missing="${missing} ${tool}"
  fi
done

if [ -n "$missing" ]; then
  deny "MEMTRACE EVIDENCE GATE: The '### Memtrace Evidence' section is missing evidence for these required tools:${missing}. Run each tool against the PR's changed symbols and document the target + finding in the section."
fi

exit 0
