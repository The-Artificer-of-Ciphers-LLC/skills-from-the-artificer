#!/usr/bin/env node
// gsd-hook-version: 2.0.0
//
// GUARD-DENIAL BREAKER, part 1 of 2 (PreToolUse, matcher "*"). Part 2 is guard-restart-stop.cjs.
//
// RULE: after a guard (hook or auto-mode classifier) denies an action and that denial forbids
// routing around it, Claude must go back and do the step the compliant way ITSELF. The breaker
// never denies a tool call, never halts the run, never tells the human to type anything.
//
// HOW: on the first tool call after a trip it ALLOWS the call and attaches the guard's own
// instruction as `additionalContext` (a system reminder next to the tool result), once per trip.
// If Claude instead tries to end its turn while still blocked, guard-restart-stop.cjs blocks
// the Stop, which starts a new turn on its own. See docs/research/circuit-breaker-auto-restart.md.
//
// v1 denied the next tool call after every trip. That call was usually the compliant one, parallel
// calls were each denied before the first denial reached the transcript, and a 5-restart backstop
// halted everything until the user typed a message. All three are gone.
//
// Human kill switch: GSD_GUARD_BREAKER_OFF=1 exported in the shell that launches Claude Code.
// Fails OPEN on any internal error.
'use strict';

const lib = require('./guard-trip-lib.cjs');

let data = '';
let done = false;
const t = setTimeout(finish, 4000);
process.stdin.setEncoding('utf8');
process.stdin.on('data', (c) => { data += c; });
process.stdin.on('end', () => { clearTimeout(t); finish(); });
process.stdin.on('error', () => { clearTimeout(t); finish(); });

function finish() {
  if (done) return;
  done = true;
  try { run(); } catch { /* fail open */ }
  process.exit(0);
}

function run() {
  if (process.env.GSD_GUARD_BREAKER_OFF === '1') return;
  if (!data || !data.trim()) return;
  const payload = JSON.parse(data);
  const tp = payload && typeof payload.transcript_path === 'string' ? payload.transcript_path : '';
  if (!tp) return;
  const turn = lib.analyze(tp);
  if (!turn || turn.lastTrip < 0) return;
  // Claude already recovered (a call succeeded after the denial): nothing to say.
  if (turn.lastOk > turn.lastTrip) return;
  if (!lib.claimOnce(payload.session_id, `notice:${turn.humanKey}:${turn.tripKey}`)) return;
  lib.logEvent(payload, 'notice', turn.tripText);
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      additionalContext: lib.remedy(turn.tripText, 'A guard denied your previous action.'),
    },
  }));
}
