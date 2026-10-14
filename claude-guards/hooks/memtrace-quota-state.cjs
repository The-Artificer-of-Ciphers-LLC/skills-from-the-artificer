'use strict';
// Shared Memtrace-quota state. Written by memtrace-quota-watch.cjs (PostToolUse on
// mcp__memtrace__*), read by memtrace-first-guard.cjs and guard-denial-breaker.cjs so a
// quota-blocked Memtrace sends Claude straight to CodeGraph instead of a dead end.
//
// Quota arrives as a NORMAL (non-error) MCP result, measured 2026-10-03 from the
// memtrace 1.2.8 binary and a real transcript:
//   {"error":"quota_exceeded","message":"Monthly query limit reached (N)...",
//    "quota":{"blocked":true,"stressLevel":"blocked","periodEnd":...}}
// See docs/research/circuit-breaker-auto-restart.md section 3.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const FALLBACK_TTL_MS = 60 * 60 * 1000; // re-probe Memtrace after an hour when periodEnd is unknown
const MAX_TTL_MS = 24 * 3600e3;          // a periodEnd further out than this is capped at 24 h
const SHORT_TTL_MS = 5 * 60 * 1000;      // auth / unreachable: matches Memtrace's 5-minute revalidate
const PROBE_BASE_MS = 15 * 60 * 1000;    // first probe 15 min into a cooldown, doubling per failed probe
const PROBE_MAX_MS = 4 * 3600e3;
const PROBE_CLAIM_MS = 60 * 1000;        // claimProbe() holds off other callers this long

function stateFile() {
  return process.env.MEMTRACE_QUOTA_STATE || path.join(os.homedir(), '.claude', 'state', 'memtrace-quota.json');
}

function textOf(v) {
  if (v == null) return '';
  if (typeof v === 'string') return v;
  try { return JSON.stringify(v); } catch { return ''; }
}

// True when a Memtrace tool response says the quota is exhausted.
function responseIsQuotaBlocked(resp) {
  const t = textOf(resp);
  if (!t) return false;
  if (/"error"\s*:\s*"quota_exceeded"/.test(t) || /\\"error\\"\s*:\s*\\"quota_exceeded\\"/.test(t)) return true;
  if (/"blocked"\s*:\s*true/.test(t) && /quota/i.test(t)) return true;
  return /(Monthly|Daily) query limit reached/i.test(t);
}

function periodEndOf(resp) {
  const m = textOf(resp).match(/periodEnd\\?"\s*:\s*\\?"?([0-9T:.\-Z+]+|\d{9,})/);
  if (!m) return null;
  const v = /^\d+$/.test(m[1]) ? Number(m[1]) : Date.parse(m[1]);
  if (!Number.isFinite(v)) return null;
  return v < 1e12 ? v * 1000 : v;
}

function nextUtcMidnight(now) {
  const d = new Date(now);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1);
}

function field(resp, name) {
  const m = textOf(resp).match(new RegExp('\\\\?"' + name + '\\\\?"\\s*:\\s*\\\\?"?([^,"}\\\\]+)'));
  return m ? m[1] : null;
}

// 'monthly' | 'daily' | 'auth' | 'unreachable' | null. Auth/unreachable only match SHORT
// responses (an error line), so code that merely contains those words never trips the state.
function blockReasonOf(resp) {
  const t = textOf(resp);
  if (!t) return null;
  if (responseIsQuotaBlocked(resp)) {
    const daily = /"?throttleMode\\?"?\s*:\s*true/.test(t) || /(^|[^A-Za-z])Daily (query limit reached|throttle active)/.test(t) ||
      /\\?"message\\?"\s*:\s*\\?"Daily/.test(t);
    return daily ? 'daily' : 'monthly';
  }
  if (t.length < 600) {
    if (/Authentication expired/i.test(t)) return 'auth';
    if (/ECONNREFUSED|connection refused|could not connect|failed to connect|unreachable|connection (error|failed)/i.test(t)) return 'unreachable';
  }
  return null;
}

function readState() {
  try { const s = JSON.parse(fs.readFileSync(stateFile(), 'utf8')); return s && typeof s === 'object' ? s : null; } catch { return null; }
}

function writeState(s) {
  const f = stateFile();
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, JSON.stringify(s));
}

function markBlocked(resp) {
  try {
    const now = Date.now();
    const reason = blockReasonOf(resp) || 'monthly';
    let until, untilSource;
    if (reason === 'auth' || reason === 'unreachable') {
      until = now + SHORT_TTL_MS; untilSource = 'fallback';
    } else if (reason === 'daily') {
      until = nextUtcMidnight(now); untilSource = 'nextUtcMidnight';
    } else {
      const end = periodEndOf(resp);
      if (end && end > now) { until = Math.min(end, now + MAX_TTL_MS); untilSource = 'periodEnd'; }
      else { until = now + FALLBACK_TTL_MS; untilSource = 'fallback'; }
    }
    const prev = readState();
    const probes = prev && prev.blocked && prev.until > now && typeof prev.probes === 'number' ? prev.probes : 0;
    const s = {
      v: 1, blocked: true, reason, ts: now, until, untilSource,
      probeAfter: Math.min(now + Math.min(PROBE_BASE_MS * Math.pow(2, probes), PROBE_MAX_MS), until),
      probes,
    };
    const plan = field(resp, 'plan'); if (plan) s.plan = plan;
    const url = field(resp, 'upgradeUrl'); if (url) s.upgradeUrl = url;
    const mu = Number(field(resp, 'monthlyUsed')); if (Number.isFinite(mu) && field(resp, 'monthlyUsed') !== null) s.monthlyUsed = mu;
    const ml = Number(field(resp, 'monthlyLimit')); if (Number.isFinite(ml) && field(resp, 'monthlyLimit') !== null) s.monthlyLimit = ml;
    writeState(s);
  } catch { /* state is best effort */ }
}

function clearBlocked() {
  try { fs.unlinkSync(stateFile()); } catch { /* none */ }
}

function isBlocked() {
  try {
    const s = JSON.parse(fs.readFileSync(stateFile(), 'utf8'));
    return !!(s && s.blocked && typeof s.until === 'number' && s.until > Date.now());
  } catch { return false; }
}

// Null when not blocked. minutesLeft is rounded up.
function cooldownInfo() {
  try {
    const s = readState(), now = Date.now();
    if (!s || !s.blocked || typeof s.until !== 'number' || s.until <= now) return null;
    return {
      reason: s.reason || 'monthly', until: s.until, untilIso: new Date(s.until).toISOString().replace('.000Z', 'Z'),
      minutesLeft: Math.ceil((s.until - now) / 60000), untilSource: s.untilSource || 'fallback',
    };
  } catch { return null; }
}

// True only while a cooldown is live (blocked && until > now) AND probeAfter <= now: lets ONE
// call through to test whether Memtrace is back. Pair with claimProbe() so concurrent
// agents serialize: the winner proceeds, the rest stay denied until its result lands.
function probeDue() {
  try {
    const s = readState();
    return !!(s && s.blocked && typeof s.until === 'number' && s.until > Date.now() &&
      typeof s.probeAfter === 'number' && s.probeAfter <= Date.now());
  } catch { return false; }
}

// Pushes probeAfter to now+60s and bumps probes; true when this caller won the probe.
// (Read-then-write is not atomic across processes; a rename-based lock keeps it tight.)
function claimProbe() {
  try {
    if (!probeDue()) return false;
    const lock = stateFile() + '.lock';
    try { fs.mkdirSync(lock); } catch (e) {
      try { if (Date.now() - fs.statSync(lock).mtimeMs > 10000) fs.rmdirSync(lock); } catch { /* ignore */ }
      return false;
    }
    try {
      const s = readState(), now = Date.now();
      if (!s || !(s.probeAfter <= now)) return false;
      s.probeAfter = now + PROBE_CLAIM_MS;
      s.probes = (typeof s.probes === 'number' ? s.probes : 0) + 1;
      writeState(s);
      return true;
    } finally { try { fs.rmdirSync(lock); } catch { /* ignore */ } }
  } catch { return false; }
}

function hoursText(mins) {
  return mins >= 90 ? 'about ' + Math.round(mins / 60) + ' h' : 'about ' + mins + ' min';
}

const WHAT = { monthly: 'out of quota', daily: 'out of daily quota', auth: 'unauthenticated', unreachable: 'unreachable' };

// The fallback instruction, with the return time when a cooldown is live.
function codegraphRoute() {
  const c = cooldownInfo();
  const how = 'use CodeGraph instead (codegraph_explore / codegraph explore "<question>", codegraph node -f <file>, ' +
    'codegraph query|callers|callees|impact <symbol>); do not retry mcp__memtrace__* and do not fall back to grep';
  if (!c) return 'Memtrace is out of quota; ' + how;
  return 'Memtrace is ' + (WHAT[c.reason] || 'unavailable') + ' until ' + c.untilIso + ' (' + hoursText(c.minutesLeft) + '); ' + how;
}

const CODEGRAPH_ROUTE =
  'Memtrace quota is exhausted. Use CodeGraph for ALL code discovery until it resets, and keep working: ' +
  'find_symbol -> `codegraph query <symbol>`; find_code -> mcp__codegraph__codegraph_explore "<question>"; ' +
  'get_source_window -> mcp__codegraph__codegraph_node {file, offset, limit, projectPath} (file mode, no symbol); ' +
  'get_symbol_context -> `codegraph node|callers|callees <symbol>`; get_impact -> `codegraph impact <symbol>`. ' +
  'Do not retry mcp__memtrace__* and do not fall back to grep.';

module.exports = {
  responseIsQuotaBlocked, blockReasonOf, periodEndOf, markBlocked, clearBlocked, isBlocked,
  cooldownInfo, probeDue, claimProbe, codegraphRoute, CODEGRAPH_ROUTE,
};
