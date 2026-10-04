#!/usr/bin/env node
// gsd-hook-version: 1.0.0
//
// MEMTRACE QUOTA WATCH (PostToolUse + PostToolUseFailure, matcher "mcp__memtrace__.*").
//
// When a Memtrace tool reports its quota is exhausted, record it and tell Claude, in the
// same turn, to carry on with CodeGraph. A successful Memtrace call clears the state.
// Never blocks, never halts, fails open.
'use strict';

const q = require('./memtrace-quota-state.cjs');

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
    const p = JSON.parse(data || '{}');
    const resp = p.tool_response !== undefined ? p.tool_response : (p.error !== undefined ? p.error : p.tool_result);
    if (q.responseIsQuotaBlocked(resp)) {
      q.markBlocked(resp);
      process.stdout.write(JSON.stringify({
        hookSpecificOutput: {
          hookEventName: p.hook_event_name || 'PostToolUse',
          additionalContext: 'GUARD-BREAKER: ' + q.CODEGRAPH_ROUTE,
        },
      }));
    } else if (p.hook_event_name !== 'PostToolUseFailure' && q.isBlocked()) {
      q.clearBlocked(); // a normal Memtrace answer: quota is back
    }
  } catch { /* fail open */ }
  process.exit(0);
}
