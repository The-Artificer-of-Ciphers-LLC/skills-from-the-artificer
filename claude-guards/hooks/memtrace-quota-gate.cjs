#!/usr/bin/env node
// gsd-hook-version: 1.0.0
//
// MEMTRACE QUOTA GATE (PreToolUse, matcher "mcp__memtrace__.*").
//
// While Memtrace is in a quota/auth/unreachable cooldown (memtrace-quota-state.cjs), deny
// billed Memtrace calls with the CodeGraph route and the return time, so agents stop
// retrying a dead tool. Allowed through: the unbilled tools (list_indexed_repositories,
// get_repository_stats, get_directory_tree, any fleet_*), and exactly one probe call when
// probeDue() && claimProbe(). Escape hatch: GSD_MEMTRACE_QUOTA_GATE=off. Fails open.
'use strict';

const UNBILLED = new Set(['list_indexed_repositories', 'get_repository_stats', 'get_directory_tree']);

let data = '';
const t = setTimeout(finish, 3000);
process.stdin.setEncoding('utf8');
process.stdin.on('data', (c) => { data += c; });
process.stdin.on('end', () => { clearTimeout(t); finish(); });
process.stdin.on('error', () => { clearTimeout(t); finish(); });

let done = false;
function finish() {
  if (done) return;
  done = true;
  try {
    if (process.env.GSD_MEMTRACE_QUOTA_GATE === 'off') process.exit(0);
    const q = require('./memtrace-quota-state.cjs');
    const p = JSON.parse(data || '{}');
    const name = String(p.tool_name || '').replace(/^mcp__memtrace__/, '');
    if (UNBILLED.has(name) || /^fleet_/.test(name)) process.exit(0);
    if (!q.isBlocked()) process.exit(0);
    if (q.probeDue() && q.claimProbe()) process.exit(0);
    process.stdout.write(JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: q.codegraphRoute(),
      },
    }));
  } catch { /* fail open */ }
  process.exit(0);
}
