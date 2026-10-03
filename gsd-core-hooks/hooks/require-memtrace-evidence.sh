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

# CodeGraph fallback (Memtrace unavailable / quota-exhausted). Accepted ONLY when the
# body carries BOTH a '### CodeGraph Evidence' section AND an explicit
# 'Memtrace unavailable:' line stating why. Per-tool equivalents, cited to
# https://github.com/colbymchenry/codegraph @6560052 README.md:
#   get_impact         -> `codegraph impact <symbol>`            (README.md:543; MCP codegraph_impact, :590)
#   get_symbol_context -> `codegraph callers|callees <symbol>`   (README.md:541-542; MCP codegraph_callers/
#                         or `codegraph node <symbol>`            callees, :590; node = README.md:539)
#   recall_decision, find_code_review_issues: NO CodeGraph equivalent (README.md:537-547 lists no
#   decision-memory or review command); they are waived only via the 'Memtrace unavailable:' line.
# CLI commands are always available; the MCP forms need CODEGRAPH_MCP_TOOLS (README.md:590).
if printf '%s' "$body" | grep -q '### CodeGraph Evidence' && ! printf '%s' "$body" | grep -q '### Memtrace Evidence'; then
  if ! printf '%s' "$body" | grep -qE '^Memtrace unavailable:[[:space:]]*\S'; then
    deny "CODEGRAPH EVIDENCE GATE: '### CodeGraph Evidence' is accepted only as a fallback and requires a line 'Memtrace unavailable: <reason>' (e.g. quota exhausted) in the review body."
  fi
  cg_missing=""
  printf '%s' "$body" | grep -qE 'codegraph[_ ]impact' || cg_missing="${cg_missing} codegraph_impact(codegraph impact)"
  printf '%s' "$body" | grep -qE 'codegraph[_ ](callers|callees|node)' || cg_missing="${cg_missing} codegraph_callers|callees|node"
  if [ -n "$cg_missing" ]; then
    deny "CODEGRAPH EVIDENCE GATE: '### CodeGraph Evidence' is missing:${cg_missing}. Run \`codegraph impact <symbol>\` (get_impact equivalent, README.md:543) and \`codegraph callers|callees|node <symbol>\` (get_symbol_context equivalent, README.md:539-542) on the PR's changed symbols and document target + finding. recall_decision / find_code_review_issues have no CodeGraph equivalent and are waived by the 'Memtrace unavailable:' line."
  fi
  exit 0
fi

# Check for the Memtrace Evidence section header
if ! printf '%s' "$body" | grep -q '### Memtrace Evidence'; then
  deny "MEMTRACE EVIDENCE GATE: Review body is missing the required '### Memtrace Evidence' section. The Batch PR Review Directive (Phase B §1.11/§2/§3A.7/§4A/§4C) mandates Memtrace graph analysis for every PR review. Run the required tools against the PR's changed symbols and add the section documenting: get_impact (blast radius), get_symbol_context (callers/callees), recall_decision (recorded decisions/bans), find_code_review_issues (deterministic AST+graph review). If Memtrace is unavailable / quota-exhausted, use a '### CodeGraph Evidence' section instead (codegraph impact + codegraph callers|callees|node) plus a 'Memtrace unavailable: <reason>' line."
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
