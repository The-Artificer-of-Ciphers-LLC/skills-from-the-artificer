#!/usr/bin/env node
// gsd-hook-version: 1.1.0
// gsd-worktree-guard.cjs — PreToolUse guard on Write|Edit|MultiEdit.
//
// Rule: never do agentic coding in the MAIN checkout — always in a linked
// git worktree. Detection: `git rev-parse --git-dir --git-common-dir` run in
// the target file's directory (falling back to payload.cwd). In a linked
// worktree the two differ (".../.git/worktrees/<name>" vs ".../.git"); in
// the main checkout they are the same path.
//
// Per-repo opt-out: a repo that deliberately develops on main can commit a
// `.gsd/main-checkout-ok` marker at its root. Preferred over the
// GSD_WORKTREE_GUARD_OFF env bypass because the marker is version-controlled
// and repo-scoped — the choice is visible in review and cannot leak into
// sibling repos the way an exported env var does.
//
// Fail-open contract: any git error, non-repo target, or unexpected failure
// anywhere below resolves to ALLOW. This guard exists to stop code writes in
// the main checkout, not to block config/docs edits or edits outside any
// repo entirely.

'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ALLOWED_EXTS = new Set(['.md', '.json', '.yml', '.yaml', '.toml', '.txt']);
const EXEMPT_DIR_SEGMENTS = ['.gsd', '.claude', '.git'];
const MAIN_CHECKOUT_MARKER = path.join('.gsd', 'main-checkout-ok');

function normalizeSlashes(p) {
  return String(p || '').replace(/\\/g, '/');
}

function isExemptDir(targetPath) {
  const norm = normalizeSlashes(targetPath);
  const segments = norm.split('/').filter(Boolean);
  return segments.some((seg) => EXEMPT_DIR_SEGMENTS.includes(seg));
}

function isAllowedExt(targetPath) {
  const ext = path.extname(normalizeSlashes(targetPath)).toLowerCase();
  return ALLOWED_EXTS.has(ext);
}

function resolveAbsolute(baseDir, maybeRelative) {
  try {
    const abs = path.isAbsolute(maybeRelative) ? maybeRelative : path.resolve(baseDir, maybeRelative);
    try {
      return fs.realpathSync(abs);
    } catch {
      return path.normalize(abs);
    }
  } catch {
    return null;
  }
}

// Attempts `git rev-parse --git-dir --git-common-dir` first in `targetDir`,
// then in `fallbackCwd`. Returns { gitDirAbs, commonDirAbs } or null if git
// errored / not a repo in either location.
function resolveGitDirs(targetDir, fallbackCwd) {
  const candidates = [targetDir, fallbackCwd].filter((d) => typeof d === 'string' && d.length > 0);
  for (const dir of candidates) {
    try {
      const out = execFileSync(
        'git',
        ['rev-parse', '--git-dir', '--git-common-dir'],
        { cwd: dir, timeout: 5000, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }
      );
      const lines = out.split('\n').map((s) => s.trim()).filter(Boolean);
      if (lines.length >= 2) {
        const gitDirAbs = resolveAbsolute(dir, lines[0]);
        const commonDirAbs = resolveAbsolute(dir, lines[1]);
        if (gitDirAbs && commonDirAbs) return { gitDirAbs, commonDirAbs };
      }
    } catch {
      // Not a repo here, git missing, or timed out — try the next candidate.
    }
  }
  return null;
}

function readStdin(timeoutMs) {
  return new Promise((resolve) => {
    let data = '';
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };
    const timer = setTimeout(() => finish(null), timeoutMs);
    if (typeof timer.unref === 'function') timer.unref();
    try {
      process.stdin.setEncoding('utf8');
      process.stdin.on('data', (chunk) => { data += chunk; });
      process.stdin.on('end', () => { clearTimeout(timer); finish(data); });
      process.stdin.on('error', () => { clearTimeout(timer); finish(null); });
      process.stdin.resume();
    } catch {
      clearTimeout(timer);
      finish(null);
    }
  });
}

// A repo can opt out of the worktree requirement by committing a
// `.gsd/main-checkout-ok` marker at its root. `commonDirAbs` is the repo's
// `.git` directory, so the root is its parent.
function hasMainCheckoutOptOut(commonDirAbs) {
  try {
    return fs.existsSync(path.join(path.dirname(commonDirAbs), MAIN_CHECKOUT_MARKER));
  } catch {
    return false;
  }
}

function allowOutput() {
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: { hookEventName: 'PreToolUse' },
  }));
}

function denyOutput(targetPath) {
  const reason =
    `WORKTREE GUARD: "${targetPath}" is in the MAIN checkout — agentic coding must happen in a ` +
    'linked git worktree. Create one and MOVE THE SESSION INTO IT: ' +
    '`git worktree add <repo>/.claude/worktrees/<slug> -b <prefix>/<issue>-<slug> <base>`, then ' +
    'EnterWorktree with `path:` (creating the worktree is not enough — the session cwd must be ' +
    'inside it). Why: /security-review substitutes `git diff` in the SESSION cwd; the push gate ' +
    'resolves HEAD from the session worktree; Memtrace binds its overlay to the session cwd. ' +
    'Bypass: set GSD_WORKTREE_GUARD_OFF=1 for this call if this is a deliberate main-checkout edit.' +
    ' Per-repo opt-out: commit an empty `.gsd/main-checkout-ok` marker at the repo root if this repo develops on main by design.';
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: reason,
    },
  }));
}

async function main() {
  if (process.env.GSD_WORKTREE_GUARD_OFF === '1') return allowOutput();

  const raw = await readStdin(4000);
  if (!raw || !raw.trim()) return allowOutput();

  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    return allowOutput();
  }
  if (!payload || typeof payload !== 'object') return allowOutput();

  const tool = payload.tool_name;
  if (tool !== 'Write' && tool !== 'Edit' && tool !== 'MultiEdit') return allowOutput();

  const input = (payload.tool_input && typeof payload.tool_input === 'object') ? payload.tool_input : {};
  let targetPath = '';
  if (typeof input.file_path === 'string' && input.file_path) {
    targetPath = input.file_path;
  } else if (typeof input.path === 'string' && input.path) {
    targetPath = input.path;
  }
  if (!targetPath) return allowOutput();

  if (isExemptDir(targetPath)) return allowOutput();
  if (isAllowedExt(targetPath)) return allowOutput();

  const fallbackCwd = typeof payload.cwd === 'string' && payload.cwd ? payload.cwd : process.cwd();
  const targetDir = path.isAbsolute(targetPath) ? path.dirname(targetPath) : fallbackCwd;

  const dirs = resolveGitDirs(targetDir, fallbackCwd);
  if (!dirs) return allowOutput(); // git error / not a repo — nothing to enforce

  if (dirs.gitDirAbs === dirs.commonDirAbs) {
    if (hasMainCheckoutOptOut(dirs.commonDirAbs)) return allowOutput();
    return denyOutput(targetPath);
  }
  return allowOutput();
}

main()
  .catch(() => { try { allowOutput(); } catch { /* ignore */ } })
  .finally(() => process.exit(0));
