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

  const hit = PATTERNS.find((p) => p.re.test(cmd));
  if (!hit) {
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
