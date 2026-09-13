#!/usr/bin/env node
// gsd-hook-version: 1.0.0
// session-model.cjs — SessionStart hook.
//
// Records the main session's model/tier to disk so a later PreToolUse hook
// (tier-guard.cjs) can know, cheaply and without re-deriving it, whether
// the CURRENT session is running under opus. SessionStart payloads may carry
// a `model` field but it is not guaranteed present across runtimes/versions,
// so we fall back through env before landing on 'unknown'. Standalone by
// design (no sibling `require`) — hook scripts are staged individually and a
// cross-file require can fail silently in that staging path.
//
// Fail-open contract: this hook must NEVER throw or block session start. Any
// unexpected error anywhere in the body results in a silent exit(0) — a
// broken recorder hook must not wedge the session, and losing the tier
// record just means tier-guard falls back to env-based classification.

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const STATE_DIR = path.join(os.homedir(), '.claude', 'state', 'gsd-tier');
const SESSION_ID_RE = /^[A-Za-z0-9._-]+$/;
const PRUNE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

function classifyTier(modelId) {
  const id = String(modelId || '').toLowerCase();
  if (id.includes('opus')) return 'opus';
  if (id.includes('sonnet')) return 'sonnet';
  if (id.includes('haiku')) return 'haiku';
  if (id.includes('fable')) return 'fable';
  return 'unknown';
}

function resolveModelId(payload) {
  const m = payload && payload.model;
  if (typeof m === 'string' && m.length > 0) return m;
  if (m && typeof m === 'object') {
    if (typeof m.id === 'string' && m.id.length > 0) return m.id;
    if (typeof m.display_name === 'string' && m.display_name.length > 0) return m.display_name;
  }
  if (typeof process.env.ANTHROPIC_MODEL === 'string' && process.env.ANTHROPIC_MODEL.length > 0) {
    return process.env.ANTHROPIC_MODEL;
  }
  return 'unknown';
}

// Best-effort prune of stale per-session records. Wrapped so a prune failure
// (e.g. permissions, concurrent deletion by another session) never prevents
// this hook from writing its own record or from exiting cleanly.
function pruneStale(dir) {
  try {
    const now = Date.now();
    for (const entry of fs.readdirSync(dir)) {
      const full = path.join(dir, entry);
      try {
        const st = fs.statSync(full);
        if (st.isFile() && now - st.mtimeMs > PRUNE_MAX_AGE_MS) {
          fs.unlinkSync(full);
        }
      } catch {
        // Ignore per-entry errors (race with deletion, permission, etc).
      }
    }
  } catch {
    // Ignore directory-level errors — pruning is best-effort only.
  }
}

function main() {
  let raw = '';
  try {
    raw = fs.readFileSync(0, 'utf8');
  } catch {
    return; // no stdin available — nothing to record
  }
  if (!raw || !raw.trim()) return;

  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    return; // malformed payload — fail open, nothing to record
  }

  const sessionId = payload && payload.session_id;
  if (typeof sessionId !== 'string' || sessionId.length === 0) return;
  // Filename safety: session_id lands directly in a path segment below, so a
  // hostile/malformed id (path separators, '..', etc.) must never reach fs.
  if (!SESSION_ID_RE.test(sessionId)) return;

  const modelId = resolveModelId(payload);
  const tier = classifyTier(modelId);

  fs.mkdirSync(STATE_DIR, { recursive: true });

  const record = {
    sessionId,
    model: modelId,
    tier,
    recordedAt: new Date().toISOString(),
  };
  fs.writeFileSync(path.join(STATE_DIR, `${sessionId}.json`), JSON.stringify(record));

  pruneStale(STATE_DIR);
}

try {
  main();
} catch {
  // Fail open unconditionally — a defect in this recorder must never block
  // or degrade session start.
}
process.exit(0);
