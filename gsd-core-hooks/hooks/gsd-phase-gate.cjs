#!/usr/bin/env node
'use strict';

/**
 * gsd-phase-gate.cjs — PreToolUse(Edit|Write|Bash) artifact gate.
 *
 * ## Why this exists
 *
 * On 2026-07-26 a full run of the feature-builder directive skipped EIGHT
 * [BLOCKING] steps — /rubber-duck, /grilling, /skills-from-the-artificer,
 * /qa-test-architect, /tdd, /code-review, /writing-documentation-with-diataxis,
 * /ci-preflight — while the hook-enforced gates in the same session
 * (block-local-node-test, pre-pr-gate, gsd-test-clean-tree-guard) were obeyed
 * without exception.
 *
 * The difference was not severity or wording; both were marked ABSOLUTE. It was
 * WHEN the instruction arrives. A hook fires at the instant of the action. A
 * directive fires once, before any work exists, and then hours of
 * tool-result -> decide -> tool-call go by with nothing re-presenting it.
 *
 * The rule that follows, and the one this file implements:
 *
 *     A step that produces no artifact cannot be enforced, and will be skipped.
 *
 * Every step skipped in that session was exactly the set whose output was
 * unobservable. /tdd partially survived because it produces a failing test —
 * a THING the next step needs. /grilling produces only a better state of mind,
 * so doing it and claiming it were indistinguishable.
 *
 * So each blocking step now writes an artifact, and the next action requires it.
 * Compliance stops depending on disposition and becomes a precondition.
 *
 * ## Three directive families, three contracts
 *
 * The families differ because their failure modes differ. feature-builder skips
 * DESIGN steps; bug-fixer stops EARLY (at "PR opened") and abandons its queue;
 * triage-review loses its OUTWARD WRITES (a `confirmed-bug` label with no
 * diagnosis behind it, an `.out-of-scope/` entry that never ships). Each family's
 * artifacts sit where that specific failure becomes visible.
 *
 *   -- /feature-builder -- .gsd/phase/<branch-slug>/
 *   00-run.json         Step 3 — ARMS THIS BRANCH
 *   40-design.md        Step 4  -> required by Edit/Write to src/**
 *   50-test-matrix.md   Step 5  -> required by Edit/Write to tests/**
 *   60-review.json      Step 6  -> required by git push
 *   70-docs.json        Step 7  -> required by gh pr create
 *
 *   -- /bug-fixer -------- .gsd/bug/<branch-slug>/   (+ .gsd/bug/queue.json)
 *   00-run.json         Phase A  — ARMS THIS BRANCH
 *   10-diagnosis.md     Step 1-2 -> required by Edit/Write to src/**
 *   50-test-matrix.md   Step 3   -> required by Edit/Write to tests/**
 *   60-review.json      Step 4   -> required by git push
 *   80-ship.json        Step 6   -> required by gh pr merge
 *   queue.json          Phase A  -> required by `git checkout -b` for the NEXT issue
 *
 *   -- /triage-review ---- .gsd/triage/        (repo-scoped, not branch-scoped)
 *   00-run.json         Step 0   — ARMS THIS RUN
 *   10-worklist.md      Step 0/2 -> required by any gh issue comment/edit/close
 *   20-diagnosis/<N>.md Step 3   -> required to put `confirmed-bug` on issue N
 *   30-decisions.json   Step 4/5 -> required by gh issue close (unless N is diagnosed)
 *   40-oos-queue.json   Step 4/5 -> required by gh pr create
 *   90-summary.md       Step 7   — DISARMS THE RUN
 *
 *   -- PR body purity (all families) --
 *   `gh pr create` / `gh pr edit`, whenever phaseArmed || bugArmed, are additionally
 *   scanned for banned decision-seeking phrases and unchecked acceptance boxes,
 *   independent of the per-family artifact checks above. A PR body states what was
 *   deployed and how it meets the linked issue's requirements — nothing else. See
 *   #1953 (2026-08-09): criterion 5 was marked `[x] met` AND written up under "One
 *   item for your call" in the same body — claiming done and asking for a decision
 *   at once. Fails open on any extraction problem (unreadable body-file, unmatched
 *   quoting, no body found): a false deny here blocks every PR, which gets the hook
 *   disabled.
 *
 * ## Opt-in, not blanket
 *
 * Enforcement applies ONLY where a 00-run.json exists. A directive run creates it;
 * ordinary ad-hoc work never does and is unaffected. A gate that fires on every
 * edit in the repo would be disabled within a day, and a disabled gate enforces
 * nothing.
 *
 * The triage family needs an explicit DISARM that the branch-scoped families do
 * not: `.gsd/triage/` is repo-scoped, so a leftover run marker would gate every
 * `gh issue` call in the repo indefinitely. Writing 90-summary.md ends the run —
 * which also puts the terminal incentive in the right place.
 *
 * ## Merge authority is machine-checked, not asserted
 *
 * `gh pr merge` reads 80-ship.json and enforces CLAUDE.md -> Merge Constraints
 * directly: a red check or a conflicting branch DENIES, and `--admin` is permitted
 * for exactly one reason — a missing secondary reviewer. That is the sanctioned
 * use of admin merge and the only one; it may never bypass CI or a conflict.
 *
 * ## Failure posture
 *
 * Fails OPEN when it cannot determine the repo root — this gates ordinary editing,
 * and bricking all edits on an infrastructure hiccup is worse than the miss. It
 * fails CLOSED on the thing it actually guards: once armed, a missing or malformed
 * artifact always blocks. Human escape: GSD_PHASE_GATE_OVERRIDE=1 (logged).
 */

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

function readStdin() {
  try { return fs.readFileSync(0, 'utf8'); } catch { return ''; }
}

let payload = {};
try { payload = JSON.parse(readStdin() || '{}'); } catch { payload = {}; }

const toolName = String(payload.tool_name || '');
const input = payload.tool_input || {};
const command = String(input.command || '');

// payload.cwd is the SESSION's cwd, not the command's. In a linked-worktree
// setup the session can stay parked on the main checkout while the command
// itself `cd`s into a different worktree/branch before pushing. Resolving
// git state from payload.cwd then reads the WRONG tree's branch/artifacts.
// Live failure: pushing `test/2966-loop-qa-walk` from worktree `ship-2966b`
// was denied citing an artifact for `fix/2639-execute-phase-branch-base`
// because the main checkout happened to be on that branch at the time.
// Fix: mirror pre-pr-gate.sh's shipped_sha() — extract the command's own
// leading `cd <path>` and resolve git state from THAT directory when it
// exists. Do not "simplify" this back to payload.cwd.
const cdMatch = command.match(/(?:^|&&|;|\|)\s*cd\s+([^\s&;|]+)/);
let cwd = String(payload.cwd || process.cwd());
if (cdMatch) {
  const candidate = cdMatch[1].replace(/^['"]|['"]$/g, '');
  try {
    if (fs.statSync(candidate).isDirectory()) cwd = candidate;
  } catch { /* candidate path doesn't exist; keep payload.cwd fallback */ }
}

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

const ESCAPE = 'Human escape (never self-issue): prefix GSD_PHASE_GATE_OVERRIDE=1.';

function git(args) {
  try {
    return execFileSync('git', args, { cwd, encoding: 'utf8', timeout: 5000 }).trim();
  } catch { return ''; }
}

// -- Human escape, logged (same idiom as GSD_HUMAN_OVERRIDE) -----------------
if (/GSD_PHASE_GATE_OVERRIDE=1/.test(command) || process.env.GSD_PHASE_GATE_OVERRIDE === '1') {
  try {
    const root = git(['rev-parse', '--show-toplevel']);
    if (root) {
      fs.mkdirSync(path.join(root, '.gsd'), { recursive: true });
      fs.appendFileSync(
        path.join(root, '.gsd', 'override.log'),
        `${new Date().toISOString()}  PHASE_GATE_OVERRIDE: ${toolName} ${command.slice(0, 200)}\n`,
      );
    }
  } catch { /* logging is best-effort */ }
  allow();
}

const repoRoot = git(['rev-parse', '--show-toplevel']);
// Fails OPEN: this gates ordinary editing, so an infrastructure hiccup must not
// brick every edit in the repo.
if (!repoRoot) allow();

const branch = git(['rev-parse', '--abbrev-ref', 'HEAD']);
// A detached HEAD has no branch-scoped family, but the repo-scoped triage family
// still applies — so this is not an early exit.
const slug = branch && branch !== 'HEAD'
  ? branch.replace(/[^A-Za-z0-9._-]/g, '-')
  : '';

const gsd = (...p) => path.join(repoRoot, '.gsd', ...p);
const exists = (p) => { try { return fs.existsSync(p); } catch { return false; } };

/** Read + parse a JSON artifact. Returns null on missing/unreadable/malformed. */
function readJson(p) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; }
}

// -- Which families are armed? ----------------------------------------------
const phaseDir = slug ? gsd('phase', slug) : '';
const bugDir = slug ? gsd('bug', slug) : '';
const triageDir = gsd('triage');

const phaseArmed = !!phaseDir && exists(path.join(phaseDir, '00-run.json'));
const bugArmed = !!bugDir && exists(path.join(bugDir, '00-run.json'));
// Repo-scoped, so it needs an explicit disarm — see the header.
const triageArmed = exists(path.join(triageDir, '00-run.json'))
  && !exists(path.join(triageDir, '90-summary.md'));

if (!phaseArmed && !bugArmed && !triageArmed) allow();

// Families are evaluated independently and their requirements union. Running two
// directives on one branch is unusual but not incoherent — and a precedence rule
// would silently drop one contract, which is worse than satisfying both.
const hasPhase = (f) => exists(path.join(phaseDir, f));
const hasBug = (f) => exists(path.join(bugDir, f));
const hasTriage = (...f) => exists(path.join(triageDir, ...f));

// -- Edit/Write path gates --------------------------------------------------
/**
 * Which file is this call about to change?
 *
 * Edit/Write carry an explicit path. Bash is matched only for specific commands;
 * this gate deliberately does NOT try to infer edited paths out of arbitrary
 * shell, because a gate that guesses produces false denials, and a gate that
 * produces false denials gets switched off.
 */
/**
 * Repo-relative path, symlink-safe.
 *
 * A prefix comparison (`targetPath.startsWith(repoRoot)`) is not sound: git
 * reports the PHYSICAL toplevel, while the tool payload carries whatever path
 * the caller used. On macOS `/tmp` -> `/private/tmp` and `/var` -> `/private/var`,
 * so the two disagree, the prefix test fails, `rel` stays ABSOLUTE, and `^src/`
 * then matches nothing — the gate fails open silently on precisely what it
 * guards. Resolve both sides, and treat a `..` escape as "outside the repo".
 */
function repoRelative(abs) {
  if (!abs) return '';
  if (!path.isAbsolute(abs)) return abs.split(path.sep).join('/');
  let target = abs;
  try {
    target = fs.realpathSync(abs);
  } catch {
    // Write creates the target, and may create whole directories with it, so
    // neither the file nor its parents need exist. Climb to the nearest ancestor
    // that DOES exist, resolve that, and re-attach the not-yet-created tail —
    // resolving only the immediate dirname would miss `src/new/deep/x.ts` and
    // let a new module land unguarded.
    let dir = path.dirname(abs);
    const tail = [path.basename(abs)];
    while (dir !== path.dirname(dir)) {
      try { target = path.join(fs.realpathSync(dir), ...tail); break; } catch { /* climb */ }
      tail.unshift(path.basename(dir));
      dir = path.dirname(dir);
    }
  }
  let root = repoRoot;
  try { root = fs.realpathSync(repoRoot); } catch { /* keep as reported */ }
  const r = path.relative(root, target).split(path.sep).join('/');
  if (!r || r === '..' || r.startsWith('../')) return '';
  return r;
}

const targetPath = String(input.file_path || '');
const rel = repoRelative(targetPath);

const isEdit = toolName === 'Edit' || toolName === 'Write' || toolName === 'NotebookEdit';

// The gate must never block writing the artifacts it demands, the directive
// itself, or the hooks — that would be unrecoverable.
const EXEMPT = /^(\.gsd\/|\.claude\/)/;

if (isEdit && rel && !EXEMPT.test(rel)) {
  const isSrc = /^src\//.test(rel);
  const isTest = /^tests?\//.test(rel);

  if (phaseArmed && isSrc && !hasPhase('40-design.md')) {
    deny(
      `PHASE GATE — Step 4 (design) has produced no artifact, so this edit to ${rel} is blocked.\n\n` +
      `Missing: .gsd/phase/${slug}/40-design.md\n\n` +
      'Run the directive\'s Step 4 and write its output there:\n' +
      '  /rubber-duck                 — walk the logic, surface edge cases\n' +
      '  /grilling                    — attack the design BEFORE it is code\n' +
      '  /skills-from-the-artificer   — which laws apply (Hyrum, Gall, Conway)\n' +
      '  + the get_impact / preflight_check rating for each symbol you will touch\n\n' +
      'This exists because a design step that produces nothing is indistinguishable ' +
      'from a design step that was skipped — and it was skipped, which is how a ' +
      'success path that ignored an already-captured fault reached review as a blocker.\n' +
      ESCAPE,
    );
  }

  if (bugArmed && isSrc && !hasBug('10-diagnosis.md')) {
    deny(
      `BUG GATE — Step 1-2 (diagnosis) has produced no artifact, so this edit to ${rel} is blocked.\n\n` +
      `Missing: .gsd/bug/${slug}/10-diagnosis.md\n\n` +
      'A fix written before the root cause is written down is a guess with a diff ' +
      'attached. Produce the diagnosis first:\n' +
      '  /diagnose + /root-cause-analysis on the located code\n' +
      '  find_code / find_symbol      — root cause as an exact file:line, not a hunch\n' +
      '  get_timeline / get_evolution — which episode introduced it (or "long-standing")\n' +
      '  get_impact                   — blast radius rating per symbol\n' +
      '  verify_intent                — is the BUG itself a violation of a Held decision?\n\n' +
      'Required sections: Reproduction (command + observed output) · Root cause · ' +
      'Introduced by · Blast radius · Recorded-decision check · Must-Have Acceptance ' +
      'Checklist (verbatim) · Not-the-bug (what legitimately looks like this symptom ' +
      'and must keep working) · Rejected fixes.\n\n' +
      'The last two are the ones that pay: without negative space you ship an ' +
      'over-broad fix, and a fix with no rejected alternative was not chosen — it was ' +
      'the first thing that came to mind.\n' +
      ESCAPE,
    );
  }

  if ((phaseArmed || bugArmed) && isTest) {
    const missingIn = [];
    if (phaseArmed && !hasPhase('50-test-matrix.md')) missingIn.push(`.gsd/phase/${slug}/50-test-matrix.md`);
    if (bugArmed && !hasBug('50-test-matrix.md')) missingIn.push(`.gsd/bug/${slug}/50-test-matrix.md`);
    if (missingIn.length) {
      deny(
        `PHASE GATE — Step 5.1 (QA matrix) has produced no artifact, so this edit to ${rel} is blocked.\n\n` +
        `Missing: ${missingIn.join('\n         ')}\n\n` +
        'Run /qa-test-architect and write the enumerated matrix there: happy / boundary ' +
        '(limit-1, limit, limit+1) / negative / independence, one row per INPUT CLASS.\n\n' +
        (bugArmed
          ? 'For a bug the FIRST row is the failing-first regression test, and its RED ' +
            'verdict sha goes in the "RED proven" column. "The test failed first" is a ' +
            'claim; the sha is evidence.\n\n'
          : '') +
        'Enumerating the input space on paper is what catches the classes that reach CI ' +
        'otherwise — valid-JSON-but-not-an-object, a lone `---` that is a horizontal rule. ' +
        'Writing tests for the code you just wrote finds none of them.\n' +
        ESCAPE,
      );
    }
  }
}

// -- Bash command gates -----------------------------------------------------
if (toolName !== 'Bash') allow();

/** First bare integer appearing after the matched `gh <noun> <verb>` prefix. */
function numberAfter(re) {
  const m = command.match(re);
  if (!m) return null;
  const tail = command.slice(m.index + m[0].length);
  const t = tail.split(/\s+/).find((x) => /^#?\d+$/.test(x));
  return t ? t.replace('#', '') : null;
}

// -- PR body purity (all families) -------------------------------------------
/**
 * A PR body is a statement of completed work: it answers "what was deployed"
 * and "how it meets the linked issue's requirements" — nothing else. A decision
 * the author needs is a HALT surfaced to the maintainer IN CHAT, with the
 * acceptance box left unchecked — never a paragraph in the body. Writing it
 * into the body offloads the decision onto a reader who may never see it, and
 * makes a blocked PR read as finished, which is exactly how it merges anyway.
 *
 * #1953 (2026-08-09): criterion 5 was marked `[x] met` AND written up under
 * "One item for your call" elsewhere in the same body — claiming done and
 * asking for a ruling at once. Stating a known LIMIT is fine (a property of
 * what shipped); asking for a ruling is not.
 *
 * Extraction never throws and never denies on its own failure: an unreadable
 * body-file, unmatched quoting, or no body at all all resolve to `null`, which
 * skips both checks below. A false deny here blocks every PR, which is how a
 * gate gets disabled — so ambiguity always resolves to ALLOW.
 */
function escapeRegex(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

function phraseRegex(phrase) {
  const first = phrase[0];
  const last = phrase[phrase.length - 1];
  const lead = /\w/.test(first) ? '\\b' : '';
  const trail = /\w/.test(last) ? '\\b' : '';
  return new RegExp(lead + escapeRegex(phrase) + trail, 'i');
}

const BANNED_PHRASES = [
  'your call', 'for your review', 'for your judgment', 'for your judgement',
  'for your consideration', 'for your approval', 'for your decision', 'up to you',
  'let me know', 'please confirm', 'please advise', 'please decide', 'please review',
  'open question', 'unresolved', 'needs a decision', 'needs your decision',
  'needs your input', 'needs a call', 'needs sign-off', 'needs signoff',
  'awaiting your', 'pending decision', 'pending your', 'to be decided',
  'to be determined', 'TBD', 'do not merge', "don't merge", 'dont merge',
  'blocks merge', 'blocking merge', 'thoughts?', 'wdyt', 'what do you think',
  "I'd rather", 'I would rather', "I'd prefer", 'I would prefer',
  "if you'd prefer", 'if you would prefer', "if you'd rather",
  'say so and I will', "say so and I'll", 'should we', 'your judgment', 'your judgement',
];

/** Returns {phrase,line,text} for the first banned phrase found, or null. */
function findBannedPhrase(body) {
  const lines = body.split(/\r?\n/);
  for (const phrase of BANNED_PHRASES) {
    const re = phraseRegex(phrase);
    for (let i = 0; i < lines.length; i++) {
      if (re.test(lines[i])) {
        return { phrase, line: i + 1, text: lines[i].trim().slice(0, 200) };
      }
    }
  }
  return null;
}

/**
 * An unchecked `- [ ]` under a Spec-compliance/Acceptance heading, scanned from
 * that heading to the NEXT heading line of any level — a nested subsection
 * (e.g. `### Platforms tested` under `## Spec compliance`) still ends the span,
 * because it introduces its own distinct checklist (platform/runtime matrices,
 * opt-out checklists) that is legitimate to leave partially unchecked. Only the
 * content directly under the acceptance heading, before any further heading, is
 * in scope.
 */
function findUncheckedAcceptanceBox(body) {
  const lines = body.split(/\r?\n/);
  const targetRe = /^#+\s*.*\b(spec compliance|acceptance)\b/i;
  for (let i = 0; i < lines.length; i++) {
    if (!targetRe.test(lines[i])) continue;
    for (let j = i + 1; j < lines.length; j++) {
      if (/^#+\s/.test(lines[j])) break;
      if (/^\s*[-*+]\s*\[\s*\]/.test(lines[j])) {
        return lines[j].trim().slice(0, 200);
      }
    }
  }
  return null;
}

/**
 * Extracts the PR body text out of a `gh pr create` / `gh pr edit` command
 * string, handling `--body-file <path>` / `-F <path>` and inline
 * `--body "<text>"` / `-b "<text>"` (single or double quoted). Returns null
 * when no body is present or cannot be confidently read — callers must treat
 * null as ALLOW, never as DENY.
 */
function extractPrBody(cmd, root, cwdDir) {
  const fileMatch = cmd.match(/(?:--body-file|(?:^|\s)-F)\s+(?:"([^"]+)"|'([^']+)'|(\S+))/);
  if (fileMatch) {
    const p = fileMatch[1] || fileMatch[2] || fileMatch[3];
    if (!p) return null;
    const bases = path.isAbsolute(p) ? [''] : [root, cwdDir];
    for (const base of bases) {
      const abs = path.isAbsolute(p) ? p : path.join(base, p);
      try { return fs.readFileSync(abs, 'utf8'); } catch { /* try next base */ }
    }
    return null; // unreadable under any candidate base: fail open
  }

  const inlineMatch = cmd.match(/--body\s+(?:"([^"]*)"|'([^']*)')/)
    || cmd.match(/(?:^|\s)-b\s+(?:"([^"]*)"|'([^']*)')/);
  if (inlineMatch) return inlineMatch[1] !== undefined ? inlineMatch[1] : inlineMatch[2];

  return null;
}

if ((phaseArmed || bugArmed) && /\bgh\s+pr\s+(create|edit)\b/.test(command)) {
  try {
    const body = extractPrBody(command, repoRoot, cwd);
    if (body) {
      const banned = findBannedPhrase(body);
      if (banned) {
        deny(
          'PHASE GATE — PR body purity: a decision-seeking phrase was found, so this PR write is blocked.\n\n' +
          `Found: "${banned.phrase}" on line ${banned.line}: ${banned.text}\n\n` +
          'A PR body is a statement of completed work: it answers "what was deployed" and ' +
          '"how it meets the linked issue\'s requirements" — nothing else. A decision you need ' +
          'is a HALT surfaced to the maintainer IN CHAT, with the acceptance checkbox left ' +
          'unchecked — never a paragraph in the body. Writing it into the body offloads the ' +
          'decision onto a reader who may never see it, and makes a blocked PR read as ' +
          'finished, which is exactly how it merges anyway.\n\n' +
          '#1953 (2026-08-09): criterion 5 was marked `[x] met` AND written up under "One item ' +
          'for your call" elsewhere in the same body — claiming done and asking for a decision ' +
          'at once. Stating a known LIMIT is fine (a property of what shipped); asking for a ' +
          'ruling is not.\n' +
          ESCAPE,
        );
      }

      const unchecked = findUncheckedAcceptanceBox(body);
      if (unchecked) {
        deny(
          'PHASE GATE — PR body purity: an unchecked acceptance box was found, so this PR write is blocked.\n\n' +
          `Found: "${unchecked}" under a Spec-compliance/Acceptance heading\n\n` +
          'A PR body is a statement of completed work, not a place to leave an open item for ' +
          'someone else to close out. An unmet criterion is a HALT surfaced to the maintainer ' +
          'IN CHAT — not an unchecked box shipped in the body while the PR moves forward anyway.\n\n' +
          '#1953 (2026-08-09) marked criterion 5 `[x] met` while simultaneously asking "for your ' +
          'call" elsewhere in the same body; an honestly unchecked box here is the inverse case ' +
          'and is equally not shippable as a PR — resolve it, or stop and ask before opening or ' +
          'editing the PR.\n' +
          ESCAPE,
        );
      }
    }
  } catch { /* extraction failure: fail open, never brick PR creation */ }
}

// -- git push requires the review artifact ----------------------------------
if (/(^|[\s;|&])git(\s+-[^\s]+)*\s+push(\s|$)/.test(command)) {
  const missingIn = [];
  if (phaseArmed && !hasPhase('60-review.json')) missingIn.push(`.gsd/phase/${slug}/60-review.json`);
  if (bugArmed && !hasBug('60-review.json')) missingIn.push(`.gsd/bug/${slug}/60-review.json`);
  if (missingIn.length) {
    deny(
      'PHASE GATE — Step 6 (orthogonal review) has produced no artifact, so this push is blocked.\n\n' +
      `Missing: ${missingIn.join('\n         ')}\n\n` +
      'Run BOTH engines and record their findings + dispositions there:\n' +
      '  /code-review       — correctness, logic, edge cases (the skill, not an ad-hoc agent)\n' +
      '  /security-review   — injection, secrets, traversal, unsafe argv\n' +
      '  at least one in an isolated reviewer context that did not author the change\n\n' +
      'Shape: {"engines":[{"name":"code-review","isolated":false,"findings":[{"severity":"","summary":"","disposition":""}]}]}\n\n' +
      'This replaces GSD_PR_GATES_OK self-attestation with something checkable: that token ' +
      'asserted the reviews happened, which is exactly the claim that cannot be verified.\n' +
      ESCAPE,
    );
  }
}

// -- feature-builder: docs coverage requires diátaxis decisions made explicit --
// CI's required-docs set is docs/COMMANDS.md + docs/FEATURES.md — Reference and
// Explanation — and lint-docs-required.cjs only checks that SOME file under docs/
// moved. A feature can ship with the entire task-oriented quadrant empty and every
// gate green: that is exactly what happened on issue #1953, which reached review
// with no page answering "how do I use this", past three review engines and a
// full test matrix.
if (phaseArmed && /\bgh\s+pr\s+create\b/.test(command)) {
  const docsPath = path.join(phaseDir, '70-docs.json');
  const SHAPE = 'Shape: {"quadrants":{"reference":["docs/COMMANDS.md"],"explanation":["docs/FEATURES.md"],' +
    '"howTo":"docs/how-to/verb-noun.md","tutorial":null},"enablementSequence":["gsd config-set x.enabled true",' +
    '"gsd-tools x run"],"tutorialSkipReason":"adds a command to an existing loop, not a new entry point"}';
  const WHY = 'CI\'s required-docs set is docs/COMMANDS.md + docs/FEATURES.md — Reference and Explanation — and ' +
    'lint-docs-required.cjs only checks that SOME file under docs/ moved. A feature can ship with the entire ' +
    'task-oriented quadrant empty and every gate green — that is exactly what happened on issue #1953, which ' +
    'reached review with no page answering "how do I use this", past three review engines and a full test matrix.';

  if (!exists(docsPath)) {
    deny(
      'PHASE GATE — Step 7 (docs) has produced no artifact, so this PR cannot be opened.\n\n' +
      `Missing: .gsd/phase/${slug}/70-docs.json\n\n` +
      `${SHAPE}\n\n${WHY}\n` + ESCAPE,
    );
  }

  const docs = readJson(docsPath);
  if (!docs || typeof docs !== 'object' || Array.isArray(docs)) {
    deny(
      'PHASE GATE — 70-docs.json does not parse as a JSON object, so this PR cannot be opened.\n\n' +
      `File: .gsd/phase/${slug}/70-docs.json\n\n${SHAPE}\n\n${WHY}\n` + ESCAPE,
    );
  }

  const quadrants = (docs.quadrants && typeof docs.quadrants === 'object' && !Array.isArray(docs.quadrants))
    ? docs.quadrants : {};
  const seq = docs.enablementSequence;

  if (!Array.isArray(seq)) {
    deny(
      'PHASE GATE — 70-docs.json is missing "enablementSequence" (or it is not an array), so this PR cannot ' +
      'be opened.\n\n' +
      `File: .gsd/phase/${slug}/70-docs.json\n\n` +
      'enablementSequence is the how-to test made machine-checkable: the shortest sequence of commands a ' +
      'user runs to go from the feature being off to getting value from it.\n\n' +
      `${SHAPE}\n\n${WHY}\n` + ESCAPE,
    );
  }

  const howTo = quadrants.howTo;
  const howToIsString = typeof howTo === 'string' && howTo.trim() !== '';

  if (seq.length > 1 && !howToIsString) {
    deny(
      `PHASE GATE — enablementSequence has ${seq.length} steps but quadrants.howTo is empty, so this PR ` +
      'cannot be opened.\n\n' +
      `File: .gsd/phase/${slug}/70-docs.json\n\n` +
      'More than one step means a reference table structurally cannot carry it — a how-to is owed. This is ' +
      'the core rule this artifact exists to enforce.\n\n' +
      `${SHAPE}\n\n${WHY}\n` + ESCAPE,
    );
  }

  if (howToIsString) {
    const howToAbs = path.join(repoRoot, howTo);
    if (!exists(howToAbs)) {
      deny(
        'PHASE GATE — quadrants.howTo points at a path that does not exist, so this PR cannot be opened.\n\n' +
        `File: .gsd/phase/${slug}/70-docs.json\n` +
        `howTo: ${JSON.stringify(howTo)} — not found under ${repoRoot}\n\n` +
        'A how-to that was decided but never written is the same failure this artifact exists to catch, one ' +
        'layer down.\n\n' +
        `${SHAPE}\n\n${WHY}\n` + ESCAPE,
      );
    }

    const readmePath = path.join(repoRoot, 'docs', 'README.md');
    if (exists(readmePath)) {
      let readme = '';
      try { readme = fs.readFileSync(readmePath, 'utf8'); } catch { readme = ''; }
      const base = path.basename(howTo);
      if (readme && !readme.includes(base)) {
        deny(
          'PHASE GATE — quadrants.howTo is not indexed in docs/README.md, so this PR cannot be opened.\n\n' +
          `File: .gsd/phase/${slug}/70-docs.json\n` +
          `howTo: ${JSON.stringify(howTo)} — "${base}" does not appear anywhere in docs/README.md\n\n` +
          'An unindexed how-to is one nobody finds.\n\n' +
          `${SHAPE}\n\n${WHY}\n` + ESCAPE,
        );
      }
    }
  } else if (seq.length <= 1) {
    const skipReason = docs.howToSkipReason;
    if (typeof skipReason !== 'string' || skipReason.trim() === '') {
      deny(
        'PHASE GATE — quadrants.howTo is empty and howToSkipReason is missing, so this PR cannot be opened.\n\n' +
        `File: .gsd/phase/${slug}/70-docs.json\n\n` +
        'A single-step enablement sequence can legitimately skip the how-to, but the decision has to be ' +
        'recorded, not silent.\n\n' +
        `${SHAPE}\n\n${WHY}\n` + ESCAPE,
      );
    }
  }

  const tutorial = quadrants.tutorial;
  const tutorialPresent = tutorial !== null && tutorial !== undefined;
  if (!tutorialPresent) {
    const tSkip = docs.tutorialSkipReason;
    if (typeof tSkip !== 'string' || tSkip.trim() === '') {
      deny(
        'PHASE GATE — quadrants.tutorial is empty and tutorialSkipReason is missing, so this PR cannot be ' +
        'opened.\n\n' +
        `File: .gsd/phase/${slug}/70-docs.json\n\n` +
        'Most features are correctly not tutorial-shaped — the point is that the decision is recorded, not ' +
        'that a tutorial is written.\n\n' +
        `${SHAPE}\n\n${WHY}\n` + ESCAPE,
      );
    }
  }
}

// -- bug-fixer: the next issue cannot start until this one is recorded -------
// Catches queue abandonment — the sweep's documented failure mode. Fires only
// when LEAVING an armed bug branch, so the first checkout and ordinary work are
// untouched.
if (bugArmed && /(^|[\s;|&])git(\s+-[^\s]+)*\s+checkout\s+(-b|-B)(\s|$)/.test(command)) {
  const run = readJson(path.join(bugDir, '00-run.json')) || {};
  const current = run.issue;
  const queue = readJson(gsd('bug', 'queue.json'));
  const TERMINAL = new Set(['merged', 'parked', 'skipped', 'closed']);

  if (!queue || !Array.isArray(queue.issues)) {
    deny(
      'BUG GATE — starting the next issue is blocked: the work queue has no readable record.\n\n' +
      'Missing or malformed: .gsd/bug/queue.json\n\n' +
      'Shape: {"issues":[{"issue":123,"branch":"fix/123-slug","state":"merged|parked|skipped|closed",' +
      '"reason":"<required when parked>","pr":456}]}\n\n' +
      'The Parked Log is the one deliverable of an unattended sweep that nobody is awake ' +
      'to read. As a promise in a final report it is unfalsifiable; as a file it is the ' +
      'thing the next branch depends on.\n' +
      ESCAPE,
    );
  }

  const entry = queue.issues.find((e) => e && Number(e.issue) === Number(current));
  if (!entry || !TERMINAL.has(String(entry.state))) {
    deny(
      `BUG GATE — issue #${current} has no terminal state in the queue, so the next issue cannot start.\n\n` +
      'File: .gsd/bug/queue.json\n' +
      `Found: ${entry ? JSON.stringify(entry) : '(no entry for this issue)'}\n\n` +
      `Record one of: ${[...TERMINAL].join(' | ')} — and when parked, the reason.\n\n` +
      'Parking is a legitimate outcome and never halts the sweep. Silently moving on is ' +
      'the thing this blocks: an issue left with no recorded state is indistinguishable ' +
      'from one that was quietly abandoned.\n' +
      ESCAPE,
    );
  }
}

// -- bug-fixer: merge authority, machine-checked -----------------------------
if (bugArmed && /\bgh\s+pr\s+merge\b/.test(command)) {
  const ship = readJson(path.join(bugDir, '80-ship.json'));

  if (!ship) {
    deny(
      'BUG GATE — Step 6 (CI watch) has produced no artifact, so this merge is blocked.\n\n' +
      `Missing or malformed: .gsd/bug/${slug}/80-ship.json\n\n` +
      'Shape:\n' +
      '  {"pr":123,"checks":{"green":true,"failing":[]},"mergeable":"MERGEABLE",\n' +
      '   "verdict_sha":"<40-hex>","merge":{"method":"squash","admin":false,"admin_reason":null}}\n\n' +
      'This command ends at MERGE, not at "PR opened" — so the merge is where the evidence ' +
      'is demanded. Record the CI state you actually observed via `gh pr checks`, not the ' +
      'state you expect.\n' +
      ESCAPE,
    );
  }

  const failing = Array.isArray(ship.checks && ship.checks.failing) ? ship.checks.failing : [];
  if (!(ship.checks && ship.checks.green === true) || failing.length) {
    deny(
      'BUG GATE — merge blocked: 80-ship.json does not record a green CI.\n\n' +
      `checks.green: ${JSON.stringify(ship.checks && ship.checks.green)}   failing: ${JSON.stringify(failing)}\n\n` +
      'A red check is a defect — yours, regardless of which file it points at. Diagnose the ' +
      'mechanism, fix the root cause, re-run gsd-test on the new sha, push, and re-watch. A ' +
      'failure that does not reproduce is not a flake; it is a defect concealing itself.\n\n' +
      'Admin merge CANNOT bypass this (CLAUDE.md -> Merge Constraints). If the check stays ' +
      'red after genuine remediation, park the issue with the evidence and take the next one.\n' +
      ESCAPE,
    );
  }

  if (String(ship.mergeable).toUpperCase() === 'CONFLICTING') {
    deny(
      'BUG GATE — merge blocked: 80-ship.json records the branch as CONFLICTING.\n\n' +
      'Resolve the conflict by rebasing onto the base and re-verifying (a rebase changes the ' +
      'sha and invalidates the prior gsd-test pass — re-run it). A genuinely unresolvable ' +
      'conflict parks the issue.\n\n' +
      'Admin merge CANNOT bypass a merge conflict — that and a red check are the two cases ' +
      'where it is forbidden outright.\n' +
      ESCAPE,
    );
  }

  // A finding that exists only as prose in a PR body does not survive the merge:
  // the body becomes archive, nobody queries it, and the analysis evaporates. So
  // "I found something I could not fix" gets exactly one representable form here,
  // and that form carries a real issue number.
  const notFixed = Array.isArray(ship.findings_not_fixed) ? ship.findings_not_fixed : [];
  const unfiled = notFixed.filter((f) => !f || !Number.isInteger(f.issue) || f.issue <= 0);
  if (unfiled.length) {
    deny(
      'BUG GATE — merge blocked: a surfaced finding has no tracked issue.\n\n' +
      unfiled.map((f) => `  • ${(f && f.summary) || '(no summary)'}  → issue: ${JSON.stringify(f && f.issue)}`).join('\n') +
      '\n\nEvery entry in `findings_not_fixed` needs a real issue NUMBER. A description in the PR ' +
      'body is not a disposition — once this merges the PR is archive, nobody queries it, and the ' +
      'finding is gone. "Happy to open a follow-up issue on request" is the exact failure this blocks.\n\n' +
      'Two ways forward, and only two:\n' +
      '  1. Fix it inline — the default, and it overrides one-concern-per-PR.\n' +
      '  2. File it, THEN merge:\n' +
      '       GSD_ISSUE_TRIAGE_OK=1 gh issue create --title "..." --body-file <file>\n' +
      '     then put the returned number in `issue` here.\n\n' +
      '"Too big to fold in" is a reason to FILE, never a reason to merely mention: if it is large ' +
      'enough to justify its own PR, it is large enough to justify its own issue, and the issue is ' +
      'the cheaper half. The triage marker is legitimate for a SEPARATE, pre-existing, systemic ' +
      'problem — never to launder a defect this change introduced or touched.\n' +
      ESCAPE,
    );
  }

  if (/(^|\s)--admin(\s|$)/.test(command)) {
    const m = ship.merge || {};
    if (m.admin !== true || m.admin_reason !== 'missing-secondary-reviewer') {
      deny(
        'BUG GATE — `--admin` blocked: 80-ship.json does not justify an admin merge.\n\n' +
        `Found: merge.admin=${JSON.stringify(m.admin)} merge.admin_reason=${JSON.stringify(m.admin_reason)}\n\n` +
        'Admin merge has exactly ONE sanctioned use (CLAUDE.md -> Merge Constraints): ' +
        'bypassing the missing-secondary-reviewer / self-review requirement. To use it, ' +
        'record that plainly:\n\n' +
        '  "merge": { "method": "squash", "admin": true,\n' +
        '             "admin_reason": "missing-secondary-reviewer" }\n\n' +
        '"missing-secondary-reviewer" is the only accepted value. It may never stand in for a ' +
        'red check or a merge conflict — those are already denied above, and writing this ' +
        'reason to get past them is falsification, not a workaround.\n' +
        ESCAPE,
      );
    }
  }
}

// -- triage-review: outward tracker writes ----------------------------------
if (triageArmed) {
  const isIssueWrite = /\bgh\s+issue\s+(comment|edit|close|reopen)\b/.test(command);
  const isApiIssueWrite = /\bgh\s+api\b/.test(command) && /\/issues\/\d+/.test(command);

  if ((isIssueWrite || isApiIssueWrite) && !hasTriage('10-worklist.md')) {
    deny(
      'TRIAGE GATE — Step 0/2 (working set) has produced no artifact, so this tracker write is blocked.\n\n' +
      'Missing: .gsd/triage/10-worklist.md\n\n' +
      'Print and persist the working set BEFORE disposing of anything: one row per issue ' +
      'with # · title · current labels · age · classification (Defect / Enhancement / ' +
      'Feature / needs-your-classification).\n\n' +
      'A sweep that starts writing before it has enumerated what it is sweeping cannot ' +
      'report at the end which issues it never reached.\n' +
      ESCAPE,
    );
  }

  // `confirmed-bug` is the fix gate — it is what tells an AFK agent to start
  // writing code. It requires a written diagnosis for THAT issue.
  if (/confirmed-bug/.test(command) && (isIssueWrite || isApiIssueWrite)) {
    const n = numberAfter(/\bgh\s+issue\s+(?:comment|edit|close|reopen)\b/)
      || (command.match(/\/issues\/(\d+)/) || [])[1];
    if (!n) {
      deny(
        'TRIAGE GATE — cannot identify which issue this `confirmed-bug` write targets.\n\n' +
        'Pass the issue number positionally (`gh issue edit 1234 --add-label confirmed-bug`) ' +
        'so the gate can require the matching diagnosis artifact.\n' +
        ESCAPE,
      );
    }
    if (!hasTriage('20-diagnosis', `${n}.md`)) {
      deny(
        `TRIAGE GATE — \`confirmed-bug\` on #${n} is blocked: no diagnosis artifact exists for it.\n\n` +
        `Missing: .gsd/triage/20-diagnosis/${n}.md\n\n` +
        'This label means "reproduced, root-caused, ready for an agent to write the fix". It ' +
        'is the highest-consequence write this command performs — an AFK agent acts on it ' +
        'without re-verifying.\n\n' +
        'Required sections: Reproduced (evidence, or this label is wrong) · Root cause (exact ' +
        'file:line) · **Memtrace calls made** (tool + result, one line each) · Introduced by · ' +
        'Blast radius · Coupled symbols · Regression test to write first · Negative space ' +
        '(what the fix must NOT change).\n\n' +
        'The Memtrace section is the point: a grep-only guess shows up as an empty section ' +
        'instead of a confident label.\n' +
        ESCAPE,
      );
    }
  }

  // Closing an issue is terminal and outward. It needs either a recorded
  // maintainer verdict (enhancement/feature lanes) or a diagnosis (defect lane
  // "not a bug / already-fixed").
  if (/\bgh\s+issue\s+close\b/.test(command)) {
    const n = numberAfter(/\bgh\s+issue\s+close\b/);
    const diagnosed = n && hasTriage('20-diagnosis', `${n}.md`);
    if (!diagnosed && !hasTriage('30-decisions.json')) {
      deny(
        `TRIAGE GATE — closing #${n || '?'} is blocked: no recorded basis for the disposition.\n\n` +
        'Needs ONE of:\n' +
        `  .gsd/triage/20-diagnosis/${n || '<N>'}.md   — defect lane (not-a-bug / already-fixed)\n` +
        '  .gsd/triage/30-decisions.json           — enhancement / feature lane\n\n' +
        'Shape: {"decisions":[{"issue":123,"lane":"enhancement|feature","verdict":"approve|deny|go|' +
        'go-with-conditions|no-go","source":"AskUserQuestion","rationale":"...",' +
        '"out_of_scope_entry":"<slug>.md|null"}]}\n\n' +
        'The enhancement lane exists to give the maintainer a decision, not to make it for ' +
        'them. `source` records that the verdict came from the maintainer — closing an ' +
        'enhancement `not planned` on your own judgement is the failure this blocks.\n' +
        ESCAPE,
      );
    }
  }

  // The `.out-of-scope/` PR is the KB half of a Deny/No-go, and the half that
  // historically vanishes.
  if (/\bgh\s+pr\s+create\b/.test(command) && !hasTriage('40-oos-queue.json')) {
    deny(
      'TRIAGE GATE — opening a PR is blocked: the out-of-scope queue was never recorded.\n\n' +
      'Missing: .gsd/triage/40-oos-queue.json\n\n' +
      'Shape: {"entries":[{"issue":123,"slug":"thing.md","written":true}]}  (an empty entries[] is valid)\n\n' +
      'A denied ask whose reasoning exists ONLY in a closed-issue comment is invisible to the ' +
      'next run\'s prior-denial check — so the same request returns and gets re-litigated from ' +
      'scratch. Losing the entry defeats the KB.\n\n' +
      'If nothing was queued this run, record `{"entries":[]}` and proceed.\n' +
      ESCAPE,
    );
  }
}

allow();
