#!/usr/bin/env node
'use strict';

/**
 * block-timeout-increase-guard.cjs — PreToolUse hook (Write|Edit|MultiEdit).
 *
 * Blocks an edit that increases (or, for a brand-new assignment / new file,
 * sets) a numeric timeout value, unless the human explicitly confirmed this
 * exact change earlier in the current session's transcript. Raising a
 * timeout budget is "kicking the can down the road" on a real performance/
 * reliability problem, not a fix — it must never be the agent's own
 * unilateral choice.
 *
 * Detection is heuristic and intentionally over-broad (false positives are
 * cheap — the human just re-approves; false negatives let a real timeout-bump
 * slip through unblocked, which is the worse failure). It looks for a `new_string`
 * (Edit) or `content` (Write) / any MultiEdit edit whose text contains a
 * timeout-shaped identifier (case-insensitive: timeout, TIMEOUT_MS, time_out,
 * ..._MS ceiling/budget) assigned or compared to a numeric literal. A hit is
 * raised when:
 *   - (Edit/MultiEdit) the identifier already has a value in old_string and
 *     the new_string value is strictly greater, OR
 *   - (Edit/MultiEdit) the identifier is present in new_string but ABSENT
 *     from old_string entirely (a brand-new timeout assignment introduced by
 *     the edit — treated like a new-file "set", from: null), OR
 *   - (Write) any timeout-shaped numeric assignment in a whole-file write,
 *     since there is nothing to compare against.
 *
 * CONFIRMATION PATH: a hit is cleared only if the HUMAN (not the agent, not
 * a subagent) typed, earlier in the current session's transcript, the exact
 * phrase `confirm <IDENT> = <VALUE>` (case-insensitive; underscores in
 * <VALUE> are allowed and normalized, e.g. 30_000 == 30000) for that exact
 * identifier and exact target value. Source of truth is the session
 * transcript named by `payload.transcript_path`:
 *   - If that path is a subagent/sidechain transcript (matches
 *     `.../<sessionId>/subagents/agent-*.jsonl`), the MAIN session
 *     transcript `<dir>/<sessionId>.jsonl` is read instead — a subagent
 *     transcript can never itself supply a human confirmation.
 *   - Each line is JSON.parse'd (unparsable lines are skipped). Only entries
 *     with `type === 'user'`, `isSidechain !== true`, and
 *     `origin && origin.kind === 'human'` count as something the human
 *     actually typed; assistant/tool/subagent/task-notification entries are
 *     never consulted. Content may be a string or an array of blocks — only
 *     `type: 'text'` block text is scanned (never tool_result blocks).
 *   - Every hit found in the current edit must be independently confirmed;
 *     one confirmed hit does not clear a different ident or a different
 *     value for the same ident.
 *   - Any failure reading/parsing the transcript is treated as "not
 *     confirmed" (fail closed — the deny stands).
 * On a fully-confirmed edit, one line is appended (best-effort) to
 * ~/.claude/timeout-guard-approvals.log per confirmed hit, then the hook
 * allows (exit 0, no output).
 *
 * Reads the PreToolUse JSON payload on stdin ({ tool_name, tool_input, ... }).
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

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

  // Returns an array of ALL hits (not just the first) so every one can be
  // independently checked against the confirmation log.
  function findIncreases(oldText, newText) {
    const oldVals = new Map();
    let sawOld = false;
    for (const { ident, value } of findTimeoutAssignments(oldText)) {
      sawOld = true;
      if (!oldVals.has(ident) || value > oldVals.get(ident)) oldVals.set(ident, value);
    }
    const hits = [];
    for (const { ident, value } of findTimeoutAssignments(newText)) {
      if (!oldVals.has(ident)) {
        // Brand-new timeout-named assignment introduced by this edit —
        // absent from old_string entirely. Treat like a new-file "set".
        hits.push({ ident, from: null, to: value });
        continue;
      }
      const prev = oldVals.get(ident);
      if (value > prev) hits.push({ ident, from: prev, to: value });
    }
    // sawOld is unused for decision-making (kept for clarity of intent);
    // presence/absence is already captured via oldVals.has(ident) above.
    void sawOld;
    return hits;
  }

  const input_ = payload.tool_input || {};
  let hits = [];

  if (toolName === 'Edit') {
    hits = findIncreases(input_.old_string || '', input_.new_string || '');
  } else if (toolName === 'MultiEdit') {
    const edits = Array.isArray(input_.edits) ? input_.edits : [];
    for (const e of edits) {
      hits = hits.concat(findIncreases(e.old_string || '', e.new_string || ''));
    }
  } else if (toolName === 'Write') {
    hits = findTimeoutAssignments(input_.content || '').map(({ ident, value }) => ({
      ident, from: null, to: value,
    }));
  }

  if (hits.length === 0) {
    process.exit(0);
  }

  // ---- Confirmation path -----------------------------------------------

  function resolveMainTranscriptPath(transcriptPath) {
    const m = /^(.*)[/\\]subagents[/\\][^/\\]+$/.exec(transcriptPath);
    if (m) return `${m[1]}.jsonl`;
    return transcriptPath;
  }

  function extractTextBlocks(content) {
    if (typeof content === 'string') return [content];
    if (Array.isArray(content)) {
      return content
        .filter((block) => block && block.type === 'text' && typeof block.text === 'string')
        .map((block) => block.text);
    }
    return [];
  }

  function escapeRegExp(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  // Returns a Set of "ident::normalizedValue" keys the human confirmed.
  function collectHumanConfirmations(transcriptPath) {
    const confirmed = new Set();
    if (!transcriptPath) return confirmed;
    let mainPath;
    try {
      mainPath = resolveMainTranscriptPath(transcriptPath);
    } catch {
      return confirmed;
    }

    let raw;
    try {
      raw = fs.readFileSync(mainPath, 'utf8');
    } catch {
      return confirmed;
    }

    const lines = raw.split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      let entry;
      try {
        entry = JSON.parse(trimmed);
      } catch {
        continue;
      }
      if (!entry || entry.type !== 'user') continue;
      if (entry.isSidechain === true) continue;
      if (!entry.origin || entry.origin.kind !== 'human') continue;

      const message = entry.message || entry;
      const texts = extractTextBlocks(message.content !== undefined ? message.content : entry.content);
      for (const text of texts) {
        const CONFIRM_RE = /confirm\s+([A-Za-z_][A-Za-z0-9_]*)\s*=\s*['"`]?(\d[\d_]*)\b/gi;
        let cm;
        while ((cm = CONFIRM_RE.exec(text)) !== null) {
          const confIdent = cm[1];
          const confValue = Number(cm[2].replace(/_/g, ''));
          confirmed.add(`${confIdent}::${confValue}`);
        }
      }
    }
    return confirmed;
  }

  const confirmedSet = collectHumanConfirmations(payload.transcript_path);
  const unconfirmed = hits.filter((h) => !confirmedSet.has(`${h.ident}::${h.to}`));

  if (unconfirmed.length === 0) {
    // Every hit was explicitly confirmed by the human — log and allow.
    try {
      const logPath = path.join(os.homedir(), '.claude', 'timeout-guard-approvals.log');
      const lines = hits.map((h) => JSON.stringify({
        time: new Date().toISOString(),
        tool: toolName,
        file_path: input_.file_path || null,
        ident: h.ident,
        from: h.from,
        to: h.to,
      })).join('\n') + '\n';
      fs.appendFileSync(logPath, lines);
    } catch {
      // best-effort only
    }
    process.exit(0);
  }

  const hitList = unconfirmed
    .map((h) => `"${h.ident}" ${h.from === null ? 'to' : `from ${h.from} to`} ${h.to}`)
    .join('; ');
  const confirmPhrases = unconfirmed
    .map((h) => `confirm ${h.ident} = ${h.to}`)
    .join(' | ');

  const reason =
    `Blocked: this edit raises (or, for a new file / new assignment, sets) timeout-shaped value(s): ${hitList}. ` +
    `Raising a timeout budget is kicking the can down the road on a real performance/reliability problem, not a ` +
    `fix. This must never be the agent's own unilateral choice. To proceed, the HUMAN (not this agent, and not a ` +
    `relayed or quoted confirmation) must type the exact phrase ${confirmPhrases} in this conversation, then you ` +
    `may retry.`;

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
