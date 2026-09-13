#!/usr/bin/env node
'use strict';

/**
 * gsd-block-timeout-increase-guard.cjs — PreToolUse hook (Write|Edit|MultiEdit).
 *
 * Blocks an edit that increases a numeric timeout value, unless the user
 * explicitly instructed it in the current turn. Raising a timeout budget is
 * "kicking the can down the road" on a real performance/reliability problem,
 * not a fix — it must never be the agent's own unilateral choice.
 *
 * Detection is heuristic and intentionally over-broad (false positives are
 * cheap — the human just re-approves; false negatives let a real timeout-bump
 * slip through unblocked, which is the worse failure). It looks for a `new_string`
 * (Edit) or `content` (Write) / any MultiEdit edit whose text contains a
 * timeout-shaped identifier (case-insensitive: timeout, TIMEOUT_MS, time_out,
 * ..._MS ceiling/budget) assigned or compared to a numeric literal, and — when
 * the corresponding `old_string` (Edit/MultiEdit) is available — the new
 * numeric value is strictly greater than the old one for the same identifier.
 * For a bare Write (whole-file, no old_string to diff against) any timeout-
 * shaped numeric assignment is flagged, since there is nothing to compare
 * against and a false negative is worse than a false positive here.
 *
 * Reads the PreToolUse JSON payload on stdin ({ tool_name, tool_input, ... }).
 */

let input = '';
process.stdin.on('data', (d) => { input += d; });
process.stdin.on('end', () => {
  let payload;
  try {
    payload = JSON.parse(input || '{}');
  } catch {
    process.exit(0);
  }

  const toolName = payload && payload.tool_name;
  if (toolName !== 'Edit' && toolName !== 'Write' && toolName !== 'MultiEdit') {
    process.exit(0);
  }

  const TIMEOUT_IDENT_RE = /\b([A-Za-z_][A-Za-z0-9_]*(?:TIMEOUT|Timeout|timeout|TIME_OUT|time_out)[A-Za-z0-9_]*)\b\s*(?::|=|,|\()\s*['"`]?(\d[\d_]*)/g;

  function findTimeoutAssignments(text) {
    const found = [];
    if (typeof text !== 'string') return found;
    let m;
    TIMEOUT_IDENT_RE.lastIndex = 0;
    while ((m = TIMEOUT_IDENT_RE.exec(text)) !== null) {
      found.push({ ident: m[1], value: Number(m[2].replace(/_/g, '')) });
    }
    return found;
  }

  function isIncrease(oldText, newText) {
    const oldVals = new Map();
    for (const { ident, value } of findTimeoutAssignments(oldText)) {
      if (!oldVals.has(ident) || value > oldVals.get(ident)) oldVals.set(ident, value);
    }
    for (const { ident, value } of findTimeoutAssignments(newText)) {
      const prev = oldVals.get(ident);
      if (prev !== undefined && value > prev) return { ident, from: prev, to: value };
    }
    return null;
  }

  const input_ = payload.tool_input || {};
  let hit = null;

  if (toolName === 'Edit') {
    hit = isIncrease(input_.old_string || '', input_.new_string || '');
  } else if (toolName === 'MultiEdit') {
    const edits = Array.isArray(input_.edits) ? input_.edits : [];
    for (const e of edits) {
      hit = isIncrease(e.old_string || '', e.new_string || '');
      if (hit) break;
    }
  } else if (toolName === 'Write') {
    const assignments = findTimeoutAssignments(input_.content || '');
    if (assignments.length > 0) {
      hit = { ident: assignments[0].ident, from: null, to: assignments[0].value };
    }
  }

  if (!hit) {
    process.exit(0);
  }

  const fromText = hit.from === null ? '(new file, no prior value to compare)' : hit.from;
  const reason =
    `Blocked: this edit raises (or, for a new file, sets) a timeout-shaped value "${hit.ident}" ` +
    `${hit.from === null ? 'to' : `from ${fromText} to`} ${hit.to}. Raising a timeout budget is ` +
    `kicking the can down the road on a real performance/reliability problem, not a fix. This must ` +
    `never be the agent's own unilateral choice -- only proceed if the user explicitly instructed ` +
    `this exact timeout change in this conversation. If they did, tell them this hook is blocking it ` +
    `and ask them to confirm explicitly before you retry.`;

  process.stdout.write(JSON.stringify({
    decision: 'block',
    reason,
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: reason,
    },
  }));
  process.exit(0);
});
