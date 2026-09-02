#!/usr/bin/env node
'use strict';

/**
 * prune-gsd-passes.cjs — self-pruning for <git-common-dir>/gsd-passes/<sha>.json
 * pass markers.
 *
 * A marker's only job is to survive from verification until the push of that
 * same sha (minutes, sometimes hours). Every rebase mints a new sha and
 * orphans the old marker; nothing else ever deletes it. Left unpruned this
 * accumulates without bound (906 markers were observed after ~37 days).
 *
 * THE RULE — both conditions must hold before a marker is deleted:
 *   1. its sha is NOT live — not the HEAD of any worktree, and not any local
 *      or remote branch tip; AND
 *   2. its mtime is older than 2 days.
 * Both matter and neither alone is sufficient: age alone could delete a
 * long-lived branch's still-valid marker (a branch that has been sitting
 * verified-but-unshipped for a few days is not stale, it is just slow); and
 * liveness alone never expires markers from deleted/merged branches (a
 * branch's tip sha stops being "live" only once the ref is gone, and by then
 * the marker is long past worth keeping) — so liveness alone would leave the
 * accumulation problem exactly as unbounded as it is today. Only the
 * conjunction is safe: never touch anything still reachable as a live ref
 * tip, and even among unreachable ones, give a grace window so an in-flight
 * session's marker (verified moments ago, not yet pushed) cannot be swept
 * out from under it.
 */

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const MARKER_RE = /^[0-9a-f]{40}\.json$/;
const MIN_MARKERS_TO_BOTHER = 100;
const STALE_AGE_MS = 2 * 24 * 60 * 60 * 1000; // 2 days
const GIT_TIMEOUT_MS = 5000;

function gitOutput(repoRoot, args) {
  return execFileSync('git', ['-C', repoRoot, ...args], {
    encoding: 'utf8',
    timeout: GIT_TIMEOUT_MS,
  });
}

/**
 * Returns the set of live shas, or null if the live set could not be
 * determined (git failure, timeout, unexpected error). Callers MUST treat
 * null as UNKNOWN and refuse to delete anything — an empty Set would look
 * indistinguishable from "nothing is live" and would delete every marker,
 * which is exactly the failure mode we must fail closed against.
 */
function getLiveShas(repoRoot) {
  try {
    const live = new Set();

    // Every worktree's HEAD (porcelain: lines start with "HEAD <sha>").
    const wt = gitOutput(repoRoot, ['worktree', 'list', '--porcelain']);
    for (const line of wt.split(/\r?\n/)) {
      if (line.startsWith('HEAD ')) {
        const sha = line.slice('HEAD '.length).trim();
        if (sha) live.add(sha);
      }
    }

    // Every local and remote branch tip.
    const refs = gitOutput(repoRoot, [
      'for-each-ref',
      '--format=%(objectname)',
      'refs/heads',
      'refs/remotes',
    ]);
    for (const line of refs.split(/\r?\n/)) {
      const sha = line.trim();
      if (sha) live.add(sha);
    }

    return live;
  } catch {
    // Timeout, non-zero exit, missing git, malformed output — anything at
    // all. Fail closed: caller must treat this as UNKNOWN, not empty.
    return null;
  }
}

/**
 * Deletes stale, non-live per-sha pass markers from passesDir.
 *
 * NEVER THROWS. Pruning is hygiene; a hygiene error must never fail a
 * verification or block a push. Every failure path swallows its error and
 * returns 0 (nothing deleted).
 *
 * @param {string} passesDir absolute path to the gsd-passes directory
 * @param {string} repoRoot absolute path to a git repo/worktree to resolve
 *   the live ref set from
 * @returns {number} count of markers deleted (0 on any short-circuit or error)
 */
function prunePasses(passesDir, repoRoot) {
  try {
    let entries;
    try {
      entries = fs.readdirSync(passesDir);
    } catch {
      return 0; // directory doesn't exist yet / unreadable — nothing to prune
    }

    const markers = entries.filter((f) => MARKER_RE.test(f));

    // Bound the cost: pruning is only worth its cost once the directory is
    // actually large. Below the threshold, skip entirely — no git calls.
    if (markers.length < MIN_MARKERS_TO_BOTHER) {
      return 0;
    }

    const now = Date.now();
    const staleCandidates = [];
    for (const f of markers) {
      let st;
      try {
        st = fs.statSync(path.join(passesDir, f));
      } catch {
        continue; // vanished between readdir and stat — skip, not our problem
      }
      if (now - st.mtimeMs > STALE_AGE_MS) {
        staleCandidates.push(f);
      }
    }

    if (staleCandidates.length === 0) return 0;

    // Only NOW pay for git — and only ever treat a successful resolution as
    // grounds to delete. On any failure, fail closed: unknown live set means
    // delete nothing.
    const live = getLiveShas(repoRoot);
    if (live === null) return 0;

    let deleted = 0;
    for (const f of staleCandidates) {
      const sha = f.slice(0, 40);
      if (live.has(sha)) continue; // condition 1 fails — still live, keep
      try {
        fs.unlinkSync(path.join(passesDir, f));
        deleted++;
      } catch {
        // best-effort; move on
      }
    }
    return deleted;
  } catch {
    // Absolute last-resort guard — prunePasses must never throw.
    return 0;
  }
}

module.exports = { prunePasses };

if (require.main === module) {
  const [passesDir, repoRoot] = process.argv.slice(2);
  if (!passesDir || !repoRoot) {
    process.stderr.write('usage: prune-gsd-passes.cjs <passesDir> <repoRoot>\n');
    process.exit(0); // never fail the caller over a usage error either
  }
  const n = prunePasses(passesDir, repoRoot);
  process.stdout.write(`${n}\n`);
}
