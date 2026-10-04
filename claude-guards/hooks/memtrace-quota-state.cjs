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

function markBlocked(resp) {
  try {
    const f = stateFile();
    fs.mkdirSync(path.dirname(f), { recursive: true });
    const now = Date.now();
    const end = periodEndOf(resp);
    fs.writeFileSync(f, JSON.stringify({ blocked: true, ts: now, until: end && end > now ? Math.min(end, now + 24 * 3600e3) : now + FALLBACK_TTL_MS }));
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

const CODEGRAPH_ROUTE =
  'Memtrace quota is exhausted. Use CodeGraph for ALL code discovery until it resets, and keep working: ' +
  'find_symbol -> `codegraph query <symbol>`; find_code -> mcp__codegraph__codegraph_explore "<question>"; ' +
  'get_source_window -> mcp__codegraph__codegraph_node {file, offset, limit, projectPath} (file mode, no symbol); ' +
  'get_symbol_context -> `codegraph node|callers|callees <symbol>`; get_impact -> `codegraph impact <symbol>`. ' +
  'Do not retry mcp__memtrace__* and do not fall back to grep.';

module.exports = { responseIsQuotaBlocked, markBlocked, clearBlocked, isBlocked, CODEGRAPH_ROUTE };
