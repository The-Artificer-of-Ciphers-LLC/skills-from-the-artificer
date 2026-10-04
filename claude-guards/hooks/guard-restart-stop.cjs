#!/usr/bin/env node
// gsd-hook-version: 1.0.0
//
// GUARD-DENIAL BREAKER, part 2 of 2 (Stop). The automatic restart.
//
// When Claude tries to END its turn while still blocked by a guard (its last tool result was a
// guard denial, or its closing message hands the block back to the human), this hook blocks the
// stop with {"decision":"block","reason":...}. Claude Code starts a new turn with `reason` as the
// instruction, so Claude redoes the step the compliant way without the human typing anything.
// (Stop `decision:"block"` is the only supported hook-driven restart; `continue:false` would end
// the turn for good. Reference: https://code.claude.com/docs/en/hooks, Stop.)
//
// LOOP GUARD: at most MAX_RESTARTS blocks per human turn (below Claude Code's own 8-continuation
// cap). After that the stop is allowed; the run is never halted and tools are never disabled.
//
// Human kill switch: GSD_GUARD_BREAKER_OFF=1. Fails OPEN on any internal error.
'use strict';

const lib = require('./guard-trip-lib.cjs');

const MAX_RESTARTS = 3;

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

  // Still blocked: no tool call has succeeded since the guard denied one, or Claude's closing
  // message after the denial hands the block back to the human.
  const stillBlocked = turn.lastOk < turn.lastTrip;
  const handedBack = turn.finalIdx > turn.lastTrip && lib.HANDBACK_RE.test(turn.finalText);
  if (!stillBlocked && !handedBack) return;

  if (lib.bumpCounter(payload.session_id, `stop:${turn.humanKey}`) > MAX_RESTARTS) {
    lib.logEvent(payload, 'restart-cap', turn.tripText);
    return;
  }
  lib.logEvent(payload, 'restart', turn.tripText);
  process.stdout.write(JSON.stringify({
    decision: 'block',
    reason: lib.remedy(
      turn.tripText,
      'You tried to stop while a guard still blocks your task. That is not allowed: the task is not done.'
    ),
  }));
}
