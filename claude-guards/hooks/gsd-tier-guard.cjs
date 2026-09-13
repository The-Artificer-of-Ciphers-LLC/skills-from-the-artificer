#!/usr/bin/env node
// gsd-hook-version: 1.0.0
// gsd-tier-guard.cjs — PreToolUse guard on Write|Edit|MultiEdit.
//
// Rule (~/.claude/CLAUDE.md AGENT-TIER DISCIPLINE): opus is the architect;
// hand-authoring code in the opus MAIN session is scope opus should be
// delegating to a sonnet-coder subagent. This guard makes that concrete by
// denying opus-authored Write/Edit/MultiEdit calls that touch a code path,
// while leaving config/docs/markdown (the "text is the product" files) and
// tiny surgical edits alone.
//
// Standalone by design (no sibling `require`) — hook scripts are staged
// individually and a cross-file require is a staging dependency that can
// fail silently in that path. This is why tier classification and the Kimi
// alias table are duplicated here rather than shared with
// gsd-session-model.cjs.
//
// Fail-open contract: any unexpected error anywhere below results in a
// silent exit(0). A guard that can wedge Write/Edit for every session on an
// internal bug is worse than a guard that occasionally misses — so every
// failure mode here defaults to "let the call through", never to "block".

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const STATE_DIR = path.join(os.homedir(), '.claude', 'state', 'gsd-tier');
const SESSION_ID_RE = /^[A-Za-z0-9._-]+$/;

// Same Kimi tool-name aliasing convention used by gsd-read-guard.js: Kimi's
// native hook bus delivers its own tool vocabulary (and sometimes a
// module-qualified name like 'kimi_cli.tools.file:WriteFile'), so we
// normalize before matching. A Map, not an object literal, so a bare
// bracket lookup can never resolve a prototype key ('constructor',
// '__proto__') to a truthy value.
const KIMI_TOOL_NAMES = new Map([
  ['WriteFile', 'Write'],
  ['StrReplaceFile', 'Edit'],
]);

const NON_CODE_EXTENSIONS = new Set([
  '.md', '.mdx', '.markdown', '.txt', '.rst', '.adoc',
  '.json', '.jsonc', '.json5', '.yml', '.yaml', '.toml', '.ini', '.cfg', '.conf', '.properties',
  '.csv', '.tsv', '.lock', '.patch', '.diff',
  '.svg', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.pdf',
  '.html', '.htm', '.css', '.scss', '.less',
]);

const CODE_EXTENSIONS = new Set([
  '.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs',
  '.py', '.go', '.rs', '.rb', '.java', '.kt', '.kts', '.swift',
  '.m', '.c', '.h', '.cc', '.cpp', '.hpp', '.cs', '.php',
  '.sh', '.bash', '.zsh', '.fish', '.sql', '.vue', '.svelte',
  '.scala', '.ex', '.exs', '.lua', '.pl', '.pm', '.r', '.dart', '.gradle', '.tf',
]);

const EXEMPT_DIR_SEGMENTS = ['.planning/', '.changeset/', 'docs/', 'node_modules/', '.git/'];

function classifyTier(modelId) {
  const id = String(modelId || '').toLowerCase();
  if (id.includes('opus')) return 'opus';
  if (id.includes('sonnet')) return 'sonnet';
  if (id.includes('haiku')) return 'haiku';
  if (id.includes('fable')) return 'fable';
  return 'unknown';
}

function normalizeToolName(rawName) {
  if (typeof rawName !== 'string') return rawName;
  const bare = rawName.slice(rawName.lastIndexOf(':') + 1);
  return KIMI_TOOL_NAMES.get(bare) || rawName;
}

// Tier lookup is keyed off the SessionStart record written by
// gsd-session-model.cjs. Any failure to read/parse it (record not yet
// written, corrupted, session_id not recognized) falls back to classifying
// $ANTHROPIC_MODEL directly rather than throwing — an absent tier record is
// not an error condition, it's just a session we haven't seen a
// SessionStart for yet (or a runtime that doesn't emit one).
function resolveTier(payload) {
  const sessionId = payload && payload.session_id;
  if (typeof sessionId === 'string' && SESSION_ID_RE.test(sessionId)) {
    try {
      const raw = fs.readFileSync(path.join(STATE_DIR, `${sessionId}.json`), 'utf8');
      const record = JSON.parse(raw);
      if (record && typeof record.tier === 'string' && record.tier) return record.tier;
    } catch {
      // Missing/unreadable/malformed — fall through to env classification.
    }
  }
  return classifyTier(process.env.ANTHROPIC_MODEL);
}

function parseEnvInt(raw, fallback) {
  if (raw === undefined || raw === null || raw === '') return fallback;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return n;
}

function isCodePath(rawPath) {
  // Backslashes are normalized unconditionally so directory/segment matching
  // is platform-independent regardless of what separator the caller used.
  const normalized = rawPath.replace(/\\/g, '/');
  const ext = path.extname(normalized).toLowerCase();
  const segments = normalized.split('/').filter(Boolean);

  // Dotfile exemption (.env, .gitignore, etc): a segment starting with '.'
  // whose extension is not itself a recognized code extension is config,
  // not code. A dotDIR containing real code (e.g. .config/foo.ts) is NOT
  // exempted by this branch since .ts is a code extension.
  const hasDotSegment = segments.some((s) => s.startsWith('.'));
  if (hasDotSegment && !CODE_EXTENSIONS.has(ext)) return false;

  if (NON_CODE_EXTENSIONS.has(ext)) return false;

  for (const dir of EXEMPT_DIR_SEGMENTS) {
    if (normalized.includes(dir)) return false;
  }

  if (!ext) return false; // no extension at all -> exempt

  // Everything else — including the explicit CODE_EXTENSIONS list, kept
  // above purely for documentation/readability — is treated as code.
  return true;
}

function ratchetFilePath(sessionKey) {
  return path.join(STATE_DIR, `${sessionKey}.edits`);
}

// Ratchet: opus gets a small budget of sub-threshold "surgical" edits per
// session before even tiny code edits must go through sonnet-coder. This
// exists because a stream of many small edits is functionally equivalent to
// hand-authoring a file, just chunked to dodge the per-call size gate.
function incrementRatchet(sessionKey) {
  const file = ratchetFilePath(sessionKey);
  let count = 0;
  try {
    const raw = fs.readFileSync(file, 'utf8').trim();
    const parsed = Number.parseInt(raw, 10);
    if (Number.isFinite(parsed) && parsed >= 0) count = parsed;
  } catch {
    count = 0; // no counter yet, or unreadable -> start fresh
  }
  count += 1;
  try {
    fs.mkdirSync(STATE_DIR, { recursive: true });
    fs.writeFileSync(file, String(count));
  } catch {
    // Best-effort persistence: if we can't write, this call's own decision
    // is still correct (count is in memory); we just won't remember it for
    // the next call in this session.
  }
  return count;
}

function denyOutput(targetPath, note) {
  let reason =
    'OPUS CODE-WRITE BLOCKED: opus is the architect; code generation is delegated to a ' +
    'sonnet-coder subagent (AGENT-TIER DISCIPLINE). Target: ' + targetPath + '. ' + note + ' ' +
    'Dispatch instead: Agent({ subagent_type: "sonnet-coder", model: "sonnet", prompt: ' +
    '"Edit <exact file>: <exact change>. Verify with: <exact command>." }) — state the exact ' +
    'file, exact change, and verification command in the brief. ' +
    'Bypass: set GSD_TIER_GUARD=off for this call if the edit is genuinely architectural';
  if (reason.length > 900) reason = reason.slice(0, 897) + '...';
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: reason,
    },
  }));
}

// Shared by both deny sites (Write-on-code, oversized Edit/MultiEdit): in
// warn-only mode (tier unknown + GSD_TIER_GUARD_UNKNOWN=warn) we never
// actually deny — an unclassified tier is a guess, not a confirmed opus
// session, so the guard degrades to advisory-only rather than blocking.
function handleDeny(mode, targetPath, note) {
  if (mode === 'warn') {
    process.stderr.write(`gsd-tier-guard: [warn-only, tier=unknown] would deny "${targetPath}": ${note}\n`);
    return;
  }
  denyOutput(targetPath, note);
}

function main() {
  if (process.env.GSD_TIER_GUARD === 'off') return; // explicit escape hatch

  let raw = '';
  try {
    raw = fs.readFileSync(0, 'utf8');
  } catch {
    return; // no stdin — nothing to guard
  }
  if (!raw || !raw.trim()) return;

  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    return; // malformed payload — fail open
  }

  // Inside a subagent is exactly where code should be authored — a
  // sonnet-coder dispatch IS this guard's remedy, so its own writes must
  // pass through untouched or the remedy would deadlock against itself.
  if (typeof payload.agent_id === 'string' && payload.agent_id.length > 0) return;

  const tool = normalizeToolName(payload.tool_name);
  if (tool !== 'Write' && tool !== 'Edit' && tool !== 'MultiEdit') return;

  const input = (payload.tool_input && typeof payload.tool_input === 'object') ? payload.tool_input : {};

  // tool_input.path is authoritative over file_path (Kimi StrReplaceFile/WriteFile shape).
  let targetPath = '';
  if (typeof input.path === 'string' && input.path.length > 0) {
    targetPath = input.path;
  } else if (typeof input.file_path === 'string' && input.file_path.length > 0) {
    targetPath = input.file_path;
  }
  if (!targetPath) return;

  const tier = resolveTier(payload);
  if (tier === 'sonnet' || tier === 'haiku' || tier === 'fable') return;

  let mode;
  if (tier === 'opus') {
    mode = 'enforce';
  } else {
    // tier === 'unknown'
    const unknownPolicy = process.env.GSD_TIER_GUARD_UNKNOWN;
    if (unknownPolicy === 'off') return;
    mode = unknownPolicy === 'warn' ? 'warn' : 'enforce';
  }

  if (!isCodePath(targetPath)) return;

  const rawSessionId = typeof payload.session_id === 'string' ? payload.session_id : '';
  const sessionKey = SESSION_ID_RE.test(rawSessionId)
    ? rawSessionId
    : (rawSessionId ? rawSessionId.replace(/[^A-Za-z0-9._-]/g, '_') : 'unknown-session');

  // Write on a code path is whole-file authoring — always code generation,
  // never subject to the small-edit ratchet.
  if (tool === 'Write') {
    handleDeny(mode, targetPath, 'Whole-file authoring ("Write") on a code path is always code generation.');
    return;
  }

  // Edit / MultiEdit — collect all new_string payloads to size the change.
  const newStrings = [];
  if (typeof input.new_string === 'string') newStrings.push(input.new_string);
  if (Array.isArray(input.edits)) {
    for (const edit of input.edits) {
      if (edit && typeof edit.new_string === 'string') newStrings.push(edit.new_string);
    }
  }
  const joined = newStrings.join('');
  const changedChars = joined.length;
  const changedLines = (joined.match(/\n/g) || []).length + 1;

  const maxLines = parseEnvInt(process.env.GSD_TIER_GUARD_MAX_LINES, 3);
  const maxChars = parseEnvInt(process.env.GSD_TIER_GUARD_MAX_CHARS, 240);

  if (changedLines > maxLines || changedChars > maxChars) {
    handleDeny(
      mode,
      targetPath,
      `Edit exceeds the small-edit threshold (${changedLines} lines / ${changedChars} chars vs limit ${maxLines}/${maxChars}).`
    );
    return;
  }

  // Sub-threshold edit: allowed, but metered by the per-session ratchet
  // rather than unconditionally — see incrementRatchet() for why.
  const freeEdits = parseEnvInt(process.env.GSD_TIER_GUARD_FREE_EDITS, 5);
  const count = incrementRatchet(sessionKey);

  if (count <= freeEdits) {
    process.stderr.write(
      `gsd-tier-guard: sub-threshold edit ${count}/${freeEdits} allowed for opus this session (${targetPath}).\n`
    );
    return;
  }

  if (mode === 'warn') {
    process.stderr.write(
      `gsd-tier-guard: [warn-only, tier=unknown] small-edit budget (${freeEdits}) exhausted (count=${count}); would deny in enforce mode: ${targetPath}\n`
    );
    return;
  }

  denyOutput(
    targetPath,
    `The small-edit budget (${freeEdits} free sub-threshold edits) for this session is exhausted (count=${count}). Remaining edits must be batched into one sonnet-coder dispatch.`
  );
}

try {
  main();
} catch {
  // Fail open unconditionally — see module header.
}
process.exit(0);
