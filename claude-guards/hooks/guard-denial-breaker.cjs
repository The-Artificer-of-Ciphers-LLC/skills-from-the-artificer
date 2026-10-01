#!/usr/bin/env node
// gsd-hook-version: 1.0.0
//
// GUARD-DENIAL BREAKER (PreToolUse, matcher "*").
//
// RULE: after a guard (hook or auto-mode classifier) denies an action AND that
// denial forbids routing around it, or after a subagent reports it was blocked,
// the breaker INTERRUPTS THE AGENT AND MAKES IT START OVER. It denies exactly ONE
// tool call (the next one attempted after the trip) with a restart instruction,
// then allows tool calls again. It never stops the run or waits for the human.
//
// WHY: the old behavior (deny everything until the human typed a new message)
// made the agent stop and ask the human to type something, and it tripped on
// harmless things (a subagent report merely quoting a denial, a redirect-style
// denial that just names the sanctioned tool), stalling whole runs. The failure
// it guards against is the agent routing around a guard (retrying, rephrasing,
// shell-wrapping, delegating, or re-dispatching a subagent told the guard does
// not apply). A single forced re-plan interrupts that reflex without a stall.
//
// MECHANICS (stateless, via the transcript):
//   * The interrupt text begins with the sentinel "GUARD-BREAKER RESTART:". A trip
//     is acknowledged once a tool_result error beginning with that sentinel
//     appears AFTER the trip event; only a NEW trip event after the last sentinel
//     interrupt causes another interrupt.
//   * Sentinel-prefixed messages ("GUARD-BREAKER ...") are excluded from T1-phrase
//     scanning, so the breaker can never re-trip on its own denials.
//   * BACKSTOP: MAX_RESTARTS_PER_TURN (constant below, currently 5) restart
//     interrupts since the last real human message fall back to the hard
//     behavior: deny everything except a Write to .gsd/phase/<x>/HALT.md until a
//     human message arrives; the message tells the agent to stop and hand back a
//     short factual summary of what is blocked.
//   * A real human message resets everything (only entries after it are counted).
//
// TRANSCRIPT SHAPES (measured 2026-09-29 against a real session transcript):
//   * real human message:  {type:"user", message:{content:<string>}} or content
//     array with a `text` block that is not a <system-reminder>/<task-notification>/
//     <agent-message> wrapper. (Slash-command turns are `<command-message>` strings.)
//   * mid-turn human message: {type:"attachment", attachment:{type:"queued_command",
//     origin:{kind:"human"}, humanTurn:true}, rendered:[{content:"<system-reminder>\n
//     The user sent a new message while you were working: ..."}]}
//   * subagent hand-back: {type:"queue-operation", operation:"enqueue", content:
//     "<agent-message from=...>..."} and/or an attachment whose rendered content
//     contains "<agent-message from=", or an Agent/SendMessage tool_result.
//   * hook / classifier denial: {type:"user", message:{content:[{type:"tool_result",
//     is_error:true, content:"PreToolUse:Bash hook error: ..." | "Permission for
//     this action was denied by the Claude Code auto mode classifier..."}]}}
//
// NOT tripped: the worktree-isolation refusal ("Split it into plain, separate
// commands") and tier-guard's "OPUS CODE-WRITE BLOCKED ... Dispatch instead":
// both PRESCRIBE the compliant next step and contain no T1 phrase.
//
// Only tool_results that are errors or that begin like a hook/classifier denial
// are scanned for T1 phrases, so reading a file that merely QUOTES the phrases
// (e.g. this hook's own source) cannot trip the breaker.
//
// Human kill switch: GSD_GUARD_BREAKER_OFF=1 exported in the shell that launches
// Claude Code. Fails OPEN on any internal error. Restart interrupts and backstop
// trips are logged (bounded) to ~/.claude/logs/guard-denial-breaker.jsonl;
// logging never affects the decision.
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const MAX_TAIL = 8 * 1024 * 1024;

// Restart interrupts allowed per human turn before the hard stop backstop.
const MAX_RESTARTS_PER_TURN = 5;
const SENTINEL = 'GUARD-BREAKER ';
const RESTART_PREFIX = 'GUARD-BREAKER RESTART:';
const HARNESS_PREFIX_RE = /^PreToolUse:\S+ hook error:\s*/; // harness wraps hook denials

const T1_PHRASES = [
  'do not rephrase',
  'do not route around',
  'circumvention',
  'safety bypass',
  "don't pursue the same outcome",
  'do not work around',
  'denied by the claude code auto mode classifier',
];

function allow() {
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'allow' } }));
}

function deny(reason) {
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason },
  }));
}

function readStdin(timeoutMs) {
  return new Promise((resolve) => {
    let data = '';
    let done = false;
    const finish = () => { if (!done) { done = true; resolve(data); } };
    const t = setTimeout(finish, timeoutMs);
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (c) => { data += c; });
    process.stdin.on('end', () => { clearTimeout(t); finish(); });
    process.stdin.on('error', () => { clearTimeout(t); finish(); });
  });
}

function readTail(file) {
  const size = fs.statSync(file).size;
  if (size <= MAX_TAIL) return { text: fs.readFileSync(file, 'utf8'), truncated: false };
  const fd = fs.openSync(file, 'r');
  try {
    const buf = Buffer.alloc(MAX_TAIL);
    fs.readSync(fd, buf, 0, MAX_TAIL, size - MAX_TAIL);
    let text = buf.toString('utf8');
    const nl = text.indexOf('\n');
    text = nl >= 0 ? text.slice(nl + 1) : '';
    return { text, truncated: true };
  } finally {
    fs.closeSync(fd);
  }
}

function isWrapperText(t) {
  const s = String(t || '').trim();
  if (!s) return true;
  return /^<(system-reminder|task-notification|agent-message|local-command|bash-|user-prompt-submit-hook)/.test(s);
}

function blocksText(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map((b) => (b && typeof b === 'object' ? (typeof b.text === 'string' ? b.text : (typeof b.content === 'string' ? b.content : '')) : ''))
    .join('\n');
}

// Is this transcript entry a genuine human message?
function isHumanEntry(d) {
  if (!d || typeof d !== 'object') return false;
  if (d.type === 'attachment' && d.attachment) {
    const a = d.attachment;
    if (a.type === 'queued_command' && a.origin && a.origin.kind === 'human') return true;
    const r = Array.isArray(d.rendered) ? d.rendered.map((x) => (x && x.content) || '').join('\n') : '';
    if (r.includes('The user sent a new message while you were working')) return true;
    return false;
  }
  if (d.type !== 'user') return false;
  if (d.isMeta === true) return false;
  const c = d.message && d.message.content;
  if (typeof c === 'string') return !isWrapperText(c);
  if (Array.isArray(c)) {
    if (c.some((b) => b && b.type === 'tool_result')) return false;
    const texts = c.filter((b) => b && b.type === 'text').map((b) => b.text);
    if (texts.some((t) => String(t).includes('The user sent a new message while you were working'))) return true;
    return texts.some((t) => !isWrapperText(t));
  }
  return false;
}

function findT1Phrase(text) {
  const low = String(text || '').toLowerCase();
  return T1_PHRASES.find((p) => low.includes(p)) || null;
}

function looksLikeDenialText(text) {
  const s = String(text || '').trimStart();
  return /^PreToolUse:[^\s]* hook error/.test(s) || s.startsWith('Permission for this action was denied');
}

// Returns the tripping text (string) for this entry, or null.
function tripText(d, agentIds) {
  if (!d || typeof d !== 'object') return null;

  // A subagent HAND-BACK is never a trip (user instruction 2026-10-01: "stop counting a hand-back
  // as a denial"). Review and research reports routinely quote the words "denied"/"blocked" and
  // "hook"/"guard" while describing code, and tripping on them interrupted whole runs. Only a real
  // hook/classifier denial in THIS session's own tool_results (T1, below) trips the breaker.
  if (d.type !== 'user') return null;
  const c = d.message && d.message.content;
  if (!Array.isArray(c)) return null;
  for (const b of c) {
    if (!b || b.type !== 'tool_result') continue;
    const text = blocksText(b.content);
    if (text.trimStart().replace(HARNESS_PREFIX_RE, '').startsWith(SENTINEL)) continue;
    if (b.is_error === true || looksLikeDenialText(text)) {
      if (findT1Phrase(text)) return text;
    }
    // (An Agent / SendMessage tool_result is a hand-back too: never a trip, see above.)
  }
  return null;
}

function isBlockedReport(text) {
  const s = String(text || '');
  const blocked = /\bBLOCKED\b/.test(s) || /\bdenied\b/i.test(s);
  const why = /\b(hook|guard|classifier)\b/i.test(s);
  return blocked && why;
}

// Does this entry carry a tool_result error that is a breaker restart interrupt?
function isRestartAck(d) {
  if (!d || d.type !== 'user') return false;
  const c = d.message && d.message.content;
  if (!Array.isArray(c)) return false;
  return c.some((b) => b && b.type === 'tool_result' && b.is_error === true
    && blocksText(b.content).trimStart().replace(HARNESS_PREFIX_RE, '').startsWith(RESTART_PREFIX));
}

function logTrip(payload, kind, quoted) {
  try {
    const dir = path.join(os.homedir(), '.claude', 'logs');
    fs.mkdirSync(dir, { recursive: true });
    const f = path.join(dir, 'guard-denial-breaker.jsonl');
    try { if (fs.statSync(f).size > 1024 * 1024) return; } catch { /* new file */ }
    fs.appendFileSync(f, JSON.stringify({
      ts: new Date().toISOString(),
      session: payload.session_id || '',
      kind,
      tool: payload.tool_name || '',
      quoted: String(quoted).slice(0, 300),
    }) + '\n');
  } catch { /* never affects the decision */ }
}

async function main() {
  if (process.env.GSD_GUARD_BREAKER_OFF === '1') return allow();
  const raw = await readStdin(4000);
  if (!raw || !raw.trim()) return allow();
  let payload;
  try { payload = JSON.parse(raw); } catch { return allow(); }
  if (!payload || typeof payload !== 'object') return allow();
  const tp = typeof payload.transcript_path === 'string' ? payload.transcript_path : '';
  if (!tp) return allow();

  let tail;
  try { tail = readTail(tp); } catch { return allow(); }

  const entries = [];
  for (const line of tail.text.split('\n')) {
    if (!line) continue;
    try { entries.push(JSON.parse(line)); } catch { entries.push(null); }
  }

  let lastHuman = -1;
  for (let i = entries.length - 1; i >= 0; i -= 1) {
    if (isHumanEntry(entries[i])) { lastHuman = i; break; }
  }
  if (lastHuman < 0 && tail.truncated) return allow(); // boundary out of window: fail open

  const agentIds = new Set();
  for (const d of entries) {
    const c = d && d.message && d.message.content;
    if (!Array.isArray(c)) continue;
    for (const b of c) {
      if (b && b.type === 'tool_use' && b.id && ['Agent', 'Task', 'SendMessage'].includes(b.name)) agentIds.add(b.id);
    }
  }

  let lastTrip = -1;
  let tripped = null;
  let lastAck = -1;
  let acks = 0;
  for (let i = lastHuman + 1; i < entries.length; i += 1) {
    if (isRestartAck(entries[i])) { lastAck = i; acks += 1; continue; }
    const t = tripText(entries[i], agentIds);
    if (t) { lastTrip = i; tripped = t; }
  }

  const input = (payload.tool_input && typeof payload.tool_input === 'object') ? payload.tool_input : {};

  // Backstop: too many interrupts this human turn -> hard stop until a human message.
  if (acks >= MAX_RESTARTS_PER_TURN) {
    if (payload.tool_name === 'Write' && typeof input.file_path === 'string' && /\/\.gsd\/phase\/[^/]+\/HALT\.md$/.test(input.file_path)) {
      return allow();
    }
    logTrip(payload, 'backstop', String(tripped || '').replace(/\s+/g, ' ').trim().slice(0, 300));
    return deny(
      SENTINEL + 'HALT: you have been interrupted ' + acks + ' times this turn because guards keep denying or ' +
      'blocking your actions. Stop now. Tool calls are disabled until the user replies. Hand back a short factual ' +
      'summary of what is blocked and nothing else.'
    );
  }

  // No new trip since the last interrupt (or no trip at all) -> allow.
  if (lastTrip < 0 || lastTrip < lastAck) return allow();

  logTrip(payload, 'restart', String(tripped).replace(/\s+/g, ' ').trim().slice(0, 300));
  return deny(
    RESTART_PREFIX + ' a guard just denied an action, or a subagent reported being blocked. Do not report this to ' +
    'the user and do not wait for them. Discard the blocked approach and every equivalent of it, re-plan, and ' +
    'continue the task using the compliant path the guard itself prescribes (for example the sanctioned tool it ' +
    'names). Never retry, rephrase, shell-wrap or delegate the blocked action, and never re-dispatch a subagent ' +
    'with an instruction that the guard does not apply. If no compliant path exists for this step, pick a ' +
    'different step of the task that has one.'
  );
}

main()
  .catch(() => { try { allow(); } catch { /* ignore */ } })
  .finally(() => process.exit(0));
