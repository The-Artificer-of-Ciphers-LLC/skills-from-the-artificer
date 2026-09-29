#!/usr/bin/env node
'use strict';

/**
 * pr-claim-verifier.cjs — Stop hook: a claim about a PR's CI or merge state must match GitHub NOW.
 *
 * ## Why this exists
 *
 * An agent that ran `gh pr view` earlier in a session keeps that output in context and later
 * answers from it: "CI is green, no conflicts, ready to merge" about a PR whose checks have since
 * failed or which now conflicts with its base. A rule telling it to re-check is a soft barrier; it
 * can decide the earlier look is still good enough. This hook does not trust the transcript: when
 * the final reply makes a positive state claim about a PR, it queries GitHub live and blocks the
 * stop if reality disagrees, handing the agent the live state to correct itself with.
 *
 * ## What counts as a claim (positive statements only; negated ones are ignored)
 *
 *   ci        "CI green", "checks pass(ed/ing)", "tests passing", "all green", "matrix green"
 *   conflict  "no conflicts", "no merge conflicts", "mergeable", "merges cleanly", "clean merge"
 *   uptodate  "up to date with <base>", "not behind"
 *   ready     "ready to merge", "good to merge", "safe to merge", "merge-ready"
 *
 * A claim binds to a PR when it shares a line/sentence with `#N`, `PR N`, or `.../pull/N`; when the
 * reply names exactly one PR, every claim in the reply binds to it.
 *
 * ## Live state that contradicts
 *
 *   ci        any check failed/cancelled/timed out/action_required, any still pending, or none ran
 *   conflict  mergeable CONFLICTING or mergeStateStatus DIRTY
 *   uptodate  mergeStateStatus BEHIND
 *   ready     any of the above, or draft
 *
 * ## Posture
 *
 * Fails OPEN (allows the stop, silently) when gh is missing, unauthenticated, slow (8s), or the repo
 * cannot be resolved: this hook corrects wrong claims, it is not a gate. Merge-time enforcement is
 * gsd-merge-authority-guard.cjs. Blocks at most 2 times in a row per session, then lets the stop
 * through. Disable: PR_CLAIM_VERIFIER=0. Repo: PR_CLAIM_VERIFIER_REPO=owner/name, else a
 * github.com/<owner>/<repo>/pull/N URL in the reply, else `gh repo set-default --view`.
 *
 * Output contract (Claude Code Stop decision control): {"decision":"block","reason":"..."}, exit 0.
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const MAX_STREAK = 2;
const GH_TIMEOUT_MS = 8000;

function done() { process.exit(0); }

if (process.env.PR_CLAIM_VERIFIER === '0') done();

let input = {};
try { input = JSON.parse(fs.readFileSync(0, 'utf8') || '{}'); } catch { done(); }
const cwd = String(input.cwd || process.cwd());
const sessionId = String(input.session_id || 'nosession').replace(/[^A-Za-z0-9._-]/g, '_');

// ---------------------------------------------------------------- transcript

function lastAssistantText(transcriptPath) {
  if (!transcriptPath) return '';
  let raw;
  try { raw = fs.readFileSync(transcriptPath.replace(/^~/, os.homedir()), 'utf8'); } catch { return ''; }
  const lines = raw.split('\n').filter(Boolean);
  const texts = [];
  for (let i = lines.length - 1; i >= 0; i--) {
    let e;
    try { e = JSON.parse(lines[i]); } catch { continue; }
    const role = e.type || (e.message && e.message.role);
    const content = e.message && e.message.content;
    if (role === 'user') {
      // tool results are user-role entries; a real human turn ends the scan
      const isToolResult = Array.isArray(content) && content.some((c) => c && c.type === 'tool_result');
      if (!isToolResult) break;
      continue;
    }
    if (role !== 'assistant') continue;
    if (typeof content === 'string') texts.unshift(content);
    else if (Array.isArray(content)) {
      const t = content.filter((c) => c && c.type === 'text').map((c) => c.text).join('\n');
      if (t) texts.unshift(t);
    }
    if (texts.length) break; // only the final assistant message that carries text
  }
  return texts.join('\n');
}

// ---------------------------------------------------------------- claim extraction

const PR_REF = /(?:github\.com\/([\w.-]+\/[\w.-]+)\/pull\/(\d+))|(?:\bPR\s*#?\s*(\d+)\b)|(?:#(\d{2,6})\b)/gi;
const NEGATION = /\b(not|n't|no longer|isn't|aren't|fail(?:ed|ing|s)?|red|pending|queued|running|blocked|conflicting|behind|broken)\b/i;
const CLAIMS = {
  ci: /\b(?:ci|checks?|tests?|matrix|build)\b[^.\n]{0,40}?\b(?:green|pass(?:ed|es|ing)?|succeed(?:ed|s)?)\b|\ball (?:checks )?green\b/i,
  conflict: /\bno (?:merge )?conflicts?\b|\bmerges? cleanly\b|\bclean merge\b|\bmergeable\b/i,
  uptodate: /\bup to date with\b|\bnot behind\b/i,
  ready: /\b(?:ready|good|safe|ok) to merge\b|\bmerge-ready\b/i,
};

function segments(text) {
  return text.split(/\n+|(?<=[.!?])\s+/).map((s) => s.trim()).filter(Boolean);
}

function refsIn(s) {
  const out = [];
  let m;
  PR_REF.lastIndex = 0;
  while ((m = PR_REF.exec(s))) out.push({ repo: m[1] || null, number: Number(m[2] || m[3] || m[4]) });
  return out;
}

function claimsIn(s) {
  const found = [];
  for (const [kind, re] of Object.entries(CLAIMS)) {
    const m = re.exec(s);
    if (!m) continue;
    // judge negation on the match itself plus a little context ("CI is not green", "not ready to merge");
    // NEGATION deliberately has no bare "no", so "no conflicts" stays a positive claim
    const window = s.slice(Math.max(0, m.index - 25), m.index + m[0].length + 15);
    if (NEGATION.test(window)) continue;
    found.push(kind);
  }
  return found;
}

function extract(text) {
  const segs = segments(text);
  const allRefs = new Map();
  for (const s of segs) for (const r of refsIn(s)) if (!allRefs.has(r.number)) allRefs.set(r.number, r);
  const bound = new Map(); // number -> {repo, claims:Set, quote}
  const add = (ref, kinds, quote) => {
    if (!kinds.length) return;
    const b = bound.get(ref.number) || { repo: ref.repo, claims: new Set(), quote };
    kinds.forEach((k) => b.claims.add(k));
    bound.set(ref.number, b);
  };
  for (const s of segs) {
    const refs = refsIn(s);
    const kinds = claimsIn(s);
    if (refs.length) refs.forEach((r) => add(r, kinds, s));
    else if (allRefs.size === 1) add([...allRefs.values()][0], kinds, s);
  }
  return bound;
}

// ---------------------------------------------------------------- live state

function gh(args) {
  return execFileSync('gh', args, { cwd, timeout: GH_TIMEOUT_MS, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
}

function resolveRepo(fromReply) {
  if (process.env.PR_CLAIM_VERIFIER_REPO) return process.env.PR_CLAIM_VERIFIER_REPO;
  if (fromReply) return fromReply;
  try { const r = gh(['repo', 'set-default', '--view']).trim(); if (/^[\w.-]+\/[\w.-]+$/.test(r)) return r; } catch { /* fall through */ }
  return null;
}

function liveState(repo, number) {
  const fields = 'number,state,isDraft,headRefOid,baseRefName,mergeable,mergeStateStatus,statusCheckRollup';
  return JSON.parse(gh(['pr', 'view', String(number), '--repo', repo, '--json', fields]));
}

function ciSummary(rollup) {
  const bad = [], pending = [];
  for (const c of Array.isArray(rollup) ? rollup : []) {
    const name = c.name || c.context || 'check';
    if (c.__typename === 'StatusContext' || c.state) {
      const st = String(c.state || '').toUpperCase();
      if (st === 'FAILURE' || st === 'ERROR') bad.push(name);
      else if (st === 'PENDING' || st === 'EXPECTED') pending.push(name);
      continue;
    }
    const status = String(c.status || '').toUpperCase();
    const concl = String(c.conclusion || '').toUpperCase();
    if (status && status !== 'COMPLETED') pending.push(name);
    else if (['FAILURE', 'CANCELLED', 'TIMED_OUT', 'ACTION_REQUIRED', 'STARTUP_FAILURE', 'STALE'].includes(concl)) bad.push(name);
  }
  const total = Array.isArray(rollup) ? rollup.length : 0;
  return { bad, pending, total };
}

function contradictions(claims, pr) {
  const out = [];
  const ci = ciSummary(pr.statusCheckRollup);
  const ciProblem = ci.bad.length ? `failing: ${ci.bad.slice(0, 5).join(', ')}${ci.bad.length > 5 ? ` (+${ci.bad.length - 5})` : ''}`
    : ci.pending.length ? `still running/queued: ${ci.pending.slice(0, 5).join(', ')}`
    : ci.total === 0 ? 'no checks have run' : null;
  const conflict = pr.mergeable === 'CONFLICTING' || pr.mergeStateStatus === 'DIRTY';
  const behind = pr.mergeStateStatus === 'BEHIND';
  if (pr.state && pr.state !== 'OPEN') return out; // merged/closed: state claims are history, not checkable
  if (claims.has('ci') && ciProblem) out.push(`CI is not green (${ciProblem})`);
  if (claims.has('conflict') && conflict) out.push(`it conflicts with ${pr.baseRefName || 'its base'} (mergeable=${pr.mergeable}, mergeStateStatus=${pr.mergeStateStatus})`);
  if (claims.has('uptodate') && behind) out.push(`it is BEHIND ${pr.baseRefName || 'its base'}`);
  if (claims.has('ready')) {
    const why = [ciProblem && `CI ${ciProblem}`, conflict && 'merge conflict', behind && 'behind base', pr.isDraft && 'draft'].filter(Boolean);
    if (why.length && !out.length) out.push(`it is not ready to merge (${why.join('; ')})`);
  }
  return out;
}

// ---------------------------------------------------------------- streak state

const stateDir = path.join(os.homedir(), '.claude', 'state', 'pr-claim-verifier');
const stateFile = path.join(stateDir, `${sessionId}.json`);
function readStreak() { try { return JSON.parse(fs.readFileSync(stateFile, 'utf8')).streak || 0; } catch { return 0; } }
function writeStreak(n) { try { fs.mkdirSync(stateDir, { recursive: true }); fs.writeFileSync(stateFile, JSON.stringify({ streak: n })); } catch { /* best effort */ } }

// ---------------------------------------------------------------- main

const text = lastAssistantText(input.transcript_path);
if (!text) done();
const bound = extract(text);
if (!bound.size) { writeStreak(0); done(); }

const problems = [];
for (const [number, b] of bound) {
  const repo = resolveRepo(b.repo);
  if (!repo) continue;
  let pr;
  try { pr = liveState(repo, number); } catch { continue; }
  const c = contradictions(b.claims, pr);
  if (c.length) problems.push(`- ${repo}#${number} @ ${String(pr.headRefOid || '').slice(0, 12)}: your reply says "${b.quote.slice(0, 140)}", but live GitHub state says ${c.join('; ')}.`);
}

if (!problems.length) { writeStreak(0); done(); }
const streak = readStreak();
if (streak >= MAX_STREAK) { writeStreak(0); done(); }
writeStreak(streak + 1);
process.stdout.write(JSON.stringify({
  decision: 'block',
  reason:
    'PR state claim does not match GitHub right now (pr-claim-verifier queried it live):\n' +
    problems.join('\n') +
    '\nYour earlier view of this PR is stale. Correct the statement to the live state above. Before claiming ' +
    'CI or merge state again, run `gh pr view <n> --repo <owner/repo> --json statusCheckRollup,mergeable,mergeStateStatus,headRefOid` ' +
    'in the same turn and quote the head sha.',
}));
done();
