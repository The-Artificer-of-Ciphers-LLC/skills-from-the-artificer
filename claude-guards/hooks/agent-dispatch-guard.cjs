#!/usr/bin/env node
// gsd-hook-version: 1.0.0
// agent-dispatch-guard.cjs — PreToolUse guard on the "Agent" tool.
//
// Rule (~/.claude/CLAUDE.md AGENT-TIER DISCIPLINE): opus is the architect;
// generic dispatches ("general-purpose" and friends) silently inherit the
// parent's model, which from opus means an opus-tier subagent for work that
// almost never needs opus reasoning. This hook does two independent jobs on
// every "Agent" PreToolUse call:
//
//   JOB A — deny an inheriting dispatch that omits an explicit `model`, so
//   the caller is forced to pick a tier instead of silently paying opus
//   rates for haiku/sonnet-shaped work.
//
//   JOB B — for every call this hook does NOT deny, inject a compact
//   "return contract" onto the end of the prompt so the subagent hands back
//   a short, dense report instead of flooding the parent's context with
//   pasted file contents, diffs, and narration. subagent-output-cap.cjs
//   is the SubagentStop-side backstop for when a subagent ignores this
//   contract anyway.
//
// Standalone by design (no sibling `require`) — hook scripts are staged
// individually and a cross-file require is a staging dependency that can
// fail silently in that path.
//
// Fail-open contract: any unexpected error anywhere below results in a
// silent exit(0). A guard that can wedge every Agent dispatch on an
// internal bug is worse than a guard that occasionally misses — so every
// failure mode here defaults to "let the call through, unmodified", never
// to "block" or "corrupt the payload".

'use strict';

const fs = require('fs');

// Types that inherit the parent's model when `model` is omitted. Compared
// case-insensitively. Extendable via GSD_DISPATCH_INHERIT_TYPES (CSV) for
// local experimentation without editing this file.
const BASE_INHERIT_TYPES = ['', 'general-purpose', 'claude', 'explore', 'plan'];

// Sentinel used both to build the injected block and to detect it already
// present — this is what makes injection idempotent across, e.g., a
// PreToolUse hook that somehow runs twice on the same tool_input, or a
// caller that composes prompts by hand and already added the contract.
const SENTINEL = '=== RETURN CONTRACT (injected) ===';

function inheritingTypeSet() {
  const set = new Set(BASE_INHERIT_TYPES.map((t) => t.toLowerCase()));
  const extra = process.env.GSD_DISPATCH_INHERIT_TYPES;
  if (typeof extra === 'string' && extra.trim()) {
    for (const raw of extra.split(',')) {
      const t = raw.trim().toLowerCase();
      if (t) set.add(t);
    }
  }
  return set;
}

function denyMissingModel(subagentType) {
  let reason =
    'AGENT DISPATCH BLOCKED: subagent_type "' + subagentType + '" inherits the parent model ' +
    '(opus -> opus) when `model` is omitted (AGENT-TIER DISCIPLINE). Pick the lowest tier the ' +
    'work needs: haiku = mechanical/search/IO/count-and-report; sonnet = coding, editing, ' +
    'review, fixing, operational sequences; opus = architecture and ambiguous design only ' +
    '(rare, justify it). Re-issue with an explicit model, e.g. model: "sonnet".';
  if (reason.length > 700) reason = reason.slice(0, 697) + '...';
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: reason,
    },
  }));
}

// Line budget by subagent_type: substring match against a lowercased type
// string, first hit wins, in the order listed — so "sonnet-coder" hits the
// "coder" bucket even though it also contains no other keyword, and a type
// like "review-scout" (were one to exist) resolves to "scout" only because
// scout/importer is checked first.
function resolveLineBudget(subagentType) {
  const override = process.env.GSD_DISPATCH_RETURN_LINES;
  if (typeof override === 'string' && override.trim()) {
    const n = Number.parseInt(override, 10);
    if (Number.isFinite(n) && n > 0) return n;
  }
  const t = subagentType.toLowerCase();
  if (t.includes('scout') || t.includes('importer')) return 20;
  if (t.includes('coder')) return 15;
  if (t.includes('review') || t.includes('audit') || t.includes('verif')) return 40;
  return 25;
}

function buildContractBlock(lineBudget) {
  // Kept under 1200 chars per the brief — every line here earns its place.
  return (
    SENTINEL + '\n' +
    'Return AT MOST ' + lineBudget + ' lines of plain text.\n' +
    'Forbidden in the return text: pasting file contents; pasting diffs or code blocks of ' +
    'existing code; restating the brief; narrating your approach or the steps you took; a ' +
    'closing summary paragraph.\n' +
    'Required: only findings/outcome the caller cannot derive without you; absolute file ' +
    'paths instead of quoted file bodies; file:line references instead of excerpts.\n' +
    'If the answer genuinely does not fit, write the long form to a file and return only that ' +
    'file\'s path plus a <=5 line abstract.\n' +
    'This contract governs the RETURN TEXT ONLY — it never restricts what actions or tools the ' +
    'brief calls for (writing files, running commands, etc. stays unchanged).\n' +
    'If the work needs a higher tier than dispatched, prefix the return with: ESCALATE: <one line>.'
  );
}

function main() {
  if (process.env.GSD_DISPATCH_GUARD === 'off') return; // explicit escape hatch

  let raw = '';
  try {
    raw = fs.readFileSync(0, 'utf8');
  } catch {
    return; // no stdin — nothing to guard
  }
  if (!raw || !raw.trim()) return;

  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    return; // malformed payload — fail open
  }

  if (payload.tool_name !== 'Agent') return;

  const input = payload.tool_input;
  if (!input || typeof input !== 'object' || Array.isArray(input)) return;

  const subagentType = String(input.subagent_type || '').trim();
  const hasExplicitModel = typeof input.model === 'string' && input.model.trim().length > 0;

  // JOB A — deny inheriting-type dispatches missing an explicit model.
  // Named agents (anything not in the inherit set) pin their own model via
  // frontmatter, so they are never subject to this check.
  if (inheritingTypeSet().has(subagentType.toLowerCase()) && !hasExplicitModel) {
    denyMissingModel(subagentType || '(default/general-purpose)');
    return;
  }

  // JOB B — inject the return contract, unless it is already present.
  const prompt = typeof input.prompt === 'string' ? input.prompt : '';
  if (prompt.includes(SENTINEL)) return; // idempotent — no output at all

  const lineBudget = resolveLineBudget(subagentType);
  const newPrompt = prompt + '\n\n' + buildContractBlock(lineBudget);

  // updatedInput REPLACES the entire tool_input object on PreToolUse, so
  // every field — not just `prompt` — must be carried forward verbatim.
  const updatedInput = Object.assign({}, input, { prompt: newPrompt });

  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'allow',
      permissionDecisionReason: 'agent-dispatch-guard: return contract injected.',
      updatedInput,
    },
  }));
}

try {
  main();
} catch {
  // Fail open unconditionally — see module header.
}
process.exit(0);
