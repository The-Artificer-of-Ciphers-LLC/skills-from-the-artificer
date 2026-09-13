#!/usr/bin/env node
'use strict';

/**
 * gsd-verify-and-record.cjs — run the REAL gsd-test for a given --head sha and,
 * on outcome:"passed", record a per-sha pass marker the push/PR gate honors.
 *
 * LOCAL HARNESS TOOLING. This lives beside pre-pr-gate.sh / record-gsd-verdict.sh
 * in the untracked .claude/hooks/ dir — it partners with the local push/PR gate
 * and is intentionally NOT part of the shipped repo (it would be orphaned there,
 * since the gate it feeds is local).
 *
 * ## Why this exists
 *
 * The push/PR gate (.claude/hooks/pre-pr-gate.sh) requires a genuine passing
 * gsd-test verdict for the sha being shipped. The PostToolUse recorder
 * (record-gsd-verdict.sh) can only capture that verdict from a FOREGROUND
 * main-session Bash call — a sub-agent's or long run is auto-backgrounded by the
 * harness, so its verdict never reaches the recorder. That forced every ship to
 * tie up the primary session on a ~7-min foreground run.
 *
 * This wrapper removes that limitation WITHOUT weakening the gate: it spawns
 * gsd-test as its OWN child process (`spawnSync`) and reads that child's full
 * stdout directly, so it captures the verdict regardless of how the harness
 * treats the wrapper's own Bash call (foreground or auto-backgrounded — the node
 * process still runs to completion and records). A cheap agent (or any context)
 * can therefore establish the gate record. It records ONLY a real `passed`
 * verdict for the exact `--head` sha — a false green is impossible.
 *
 * ## CLI interface — wrapper-owned flags vs passthrough
 *
 * gsd-test's own flag surface (--config, --targets, --node, --bench, --exclude,
 * --probe-benches, --keep, --json-events, --verbose, --quiet, --base, --head,
 * --source, --scratch, ...) is NOT reimplemented or allowlisted here — it would
 * go stale the moment gsd-test grows a flag. Instead this wrapper owns exactly
 * two tokens and forwards everything else verbatim, in the order given:
 *
 *   --head <40-hex-sha>  — REQUIRED. Consumed (parsed, validated) AND forwarded
 *                          to gsd-test. May appear at most once — a second
 *                          occurrence is ambiguous about which sha the pass
 *                          marker would be written for, so it is a hard error
 *                          (exit 2) rather than "last one wins".
 *   --dry-run             — consumed by the wrapper only; never forwarded (it is
 *                          not a gsd-test flag). Prints the exact `gsd-test …`
 *                          invocation the wrapper would run and exits 0 without
 *                          spawning anything, so the short-circuits below can be
 *                          exercised for free.
 *
 * `--base` gets one small piece of special handling (not full ownership): this
 * repo's correct base is `next`, but gsd-test's own default is `main`. So if the
 * caller omits --base, the wrapper injects `--base next`; if the caller passes
 * --base explicitly, that value is forwarded as-is and the injected default is
 * skipped — never both. A second --base occurrence is the same ambiguity as a
 * second --head and is also a hard error (exit 2).
 *
 * Every other flag — --quiet, --verbose, --bench, --json-events, --node,
 * --targets, --keep, --config, --source, --scratch, anything this wrapper has
 * never heard of — passes straight through untouched. Notably this wrapper no
 * longer forces `--quiet`: per gsd-test's own docs, Normal verbosity (the
 * default) is already a compact per-OS heartbeat + leg events + loud failures,
 * and `--quiet` suppresses even that heartbeat. Forcing --quiet made this
 * wrapper strictly more silent than gsd-test's own default and hid the phase
 * progress needed to tell a stuck local phase (ref resolve / shallow clone /
 * merge / image pull) from a slow dispatch. Verbosity is now entirely the
 * caller's choice; the default is to pass none. Verdict capture does not depend
 * on verbosity — --json-events emits the full typed event stream, but the
 * verdict line is always the last stdout line and is always `"type":"verdict"`,
 * distinct from the `kind`-keyed --json-events lines, so the scan below finds it
 * regardless of which verbosity/format flags the caller forwarded.
 *
 * --keep is forwarded if the caller passes it (support is not the same as
 * endorsement), but this repo's CLAUDE.md forbids it in normal use — runs must
 * stay ephemeral — so a one-line warning goes to stderr whenever it is seen.
 *
 * ## Record format (shared, per-sha, parallel-safe)
 *
 * Writes `<git-common-dir>/gsd-passes/<sha>.json` = {outcome, sha, recorded_at}.
 * The git COMMON dir is shared across all linked worktrees, and the marker is
 * keyed by sha, so N branches can be verified + shipped in parallel without the
 * single-file race the old .gsd/last-pass.json had. The gate resolves the sha of
 * the ref being shipped and checks for that sha's marker — worktree-independent.
 * Run it from WITHIN the target branch's worktree (so --git-common-dir resolves
 * to the shared store); the wrapper file itself can live anywhere.
 *
 * Usage (from the target worktree):
 *   node <abs-path>/.claude/hooks/gsd-verify-and-record.cjs --head <40-hex-sha> \
 *     [--base <ref>] [--dry-run] [any other gsd-test flag...]
 * Exit 0 + marker written on pass; non-zero and NO marker on any other outcome.
 */

const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { prunePasses } = require('./lib/prune-gsd-passes.cjs');

const rawArgs = process.argv.slice(2);

const headTokenCount = rawArgs.filter((a) => a === '--head').length;
if (headTokenCount > 1) {
  process.stderr.write(
    'gsd-verify-and-record: --head passed more than once — ambiguous which sha the pass marker would be recorded for\n',
  );
  process.exit(2);
}

const baseTokenCount = rawArgs.filter((a) => a === '--base').length;
if (baseTokenCount > 1) {
  process.stderr.write('gsd-verify-and-record: --base passed more than once\n');
  process.exit(2);
}

let head;
let base;
let dryRun = false;
// Everything forwarded to gsd-test verbatim, in order — excludes --head and
// --dry-run (wrapper-owned, handled above/below) and --base (special-cased:
// forwarded as-is when given, defaulted to "next" when absent — see header).
const rest = [];

for (let i = 0; i < rawArgs.length; i++) {
  const a = rawArgs[i];
  if (a === '--head') { head = rawArgs[++i]; continue; }
  if (a === '--dry-run') { dryRun = true; continue; }
  if (a === '--base') { base = rawArgs[++i]; continue; }
  rest.push(a);
}

if (rest.includes('--keep')) {
  process.stderr.write(
    'gsd-verify-and-record: WARNING — --keep forwarded to gsd-test. This repo\'s CLAUDE.md ' +
      'forbids --keep in normal use (runs must stay ephemeral); forwarding it is supported, not endorsed.\n',
  );
}

if (!head || !/^[0-9a-f]{40}$/.test(head)) {
  process.stderr.write('gsd-verify-and-record: --head <40-hex-sha> is required\n');
  process.exit(2);
}

function git(args) {
  return spawnSync('git', args, { encoding: 'utf8' });
}

const commonDir = (git(['rev-parse', '--git-common-dir']).stdout || '').trim();
if (!commonDir) {
  process.stderr.write('gsd-verify-and-record: not inside a git repo\n');
  process.exit(2);
}
const commonAbs = path.resolve(commonDir);

// The sha must be a real commit object in this repo.
if (git(['cat-file', '-e', `${head}^{commit}`]).status !== 0) {
  process.stderr.write(`gsd-verify-and-record: ${head} is not a commit in this repo\n`);
  process.exit(2);
}

const passesDir = path.join(commonAbs, 'gsd-passes');

// Already verified: re-running a suite for a sha that has a real recorded pass
// cannot change the answer — the tree is byte-identical. Exit satisfied.
if (fs.existsSync(path.join(passesDir, `${head}.json`))) {
  process.stderr.write(
    `gsd-verify-and-record: ${head.slice(0, 9)} already has a recorded pass — not re-running. ` +
      `The tree for a given sha is immutable, so the verdict cannot differ.\n`,
  );
  process.exit(0);
}

// Best-effort self-pruning of stale, non-live per-sha markers. Runs from
// process.cwd() (this hook must be invoked from within the target worktree —
// see header), and prunePasses() itself never throws.
try { prunePasses(passesDir, process.cwd()); } catch { /* pruning must never break recording */ }

// ── Doc-only carry-forward ───────────────────────────────────────────────────
// pre-pr-gate.sh already exempts a push whose changed files are all doc-only —
// but NOTHING stopped this recorder from being called anyway, and it would
// dutifully burn a full (OS x Node) matrix run to "re-verify" a one-line
// changeset or a docs edit. That is the exact waste the gate's exemption exists
// to prevent, leaking in through the other door: the gate knew, the runner did
// not. Adding a `.changeset/*.md` fragment to an already-verified branch moved
// the sha, the agent reflexively re-ran the suite, and ~26,800 tests executed to
// prove that a changelog fragment does not change behavior.
//
// So: if an ANCESTOR of --head already has a recorded pass, and every file
// changed between that ancestor and --head is doc-only, carry the pass forward
// instead of running. This is exactly as safe as the gate's own exemption — same
// rule, same regex, and it can only ever propagate a pass that a real gsd-test
// run produced on a commit whose executable content is byte-identical.
//
// The regex is READ FROM pre-pr-gate.sh rather than copied. Two surfaces sharing
// one rule is the "generative fix divergence" defect this repo has hit before;
// a single parsed source cannot drift. If it cannot be read, we FAIL SAFE and
// run the suite.
function docOnlyRegex() {
  for (const p of [
    path.join(__dirname, 'pre-pr-gate.sh'),
  ]) {
    try {
      const m = fs.readFileSync(p, 'utf8').match(/^DOC_ONLY_RE='(.+)'$/m);
      if (m) return new RegExp(m[1]);
    } catch { /* try next */ }
  }
  return null;
}

function carryForwardSha() {
  const re = docOnlyRegex();
  if (!re) return null;
  let markers;
  try {
    markers = fs.readdirSync(passesDir).filter((f) => /^[0-9a-f]{40}\.json$/.test(f));
  } catch {
    return null; // no passes recorded yet
  }
  let best = null;
  let bestDistance = Infinity;
  for (const f of markers) {
    const sha = f.slice(0, 40);
    if (sha === head) return null; // already recorded; nothing to carry
    // Must be a real ancestor — never carry a pass sideways from another branch.
    if (git(['merge-base', '--is-ancestor', sha, head]).status !== 0) continue;
    const n = parseInt((git(['rev-list', '--count', `${sha}..${head}`]).stdout || '').trim(), 10);
    if (Number.isFinite(n) && n < bestDistance) { bestDistance = n; best = sha; }
  }
  if (!best) return null;
  const r = git(['diff', '--name-only', `${best}..${head}`]);
  if (r.status !== 0) return null;
  const files = (r.stdout || '').split(/\r?\n/).filter(Boolean);
  if (files.length === 0) return null;          // nothing changed — let the suite run
  if (!files.every((f) => re.test(f))) return null; // real code moved — must run
  return { sha: best, files };
}

const carry = carryForwardSha();
if (carry) {
  fs.mkdirSync(passesDir, { recursive: true });
  fs.writeFileSync(
    path.join(passesDir, `${head}.json`),
    `${JSON.stringify({
      outcome: 'passed',
      sha: head,
      recorded_at: new Date().toISOString(),
      carried_from: carry.sha,
      carried_reason: 'doc-only delta',
      carried_files: carry.files,
    })}\n`,
  );
  process.stderr.write(
    `gsd-verify-and-record: NOT running gsd-test — every file changed since ${carry.sha.slice(0, 9)} ` +
      `(which has a recorded pass) is doc-only:\n` +
      carry.files.map((f) => `  ${f}\n`).join('') +
      `Carried that pass forward to ${head.slice(0, 9)}. No executable content changed, so a suite run ` +
      `could only reproduce the same verdict at full matrix cost. (pre-pr-gate.sh exempts this push too.)\n`,
  );
  process.exit(0);
}

const gtArgs = base ? ['--base', base, '--head', head, ...rest] : ['--base', 'next', '--head', head, ...rest];

// --dry-run: report the decision and exit WITHOUT spawning gsd-test. Lets the
// short-circuits above be tested (and lets an agent ask "would this cost me a
// matrix run?") without burning bench capacity to find out.
if (dryRun) {
  process.stdout.write(`WOULD RUN: gsd-test ${gtArgs.join(' ')}\n`);
  process.exit(0);
}

process.stderr.write(`gsd-verify-and-record: running gsd-test ${gtArgs.join(' ')} (this takes several minutes)…\n`);

// Spawn gsd-test as OUR child so we read its full stdout regardless of how the
// harness treats this wrapper's own invocation.
const r = spawnSync('gsd-test', gtArgs, { encoding: 'utf8', maxBuffer: 128 * 1024 * 1024 });
const combined = `${r.stdout || ''}\n${r.stderr || ''}`;
const verdictLine = combined
  .split(/\r?\n/)
  .filter((l) => /"type"\s*:\s*"verdict"/.test(l))
  .pop() || '';

// Surface the verdict on our stdout (evidence, and so a curious human/CI can read it).
if (verdictLine) process.stdout.write(`${verdictLine}\n`);

const outcome = (verdictLine.match(/"outcome"\s*:\s*"([a-z_]+)"/) || [])[1];
if (outcome !== 'passed') {
  // Failure forensics: the child's full captured stdout+stderr names the failing
  // phase (local ref-resolve/clone/merge, image pull, per-lane dispatch) — the one
  // piece of evidence this wrapper used to discard exactly when it was needed.
  // Dump it beside the recorded runs so the next step is a file Read, not a theory.
  try {
    const os = require('node:os');
    const dumpDir = path.join(os.homedir(), '.local', 'state', 'gsd-test', 'wrapper-failures');
    fs.mkdirSync(dumpDir, { recursive: true });
    const dump = path.join(dumpDir, `${head.slice(0, 12)}-${Date.now()}.log`);
    fs.writeFileSync(dump, `# gsd-test ${gtArgs.join(' ')}\n# exit ${r.status}\n${combined}`);
    process.stderr.write(`gsd-verify-and-record: full child output dumped to ${dump}\n`);
  } catch { /* diagnostics must never mask the verdict */ }
  process.stderr.write(
    `gsd-verify-and-record: NOT recording — outcome=${outcome || 'unknown'} (gsd-test exit ${r.status}). Fix or surface the failure; do not ship.\n`,
  );
  process.exit(r.status || 1);
}

fs.mkdirSync(passesDir, { recursive: true });
const marker = path.join(passesDir, `${head}.json`);
fs.writeFileSync(
  marker,
  `${JSON.stringify({ outcome: 'passed', sha: head, recorded_at: new Date().toISOString() })}\n`,
);
process.stderr.write(`gsd-verify-and-record: recorded pass for ${head} → ${marker}\n`);
process.exit(0);
