'use strict';
// Shared transcript analysis for the guard circuit breaker (guard-denial-breaker.cjs,
// PreToolUse) and its restart hook (guard-restart-stop.cjs, Stop).
//
// The breaker's job is to make Claude redo a blocked step the compliant way, on its own.
// It must never deny a tool call that is not itself non-compliant, never halt the run,
// and never ask the human to type anything. See docs/research/circuit-breaker-auto-restart.md.
//
// TRANSCRIPT SHAPES (measured 2026-09-29 against a real session transcript):
//   * real human message:  {type:"user", message:{content:<string>}} or a content array with a
//     `text` block that is not a <system-reminder>/<task-notification>/<agent-message> wrapper.
//   * mid-turn human message: {type:"attachment", attachment:{type:"queued_command",
//     origin:{kind:"human"}}, rendered:[{content:"...The user sent a new message while you
//     were working..."}]}
//   * hook / classifier denial: {type:"user", message:{content:[{type:"tool_result",
//     is_error:true, content:"PreToolUse:Bash hook error: ..." | "Permission for this action
//     was denied by the Claude Code auto mode classifier..."}]}}
//   * a subagent hand-back is NEVER a trip.
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const MAX_TAIL = 8 * 1024 * 1024;
const SENTINEL = 'GUARD-BREAKER';
const HARNESS_PREFIX_RE = /^PreToolUse:\S+ hook error:\s*(?:\[[^\]]*\]:\s*)?/;

const T1_PHRASES = [
  'do not rephrase',
  'do not route around',
  'circumvention',
  'safety bypass',
  "don't pursue the same outcome",
  'do not work around',
  'denied by the claude code auto mode classifier',
];

// Final-message wording that means "I am handing this back to the human because a guard blocked me".
const HANDBACK_RE = new RegExp([
  '(?:please|can you|could you|you(?:\'ll)? (?:need|have) to|you must)\\s+(?:type|say|reply|export|send|run|restart|tell me)',
  'GSD_[A-Z_]+_OFF',
  '(?:blocked|denied|stopped) by (?:a|the|my) (?:\\w+[- ])?(?:guard|hook|breaker|classifier)',
  '(?:guard|hook|breaker|classifier)[^.\\n]{0,60}\\b(?:blocked|denied|halted|stopped)\\b',
  'waiting (?:on|for) you',
  'need(?:s)? your (?:input|go-ahead|approval|ok)',
].join('|'), 'i');

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

function isHumanEntry(d) {
  if (!d || typeof d !== 'object') return false;
  if (d.type === 'attachment' && d.attachment) {
    const a = d.attachment;
    if (a.type === 'queued_command' && a.origin && a.origin.kind === 'human') return true;
    const r = Array.isArray(d.rendered) ? d.rendered.map((x) => (x && x.content) || '').join('\n') : '';
    return r.includes('The user sent a new message while you were working');
  }
  if (d.type !== 'user' || d.isMeta === true) return false;
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

function stripHarness(text) {
  return String(text || '').trimStart().replace(HARNESS_PREFIX_RE, '');
}

function looksLikeDenialText(text) {
  const s = String(text || '').trimStart();
  return /^PreToolUse:[^\s]* hook error/.test(s) || s.startsWith('Permission for this action was denied');
}

function findT1Phrase(text) {
  const low = String(text || '').toLowerCase();
  return T1_PHRASES.find((p) => low.includes(p)) || null;
}

// For one transcript entry: {trip:[texts], ok:boolean}. A trip is a hook/classifier denial that
// forbids routing around it. ok = a tool_result that is neither an error nor a denial.
function classify(d) {
  const out = { trips: [], ok: false, denial: false };
  if (!d || d.type !== 'user') return out;
  const c = d.message && d.message.content;
  if (!Array.isArray(c)) return out;
  for (const b of c) {
    if (!b || b.type !== 'tool_result') continue;
    const text = blocksText(b.content);
    if (stripHarness(text).startsWith(SENTINEL)) { out.denial = true; continue; }
    const isDenial = b.is_error === true || looksLikeDenialText(text);
    if (isDenial) {
      out.denial = true;
      if (findT1Phrase(text)) out.trips.push(text);
    } else {
      out.ok = true;
    }
  }
  return out;
}

function assistantText(d) {
  if (!d || d.type !== 'assistant') return '';
  const c = d.message && d.message.content;
  if (typeof c === 'string') return c;
  if (!Array.isArray(c)) return '';
  return c.filter((b) => b && b.type === 'text').map((b) => b.text || '').join('\n');
}

// Analyse this human turn. Returns null when the transcript is unreadable (callers fail open).
function analyze(transcriptPath) {
  let tail;
  try { tail = readTail(transcriptPath); } catch { return null; }
  const entries = [];
  for (const line of tail.text.split('\n')) {
    if (!line) continue;
    try { entries.push(JSON.parse(line)); } catch { entries.push(null); }
  }
  let lastHuman = -1;
  for (let i = entries.length - 1; i >= 0; i -= 1) {
    if (isHumanEntry(entries[i])) { lastHuman = i; break; }
  }
  if (lastHuman < 0 && tail.truncated) return null;

  const turn = { humanKey: '', lastTrip: -1, tripText: '', tripKey: '', lastOk: -1, lastDenial: -1, finalText: '', finalIdx: -1 };
  const h = entries[lastHuman];
  turn.humanKey = String((h && (h.uuid || h.timestamp)) || lastHuman);
  for (let i = lastHuman + 1; i < entries.length; i += 1) {
    const d = entries[i];
    const k = classify(d);
    if (k.trips.length) {
      turn.lastTrip = i;
      turn.tripText = k.trips[k.trips.length - 1];
      turn.tripKey = String((d && d.uuid) || i);
    }
    if (k.denial) turn.lastDenial = i;
    if (k.ok) turn.lastOk = i;
    const t = assistantText(d);
    if (t.trim()) { turn.finalText = t; turn.finalIdx = i; }
  }
  return turn;
}

function stateDir(session) {
  return path.join(process.env.GUARD_BREAKER_STATE || path.join(os.homedir(), '.claude', 'state', 'guard-breaker'),
    String(session || 'nosession').replace(/[^A-Za-z0-9_.-]/g, '_'));
}

// Atomically claim a one-shot notice. True only for the FIRST caller, so parallel tool calls
// (each running this hook before the transcript shows the others' notices) emit it once.
function claimOnce(session, key) {
  try {
    const dir = stateDir(session);
    fs.mkdirSync(dir, { recursive: true });
    const f = path.join(dir, crypto.createHash('sha1').update(String(key)).digest('hex'));
    fs.writeFileSync(f, String(Date.now()), { flag: 'wx' });
    return true;
  } catch { return false; }
}

// Increment-and-read a per-turn counter (the Stop hook's loop guard).
function bumpCounter(session, key) {
  try {
    const dir = stateDir(session);
    fs.mkdirSync(dir, { recursive: true });
    const f = path.join(dir, `count-${crypto.createHash('sha1').update(String(key)).digest('hex')}`);
    let n = 0;
    try { n = Number(fs.readFileSync(f, 'utf8')) || 0; } catch { /* first */ }
    fs.writeFileSync(f, String(n + 1));
    return n + 1;
  } catch { return 1 << 20; } // cannot count -> behave as capped (fail open)
}

function logEvent(payload, kind, quoted) {
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
      quoted: String(quoted || '').replace(/\s+/g, ' ').trim().slice(0, 300),
    }) + '\n');
  } catch { /* never affects the decision */ }
}

// The instruction fed back to Claude. The guard's own text prescribes the compliant path, so it
// is quoted rather than paraphrased. Quota exhaustion routes to CodeGraph.
function remedy(tripText, lead) {
  let quota = '';
  try {
    const q = require('./memtrace-quota-state.cjs');
    if (q.isBlocked() || /quota/i.test(tripText || '')) quota = `\n\n${q.CODEGRAPH_ROUTE}`;
  } catch { /* optional */ }
  const quoted = stripHarness(tripText).replace(/\s+/g, ' ').trim().slice(0, 1800);
  return `${SENTINEL}: ${lead} Do NOT stop, do NOT report this to the user, and do NOT ask them to type or ` +
    'export anything. The guard\'s own instruction follows and names the compliant path; take it now, ' +
    'then continue the original task. Any work that depended on the blocked approach must be redone ' +
    'through the compliant path. Never retry, rephrase, shell-wrap or delegate the blocked action.\n\n' +
    `GUARD SAID: ${quoted}${quota}`;
}

module.exports = {
  analyze, claimOnce, bumpCounter, logEvent, remedy, stripHarness, classify,
  isHumanEntry, HANDBACK_RE, SENTINEL, T1_PHRASES,
};
