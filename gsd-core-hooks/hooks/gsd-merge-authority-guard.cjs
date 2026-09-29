#!/usr/bin/env node
'use strict';

/**
 * gsd-merge-authority-guard.cjs — PreToolUse(Bash) merge authority gate.
 *
 * ## Why this exists
 *
 * The only acceptable reason to admin-merge a PR is "needs a second review
 * besides self" on the maintainer's OWN PR (author trek-e; GSD_MERGE_ADMIN_AUTHOR
 * overrides). A contributor's PR never gets the bypass. Anything else -- red, pending, or never-run required check,
 * branch BEHIND base, conflict, draft -- is a no-go, with or without
 * --admin. `gh pr merge --admin` with enforce_admins=false skips ALL branch
 * protections at once, so this gate queries GitHub LIVE at merge time and
 * never trusts a locally recorded artifact.
 *
 * A 2026-09-25 audit of 120 merges into `next` found admin merges past a red
 * Required tests check (#4971, #4737), admin merges before any check had even
 * started (#4646, #4707, #4708), and 24 merges while BEHIND next.
 *
 * ## Failure posture
 *
 * Fails CLOSED: any `gh pr merge` / raw API merge whose live state cannot be
 * established (gh error, compare error) is denied, not allowed through.
 * Human escape: GSD_MERGE_GATE_OVERRIDE=1 (logged).
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

function readStdin() {
  try { return fs.readFileSync(0, 'utf8'); } catch { return ''; }
}

let payload = {};
try { payload = JSON.parse(readStdin() || '{}'); } catch { payload = {}; }

const input = payload.tool_input || {};
const command = String(input.command || '');
const cwdBase = String(payload.cwd || process.cwd());

function allow() { process.exit(0); }

function deny(reason) {
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: reason,
    },
  }));
  process.exit(0);
}

const TAIL =
  'Admin merge is permitted for exactly one reason: the ONLY outstanding ' +
  'blocker is the missing second review (reviewDecision REVIEW_REQUIRED) ' +
  'on a PR authored by the maintainer (trek-e). ' +
  'Every check green on the current head, branch up to date with its base, ' +
  'no conflict. Anything else is a no-go -- do not retry with a different ' +
  'merge form; fix the cause or hand it to the maintainer.\n' +
  'Human escape (never self-issue): prefix GSD_MERGE_GATE_OVERRIDE=1.';

function fail(msg) {
  deny(`MERGE AUTHORITY GATE — ${msg}\n${TAIL}`);
}

const PR_MERGE = /(^|[\s;&|(])gh\s+pr\s+merge(\s|$)/;
const API_MERGE = /(^|[\s;&|(])gh\s+api\b[^\n]*(pulls\/[0-9]+\/merge\b|mergePullRequest)/;

if (!PR_MERGE.test(command) && !API_MERGE.test(command)) allow();

// -- Human escape, logged -----------------------------------------------
if (/GSD_MERGE_GATE_OVERRIDE=1/.test(command) || process.env.GSD_MERGE_GATE_OVERRIDE === '1') {
  try {
    const logPath = path.join(os.homedir(), '.claude', 'gsd-merge-gate-override.log');
    fs.mkdirSync(path.dirname(logPath), { recursive: true });
    fs.appendFileSync(
      logPath,
      `${new Date().toISOString()}  ${cwdBase}  ${command.slice(0, 300)}\n`,
    );
  } catch { /* best effort */ }
  allow();
}

if (API_MERGE.test(command)) {
  fail(
    'raw API merge is not permitted; same admin bypass as --admin with ' +
    'nothing to inspect; use gh pr merge',
  );
}

// -- Resolve runCwd from a leading `cd <dir>` ----------------------------
const cdMatch = command.match(/(?:^|&&|;)\s*cd\s+("[^"]+"|'[^']+'|[^\s&;|]+)/);
let runCwd = cwdBase;
if (cdMatch) {
  let candidate = cdMatch[1].replace(/^['"]|['"]$/g, '');
  if (candidate.startsWith('~')) {
    candidate = path.join(os.homedir(), candidate.slice(1));
  }
  try {
    if (fs.statSync(candidate).isDirectory()) runCwd = candidate;
  } catch { /* keep cwdBase */ }
}

// -- Tokenize the `gh pr merge ...` segment (quote-aware, stop at ; & | \n) --
function extractMergeSegment(cmd) {
  const idx = cmd.search(PR_MERGE);
  const start = cmd.indexOf('gh', idx);
  let i = start;
  let inS = false;
  let inD = false;
  let out = '';
  while (i < cmd.length) {
    const ch = cmd[i];
    if (inS) {
      out += ch;
      if (ch === "'") inS = false;
    } else if (inD) {
      out += ch;
      if (ch === '"') inD = false;
    } else {
      if (ch === "'") { inS = true; out += ch; }
      else if (ch === '"') { inD = true; out += ch; }
      else if (ch === ';' || ch === '&' || ch === '|' || ch === '\n') break;
      else out += ch;
    }
    i += 1;
  }
  return out;
}

function tokenize(segment) {
  const tokens = [];
  let cur = '';
  let inS = false;
  let inD = false;
  let started = false;
  for (let i = 0; i < segment.length; i += 1) {
    const ch = segment[i];
    if (inS) {
      if (ch === "'") inS = false; else cur += ch;
      started = true;
      continue;
    }
    if (inD) {
      if (ch === '"') inD = false; else cur += ch;
      started = true;
      continue;
    }
    if (ch === "'") { inS = true; started = true; continue; }
    if (ch === '"') { inD = true; started = true; continue; }
    if (/\s/.test(ch)) {
      if (started) { tokens.push(cur); cur = ''; started = false; }
      continue;
    }
    cur += ch;
    started = true;
  }
  if (started) tokens.push(cur);
  return tokens;
}

const segment = extractMergeSegment(command);
const allTokens = tokenize(segment);
// allTokens[0] === 'gh', allTokens[1] === 'pr', allTokens[2] === 'merge'
const tokens = allTokens.slice(3);

const VALUE_FLAGS = new Set([
  '-b', '--body', '-F', '--body-file', '-t', '--subject',
  '-A', '--author-email', '--match-head-commit', '-R', '--repo',
]);

let admin = false;
let repo = '';
let target = '';
let disableAuto = false;

for (let i = 0; i < tokens.length; i += 1) {
  const tok = tokens[i];
  if (tok === '--admin') { admin = true; continue; }
  if (tok === '--disable-auto') { disableAuto = true; continue; }
  if (tok.startsWith('--repo=')) { repo = tok.slice('--repo='.length); continue; }
  if (tok.startsWith('-R=')) { repo = tok.slice('-R='.length); continue; }
  if (VALUE_FLAGS.has(tok)) {
    const val = tokens[i + 1];
    if (tok === '-R' || tok === '--repo') repo = val || '';
    i += 1;
    continue;
  }
  if (tok.startsWith('-')) continue; // other boolean flags
  if (!target) { target = tok; continue; }
}

if (disableAuto) allow();

function gh(args) {
  return execFileSync('gh', args, {
    cwd: runCwd,
    encoding: 'utf8',
    timeout: 20000,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

const viewArgs = ['pr', 'view'];
if (target) viewArgs.push(target);
if (repo) viewArgs.push('--repo', repo);
viewArgs.push(
  '--json',
  'number,url,isDraft,author,baseRefName,headRefOid,mergeable,mergeStateStatus,reviewDecision,statusCheckRollup',
);

let prJsonRaw;
try {
  prJsonRaw = gh(viewArgs);
} catch (err) {
  const stderr = err && err.stderr ? String(err.stderr).trim() : String(err && err.message || err);
  fail(`could not read live PR state (${stderr.slice(0, 300)}); fail closed`);
}

let pr;
try {
  pr = JSON.parse(prJsonRaw);
} catch {
  fail('could not parse `gh pr view` output; fail closed');
}

const urlMatch = /github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/.exec(pr.url || '');
const repoSlug = urlMatch ? `${urlMatch[1]}/${urlMatch[2]}` : repo;
const label = `PR #${pr.number} (${repoSlug || 'unknown/repo'}, head ${String(pr.headRefOid || '').slice(0, 10)})`;

if (pr.isDraft) {
  fail(`${label} is a draft; drafts cannot be merged`);
}

if (pr.mergeable === 'CONFLICTING' || pr.mergeStateStatus === 'DIRTY') {
  fail(`${label} has a merge conflict with ${pr.baseRefName}`);
}

if (pr.mergeable !== 'MERGEABLE') {
  fail(`${label} mergeable state is ${pr.mergeable || 'UNKNOWN'}; not computed, re-query`);
}

// -- Behind check ----------------------------------------------------------
let compareRaw;
try {
  compareRaw = gh([
    'api',
    `repos/${repoSlug}/compare/${pr.baseRefName}...${pr.headRefOid}`,
    '--jq', '{behind_by}',
  ]);
} catch (err) {
  const stderr = err && err.stderr ? String(err.stderr).trim() : String(err && err.message || err);
  fail(`could not compute behind-by against ${pr.baseRefName} (${stderr.slice(0, 300)}); fail closed`);
}

let compare;
try {
  compare = JSON.parse(compareRaw);
} catch {
  fail('could not parse compare output; fail closed');
}

if (typeof compare.behind_by === 'number' && compare.behind_by > 0) {
  fail(
    `${label} is ${compare.behind_by} commit(s) BEHIND ${pr.baseRefName}. Being up ` +
    'to date is a CI condition, not a reviewer one -- the merged tree has never ' +
    'been tested. Update the branch (gh pr update-branch), let CI finish green ' +
    'on the new head, then merge. If next keeps moving, stop and hand the green ' +
    'PR to the maintainer rather than looping.',
  );
}

// -- Checks: newest per key --------------------------------------------
const rollup = Array.isArray(pr.statusCheckRollup) ? pr.statusCheckRollup : [];
const newest = new Map();

function sortKeyOf(entry) {
  return String(entry.startedAt || entry.createdAt || entry.completedAt || '');
}

for (const entry of rollup) {
  let key;
  let name;
  let state;
  if (entry.__typename === 'StatusContext') {
    key = `::${entry.context}`;
    name = entry.context;
    state = String(entry.state || '').toUpperCase();
  } else {
    key = `${entry.workflowName || ''}::${entry.name || ''}`;
    name = entry.name || key;
    state = entry.status !== 'COMPLETED'
      ? 'PENDING'
      : String(entry.conclusion || '').toUpperCase();
  }
  const existing = newest.get(key);
  if (!existing || sortKeyOf(entry) >= sortKeyOf(existing.entry)) {
    newest.set(key, { entry, name, state });
  }
}

const PENDING_STATES = new Set(['PENDING', 'EXPECTED', '', 'QUEUED', 'IN_PROGRESS', 'WAITING']);
const OK_STATES = new Set(['SUCCESS', 'SKIPPED', 'NEUTRAL']);

const pending = [];
const failed = [];
for (const { name, state } of newest.values()) {
  if (PENDING_STATES.has(state)) pending.push(name);
  else if (!OK_STATES.has(state)) failed.push(`${name}=${state}`);
}

if (pending.length) {
  fail(`checks still pending: ${pending.join(', ')} -- a merge before CI finishes is a merge past CI`);
}
if (failed.length) {
  fail(`checks failed: ${failed.join(', ')} -- a red check is never bypassable`);
}

// -- Required status checks must have reported on this head --------------
const requiredNames = new Set();
try {
  const prot = JSON.parse(gh(['api', `repos/${repoSlug}/branches/${pr.baseRefName}/protection/required_status_checks`]));
  for (const c of prot.contexts || []) requiredNames.add(c);
  for (const c of prot.checks || []) if (c && c.context) requiredNames.add(c.context);
} catch { /* ignore */ }
try {
  const rules = JSON.parse(gh(['api', `repos/${repoSlug}/rules/branches/${pr.baseRefName}`]));
  for (const r of Array.isArray(rules) ? rules : []) {
    if (r && r.type === 'required_status_checks') {
      const rscs = (r.parameters && r.parameters.required_status_checks) || [];
      for (const c of rscs) if (c && c.context) requiredNames.add(c.context);
    }
  }
} catch { /* ignore */ }

const reportedNames = new Set(Array.from(newest.values()).map((v) => v.name));
const missingRequired = Array.from(requiredNames).filter((n) => !reportedNames.has(n));
if (missingRequired.length) {
  fail(
    `required check(s) never reported on this head: ${missingRequired.join(', ')}; ` +
    'a check that never ran is not green',
  );
}

// -- Admin scope ---------------------------------------------------------
// The second-review bypass exists for the maintainer's OWN PRs only (a solo maintainer cannot
// approve their own PR). Anyone else's PR waits for a real review. Override the login with
// GSD_MERGE_ADMIN_AUTHOR (comma-separated) if the maintainer set changes.
const ADMIN_AUTHORS = String(process.env.GSD_MERGE_ADMIN_AUTHOR || 'trek-e')
  .split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
if (admin) {
  const authorLogin = String((pr.author && pr.author.login) || '').toLowerCase();
  if (!ADMIN_AUTHORS.includes(authorLogin)) {
    fail(
      `${label} is authored by ${authorLogin || 'an unknown author'}, not ${ADMIN_AUTHORS.join('/')}; ` +
      'the missing-second-review bypass applies only to the maintainer\'s own PRs. ' +
      'Someone else\'s PR needs a real approving review before it merges',
    );
  }
  if (pr.reviewDecision !== 'REVIEW_REQUIRED') {
    if (pr.reviewDecision === 'APPROVED') {
      fail(`${label} is already APPROVED; merge without --admin`);
    }
    fail(
      `${label} reviewDecision is ${pr.reviewDecision || 'null'}; only a missing ` +
      'second review (REVIEW_REQUIRED) may be bypassed',
    );
  }
}

allow();
