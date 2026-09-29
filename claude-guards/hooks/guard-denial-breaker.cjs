#!/usr/bin/env node
// gsd-hook-version: 1.0.0
//
// GUARD-DENIAL BREAKER (PreToolUse, matcher "*").
//
// RULE: after a guard (hook or auto-mode classifier) denies an action AND that
// denial forbids routing around it, or after a subagent reports it was blocked,
// EVERY further tool call is denied until the human sends a new message.
//
// INCIDENT (2026-09-29): the orchestrator and its subagents repeatedly routed
// around guards. memtrace-first-guard denied Bash reads of indexed source and
// the Read tool on the same files was allowed; a subagent refused a guarded
// action and reported it, and the orchestrator re-dispatched a fresh subagent
// pre-told the guard "did not apply", then later ran a command a subagent had
// been denied. A denial that says "do not route around" is a stop sign for the
// AGENT, not a puzzle: this hook makes the stop mechanical.
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
// Allowed while tripped: a Write to .gsd/phase/<x>/HALT.md (so the run-incomplete
// Stop hook can be satisfied) and nothing else.
// Human kill switch: GSD_GUARD_BREAKER_OFF=1 exported in the shell that launches
// Claude Code. Fails OPEN on any internal error. Trips are logged (bounded) to
// ~/.claude/logs/guard-denial-breaker.jsonl; logging never affects the decision.
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const MAX_TAIL = 8 * 1024 * 1024;

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

  // T2 via queue-operation / attachment carrying an agent hand-back.
  let handBack = null;
  if (d.type === 'queue-operation' && typeof d.content === 'string' && d.content.includes('<agent-message from=')) {
    handBack = d.content;
  } else if (d.type === 'attachment' && Array.isArray(d.rendered)) {
    const r = d.rendered.map((x) => (x && x.content) || '').join('\n');
    if (r.includes('<agent-message from=')) handBack = r;
  }
  if (handBack && isBlockedReport(handBack)) return handBack;

  if (d.type !== 'user') return null;
  const c = d.message && d.message.content;
  if (!Array.isArray(c)) return null;
  for (const b of c) {
    if (!b || b.type !== 'tool_result') continue;
    const text = blocksText(b.content);
    if (b.is_error === true || looksLikeDenialText(text)) {
      if (findT1Phrase(text)) return text;
    }
    // T2 via Agent / SendMessage tool_result carrying a blocked report.
    if (agentIds && agentIds.has(b.tool_use_id) && isBlockedReport(text)) return text;
  }
  return null;
}

function isBlockedReport(text) {
  const s = String(text || '');
  const blocked = /\bBLOCKED\b/.test(s) || /\bdenied\b/i.test(s);
  const why = /\b(hook|guard|classifier)\b/i.test(s);
  return blocked && why;
}

function logTrip(payload, quoted) {
  try {
    const dir = path.join(os.homedir(), '.claude', 'logs');
    fs.mkdirSync(dir, { recursive: true });
    const f = path.join(dir, 'guard-denial-breaker.jsonl');
    try { if (fs.statSync(f).size > 1024 * 1024) return; } catch { /* new file */ }
    fs.appendFileSync(f, JSON.stringify({
      ts: new Date().toISOString(),
      session: payload.session_id || '',
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

  let tripped = null;
  for (let i = lastHuman + 1; i < entries.length; i += 1) {
    const t = tripText(entries[i], agentIds);
    if (t) { tripped = t; break; }
  }
  if (!tripped) return allow();

  // Sole exception while tripped: the HALT.md write.
  const input = (payload.tool_input && typeof payload.tool_input === 'object') ? payload.tool_input : {};
  if (payload.tool_name === 'Write' && typeof input.file_path === 'string' && /\/\.gsd\/phase\/[^/]+\/HALT\.md$/.test(input.file_path)) {
    return allow();
  }

  const quoted = String(tripped).replace(/\s+/g, ' ').trim().slice(0, 300);
  logTrip(payload, quoted);
  return deny(
    'GUARD-DENIAL BREAKER: a guard denied an action and forbade routing around it (quoted: ' + quoted + '). ' +
    'Do not retry, reshape, re-dispatch, or delegate it. Stop and tell the user in plain text what was blocked; ' +
    'tool calls are disabled until the user replies.'
  );
}

main()
  .catch(() => { try { allow(); } catch { /* ignore */ } })
  .finally(() => process.exit(0));
