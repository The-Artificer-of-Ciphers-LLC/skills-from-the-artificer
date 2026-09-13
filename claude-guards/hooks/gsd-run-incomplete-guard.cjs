#!/usr/bin/env node
'use strict';

/**
 * Stop hook: blocks ending the turn while a GSD run is armed but unfinished.
 *
 * Lanes checked (existence-only, in the current cwd's repo):
 *   - feature-builder: .gsd/phase/<branch-slug>/00-run.json exists, 70-docs.json does not.
 *     Next missing artifact is reported in order: 40-design.md -> 50-test-matrix.md
 *     -> 60-review.json -> 70-docs.json.
 *   - triage:          .gsd/triage/00-run.json exists, 90-summary.md does not.
 *   - bug-fixer:       .gsd/bug/queue.json has an entry still queued/in_progress, OR
 *     .gsd/bug/<branch-slug>/00-run.json exists and 80-ship.json does not. Next missing
 *     artifact is reported in order: 10-diagnosis.md -> 50-test-matrix.md -> 60-review.json
 *     -> 80-ship.json. The QUEUE check is the load-bearing one: a bug sweep's usual failure
 *     is ending the turn with issues still queued, which no per-branch artifact can express.
 *
 * Content check (blocking_issues): existence of 70-docs.json is NOT sufficient on its own.
 * Once the feature-lane's five artifacts are all present, this hook additionally scans the
 * parsed JSON of whichever of 00-run.json / 60-review.json / 70-docs.json exist for a field
 * literally named `blocking_issues` anywhere in their structure (top-level or nested), and,
 * for every issue number collected, asks `gh issue view <n> --repo <owner/repo> --json state`
 * whether it is still OPEN. This exists because of the #4634/#4619 postmortem: a run's own
 * 60-review.json/70-docs.json honestly disclosed via `scope_exclusions_verified` that two
 * "Done when" items depended on a separate, still-open issue -- and the existence-only check
 * happily let the agent stop, because it never read what was INSIDE the finished-looking
 * files. A disclosed-but-unresolved dependency is a deferral, not a completion. This check
 * fails open completely and silently if `gh` is missing, unauthenticated, times out, the repo
 * slug can't be derived from `git remote get-url origin`, or any file/field is malformed --
 * in every such case the run is simply treated as finished, exactly as before this change.
 *
 * Escape valves:
 *   1. HALT.md in the lane directory means the stop is intentional/reviewable -> allow.
 *   2. If the transcript's last assistant turn used AskUserQuestion -> allow.
 *   3. Never block more than twice in a row for the same run; the streak resets whenever
 *      the set of present artifacts changes.
 *
 * Fails OPEN on any error: not a git repo, no .gsd, unreadable/malformed files, etc.
 * All such cases simply allow the stop (exit 0, no output).
 *
 * Output contract (Claude Code Stop decision control):
 *   {"decision":"block","reason":"..."} on stdout, exit 0.
 * Docs: https://docs.claude.com/en/docs/claude-code/hooks (Stop decision control section).
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const FEATURE_ORDER = ['40-design.md', '50-test-matrix.md', '60-review.json', '70-docs.json'];
const BLOCKING_ISSUE_SOURCE_FILES = ['00-run.json', '60-review.json', '70-docs.json'];

function readStdinJson() {
  try {
    const raw = fs.readFileSync(0, 'utf8');
    if (!raw || !raw.trim()) return {};
    return JSON.parse(raw);
  } catch (_e) {
    return {};
  }
}

function getBranch(cwd) {
  try {
    const out = execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
      cwd,
      timeout: 2000,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const branch = out.trim();
    return branch || null;
  } catch (_e) {
    return null;
  }
}

function slugify(branch) {
  return branch.replace(/[^A-Za-z0-9._-]/g, '-');
}

function readGuardState(dir) {
  const counterFile = path.join(dir, '.stop-guard-count');
  try {
    if (!fs.existsSync(counterFile)) return { fingerprint: '', count: 0 };
    const parsed = JSON.parse(fs.readFileSync(counterFile, 'utf8'));
    if (parsed && typeof parsed.count === 'number' && typeof parsed.fingerprint === 'string') {
      return parsed;
    }
    return { fingerprint: '', count: 0 };
  } catch (_e) {
    return { fingerprint: '', count: 0 };
  }
}

function writeGuardState(dir, fingerprint, count) {
  const counterFile = path.join(dir, '.stop-guard-count');
  try {
    fs.writeFileSync(counterFile, JSON.stringify({ fingerprint, count }));
  } catch (_e) {
    // best-effort; if we can't persist the counter, do not fail the hook over it
  }
}

// Recursively walk a plain object/array structure, collecting every value found under a
// key literally named `blocking_issues`, at any depth. Returns a flat array (unflattened;
// caller normalizes/dedupes).
function walkForBlockingIssues(node, out) {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    for (const item of node) walkForBlockingIssues(item, out);
    return;
  }
  for (const key of Object.keys(node)) {
    const val = node[key];
    if (key === 'blocking_issues' && Array.isArray(val)) {
      out.push(...val);
    }
    if (val && typeof val === 'object') walkForBlockingIssues(val, out);
  }
}

// Reads whichever of the feature-lane's JSON artifacts exist in `dir` and returns a
// deduped, Number-normalized flat array of issue numbers found under any `blocking_issues`
// key across all of them. Malformed/missing files are simply skipped (fail open per-file).
function collectBlockingIssues(dir) {
  const found = [];
  for (const name of BLOCKING_ISSUE_SOURCE_FILES) {
    try {
      const filePath = path.join(dir, name);
      if (!fs.existsSync(filePath)) continue;
      const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      walkForBlockingIssues(parsed, found);
    } catch (_e) {
      // malformed/unreadable file: skip it, don't let it poison the whole scan
    }
  }
  const normalized = found
    .map((v) => Number(v))
    .filter((n) => Number.isFinite(n));
  return Array.from(new Set(normalized));
}

// Derives an `owner/repo` slug from the origin remote, mirroring getBranch's style.
// Returns null on any failure (no repo, no git, unparseable URL, etc).
function getRepoSlug(cwd) {
  try {
    const out = execFileSync('git', ['remote', 'get-url', 'origin'], {
      cwd,
      timeout: 3000,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const url = out.trim();
    let match = url.match(/github\.com[/:]([^/]+)\/([^/]+?)(?:\.git)?\/?$/);
    if (match) return `${match[1]}/${match[2]}`;
    return null;
  } catch (_e) {
    return null;
  }
}

// Checks whether any issue number named in this run's own blocking_issues fields is still
// OPEN. Returns null if there is nothing to block on (no blocking_issues found, no repo
// slug derivable, gh unavailable/unauthenticated, or every named issue is closed/unverifiable).
// Returns a candidate block descriptor, same shape as checkFeatureLane's, otherwise.
function checkBlockingIssuesStillOpen(cwd, dir) {
  const issueNumbers = collectBlockingIssues(dir);
  if (issueNumbers.length === 0) return null;

  const repoSlug = getRepoSlug(cwd);
  if (!repoSlug) return null; // fail open: can't verify without a repo slug

  const openIssues = [];
  for (const n of issueNumbers) {
    try {
      const out = execFileSync(
        'gh',
        ['issue', 'view', String(n), '--repo', repoSlug, '--json', 'state'],
        { timeout: 5000, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
      );
      const parsed = JSON.parse(out);
      if (parsed && String(parsed.state).toUpperCase() === 'OPEN') {
        openIssues.push(n);
      }
    } catch (_e) {
      // gh unavailable, unauthenticated, issue not found, network error, etc: cannot
      // verify THIS number, so don't count it as a hard block (fail open per-issue).
    }
  }

  if (openIssues.length === 0) return null;

  const sorted = openIssues.slice().sort((a, b) => a - b);
  return {
    lane: 'feature-builder',
    kind: 'blocking-issue',
    dir,
    missing:
      `issue(s) #${sorted.join(', #')} named in this run's own blocking_issues are still ` +
      `open — a disclosed dependency is a deferral, not a completion, until they close`,
    fingerprint: `blocking:${sorted.join(',')}`,
  };
}

// Returns a candidate block descriptor, or null if this lane should not block.
function checkFeatureLane(cwd) {
  try {
    const branch = getBranch(cwd);
    if (!branch) return null;
    const slug = slugify(branch);
    const dir = path.join(cwd, '.gsd', 'phase', slug);
    const runFile = path.join(dir, '00-run.json');
    if (!fs.existsSync(runFile)) return null;
    // Validate the run marker is real JSON; malformed content means we can't trust
    // the armed state, so bail out (fail open) rather than guess.
    JSON.parse(fs.readFileSync(runFile, 'utf8'));

    if (fs.existsSync(path.join(dir, 'HALT.md'))) return null; // escape valve 1
    if (fs.existsSync(path.join(dir, '70-docs.json'))) {
      // Existence check says finished; the content check gets the final say.
      return checkBlockingIssuesStillOpen(cwd, dir);
    }

    let missing = null;
    const present = [];
    for (const name of FEATURE_ORDER) {
      if (fs.existsSync(path.join(dir, name))) {
        present.push(name);
      } else if (missing === null) {
        missing = name;
      }
    }
    if (!missing) return null; // all present including 70-docs.json; shouldn't reach here

    return {
      lane: 'feature-builder',
      kind: 'missing-artifact',
      dir,
      missing,
      fingerprint: present.join(','),
    };
  } catch (_e) {
    return null; // fail open
  }
}

function checkTriageLane(cwd) {
  try {
    const dir = path.join(cwd, '.gsd', 'triage');
    const runFile = path.join(dir, '00-run.json');
    if (!fs.existsSync(runFile)) return null;
    JSON.parse(fs.readFileSync(runFile, 'utf8'));

    if (fs.existsSync(path.join(dir, 'HALT.md'))) return null; // escape valve 1
    if (fs.existsSync(path.join(dir, '90-summary.md'))) return null; // finished

    return {
      lane: 'triage',
      dir,
      missing: '90-summary.md',
      fingerprint: 'unfinished',
    };
  } catch (_e) {
    return null; // fail open
  }
}

const BUG_ORDER = ['10-diagnosis.md', '50-test-matrix.md', '60-review.json', '80-ship.json'];

function checkBugLane(cwd) {
  try {
    const bugRoot = path.join(cwd, '.gsd', 'bug');
    if (!fs.existsSync(bugRoot)) return null;
    if (fs.existsSync(path.join(bugRoot, 'HALT.md'))) return null; // escape valve 1 (sweep-wide)

    // (a) Per-branch: an armed issue that never reached its ship gate.
    const branch = getBranch(cwd);
    if (branch) {
      const dir = path.join(bugRoot, slugify(branch));
      const runFile = path.join(dir, '00-run.json');
      if (fs.existsSync(runFile) && !fs.existsSync(path.join(dir, 'HALT.md'))) {
        JSON.parse(fs.readFileSync(runFile, 'utf8'));
        if (!fs.existsSync(path.join(dir, '80-ship.json'))) {
          let missing = null;
          const present = [];
          for (const name of BUG_ORDER) {
            if (fs.existsSync(path.join(dir, name))) present.push(name);
            else if (missing === null) missing = name;
          }
          if (missing) {
            return { lane: 'bug-fixer', dir, missing, fingerprint: present.join(',') };
          }
        }
      }
    }

    // (b) Sweep-wide: issues still outstanding in the queue. This is the case the
    // per-branch check cannot see — the branch for the LAST issue can be fully
    // shipped while 40 issues remain unstarted.
    const queueFile = path.join(bugRoot, 'queue.json');
    if (!fs.existsSync(queueFile)) return null;
    const queue = JSON.parse(fs.readFileSync(queueFile, 'utf8'));
    const issues = Array.isArray(queue && queue.issues) ? queue.issues : [];
    const outstanding = issues.filter(
      (e) => e && (e.state === 'queued' || e.state === 'in_progress'),
    );
    if (outstanding.length === 0) return null;

    const terminal = issues.length - outstanding.length;
    return {
      lane: 'bug-sweep',
      dir: bugRoot,
      missing: `${outstanding.length} issue(s) still outstanding (next: #${outstanding[0].issue})`,
      // Terminal count is the progress signal: the streak resets as issues land,
      // so a long sweep is never permanently gagged by the repeat limit.
      fingerprint: `terminal:${terminal}`,
    };
  } catch (_e) {
    return null; // fail open
  }
}

// Escape valve 2: don't block if the last assistant turn asked the user a question.
function lastAssistantAskedQuestion(transcriptPath) {
  try {
    if (!transcriptPath) return false;
    const resolved = transcriptPath.replace(/^~/, process.env.HOME || '~');
    const stat = fs.statSync(resolved);
    const size = stat.size;
    const chunkSize = Math.min(size, 65536);
    if (chunkSize <= 0) return false;
    const fd = fs.openSync(resolved, 'r');
    let text;
    try {
      const buf = Buffer.alloc(chunkSize);
      fs.readSync(fd, buf, 0, chunkSize, size - chunkSize);
      text = buf.toString('utf8');
    } finally {
      fs.closeSync(fd);
    }
    const lines = text.split('\n').filter(Boolean);
    for (let i = lines.length - 1; i >= 0; i--) {
      let obj;
      try {
        obj = JSON.parse(lines[i]);
      } catch (_e) {
        continue; // likely a truncated first line of the tail read; skip
      }
      if (obj && obj.type === 'assistant' && obj.message && Array.isArray(obj.message.content)) {
        return obj.message.content.some(
          (block) => block && block.type === 'tool_use' && block.name === 'AskUserQuestion'
        );
      }
    }
    return false;
  } catch (_e) {
    return false; // no transcript available/readable -> don't use this valve
  }
}

function buildReason(candidate) {
  const haltPath = path.join(candidate.dir, 'HALT.md');
  if (candidate.lane === 'bug-fixer') {
    return (
      `GSD bug-fixer issue is armed but unfinished (${candidate.dir}). ` +
      `Missing artifact: ${candidate.missing}. Next required step: produce ${candidate.missing} ` +
      `and carry this issue through to its merge (80-ship.json), then take the next issue off ` +
      `.gsd/bug/queue.json. Reporting progress is not a stopping point. If this is a legitimate ` +
      `stop (blocked on a human decision, a red gate, or a genuine conflict), write ${haltPath} ` +
      `with the reason instead of ending the turn.`
    );
  }
  if (candidate.lane === 'bug-sweep') {
    return (
      `GSD bug sweep is unfinished: ${candidate.missing}. Take the next issue off ` +
      `.gsd/bug/queue.json and continue the loop — the sweep ends when every entry reaches a ` +
      `terminal state (merged / needs-decision / skipped / closed), not when an issue is ` +
      `reported on. If this is a legitimate stop, write ${haltPath} with the reason instead of ` +
      `ending the turn.`
    );
  }
  if (candidate.lane === 'feature-builder' && candidate.kind === 'blocking-issue') {
    return (
      `GSD feature-builder run's own artifacts (${candidate.dir}) name a still-open blocking ` +
      `dependency: ${candidate.missing}. This run cannot be reported as finished -- go fix or ` +
      `track the blocking issue(s) to closure, or if they are genuinely a separate, ` +
      `correctly-scoped piece of follow-up work, remove them from blocking_issues and say why ` +
      `in 70-docs.json. If this is a legitimate stop (blocked on a human decision, a red gate, ` +
      `or a genuine conflict), write ${haltPath} with the reason instead of ending the turn.`
    );
  }
  if (candidate.lane === 'feature-builder') {
    return (
      `GSD feature-builder run is armed but unfinished (${candidate.dir}). ` +
      `Missing artifact: ${candidate.missing}. Next required step: produce ${candidate.missing} ` +
      `and continue the pipeline through to 70-docs.json before ending the turn. ` +
      `If this is a legitimate stop (blocked on a human decision, a red gate, or a genuine ` +
      `conflict), write ${haltPath} with the reason instead of ending the turn.`
    );
  }
  return (
    `GSD triage run is armed but unfinished (${candidate.dir}). ` +
    `Missing artifact: 90-summary.md. Next required step: finish the triage lane and produce ` +
    `90-summary.md before ending the turn. If this is a legitimate stop (blocked on a human ` +
    `decision, a red gate, or a genuine conflict), write ${haltPath} with the reason instead of ` +
    `ending the turn.`
  );
}

function main() {
  const input = readStdinJson();
  const cwd = (input && input.cwd) || process.cwd();

  const candidate = checkFeatureLane(cwd) || checkTriageLane(cwd) || checkBugLane(cwd);
  if (!candidate) {
    process.exit(0); // nothing armed/unfinished -> allow
  }

  if (lastAssistantAskedQuestion(input && input.transcript_path)) {
    process.exit(0); // escape valve 2
  }

  const state = readGuardState(candidate.dir);
  const fingerprintChanged = state.fingerprint !== candidate.fingerprint;
  const count = fingerprintChanged ? 0 : state.count;

  if (count >= 2) {
    process.exit(0); // escape valve 3: past the repeat-block limit -> allow
  }

  writeGuardState(candidate.dir, candidate.fingerprint, count + 1);

  process.stdout.write(JSON.stringify({ decision: 'block', reason: buildReason(candidate) }));
  process.exit(0);
}

try {
  main();
} catch (_e) {
  // Absolute fail-open: any unexpected error must never trap the session.
  process.exit(0);
}
