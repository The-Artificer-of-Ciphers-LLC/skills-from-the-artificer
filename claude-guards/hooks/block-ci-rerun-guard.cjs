#!/usr/bin/env node
'use strict';

/**
 * block-ci-rerun-guard.cjs — PreToolUse hook (Bash).
 *
 * Blocks any command whose only function is to re-trigger a CI/test run
 * instead of diagnosing a failure: `gh run rerun`, `gh api .../rerun` and
 * `.../rerun-failed-jobs`, `gh workflow run`, and an empty-commit CI
 * retrigger (`git commit --allow-empty`). A rerun is never a valid
 * resolution to a red check on its own — the required response to any test
 * or CI failure is /diagnose + /root-cause-analysis, then a real fix.
 *
 * Reads the PreToolUse JSON payload on stdin ({ tool_name, tool_input, ... }).
 * Only inspects Bash commands; anything else is a no-op (exit 0, no output).
 */

const fs = require('node:fs');

// True when a GENUINE user message among the last USER_TURNS user turns of the
// session transcript asks for a rerun. Anything that is not typed by the user
// (hook feedback, system notifications, CI monitor events, tool results, meta
// entries) is ignored. Any read/parse problem fails closed (returns false).
const USER_TURNS = 6;
const RERUN_ASK_RE = /\b(re-?run|run (?:it|them|the (?:tests?|jobs?|runs?|checks?)) again|re-?trigger|re-?try the (?:tests?|jobs?|run))\b/i;
const NON_USER_PREFIX_RE = /^\s*(?:<ci-monitor-event>|<system-reminder|<task-notification>|\[SYSTEM NOTIFICATION|Stop hook feedback|<command-|Caveat:|\[Subagent hand-back\])/;

function userRequestedRerun(payload) {
  try {
    const file = payload && payload.transcript_path;
    if (typeof file !== 'string' || file.length === 0) return false;
    const lines = fs.readFileSync(file, 'utf8').split('\n');
    let seen = 0;
    for (let i = lines.length - 1; i >= 0 && seen < USER_TURNS; i--) {
      if (!lines[i]) continue;
      let entry;
      try { entry = JSON.parse(lines[i]); } catch { continue; }
      if (!entry || entry.type !== 'user' || entry.isMeta === true) continue;
      const msg = entry.message;
      if (!msg || msg.role !== 'user') continue;
      let text = '';
      if (typeof msg.content === 'string') {
        text = msg.content;
      } else if (Array.isArray(msg.content)) {
        // A turn made only of tool_result blocks is not something the user typed.
        text = msg.content
          .filter((b) => b && b.type === 'text' && typeof b.text === 'string')
          .map((b) => b.text)
          .join('\n');
      }
      if (!text || NON_USER_PREFIX_RE.test(text)) continue;
      seen++;
      if (RERUN_ASK_RE.test(text)) return true;
    }
  } catch {
    return false;
  }
  return false;
}

let input = '';
process.stdin.on('data', (d) => { input += d; });
process.stdin.on('end', () => {
  let payload;
  try {
    payload = JSON.parse(input || '{}');
  } catch {
    process.exit(0);
  }

  const cmd = (payload && payload.tool_input && payload.tool_input.command) || '';
  if (typeof cmd !== 'string' || cmd.length === 0) {
    process.exit(0);
  }

  const PATTERNS = [
    { re: /\bgh\s+run\s+rerun\b/i, label: 'gh run rerun' },
    { re: /\bgh\s+api\b[^\n]*\/rerun(?:-failed-jobs)?\b/i, label: 'gh api .../rerun (or .../rerun-failed-jobs)' },
    { re: /\bgh\s+workflow\s+run\b/i, label: 'gh workflow run' },
    { re: /\bgit\s+commit\b[^\n]*--allow-empty\b/i, label: 'git commit --allow-empty (empty-commit CI retrigger)' },
  ];

  // A `gh workflow run release.yml` dispatch is the RELEASE PIPELINE, not a CI
  // rerun: it cuts the release branch, publishes to npm, and mints the tag.
  // There is no red check being papered over — no prior run of it exists to
  // re-trigger. Re-running an already-dispatched release run still goes through
  // `gh run rerun`, which stays blocked, as does every other workflow dispatch.
  const RELEASE_DISPATCH_RE = /\bgh\s+workflow\s+run\b[^\n]*[\s"'/]release\.yml\b/i;
  const isReleaseDispatch = RELEASE_DISPATCH_RE.test(cmd);

  const hit = PATTERNS.find(
    (p) => p.re.test(cmd) && !(isReleaseDispatch && p.label === 'gh workflow run'),
  );
  if (!hit) {
    process.exit(0);
  }

  // Human override: the user's own explicit request to re-run lifts the block.
  // The guard stops an agent re-running CI on its own initiative; it must not
  // stop the user from directing a re-run. A genuine user message in the last
  // few turns asking for a rerun is the override. Hook feedback, system
  // notifications, CI monitor events and tool results never count.
  if (userRequestedRerun(payload)) {
    process.exit(0);
  }

  const reason =
    `Blocked: "${hit.label}" re-triggers a CI/test run instead of diagnosing the failure. ` +
    `A rerun is never itself a valid resolution to a red check -- treating it as a "flake", ` +
    `"overloaded", "transient", "environmental", or similar excuse without proof is forbidden. ` +
    `Run /diagnose and /root-cause-analysis on the actual failure output, find the root cause, ` +
    `and fix it. Only re-run a job AFTER a real fix has landed, to confirm the fix -- never to ` +
    `see whether a red check goes away on its own.`;

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
