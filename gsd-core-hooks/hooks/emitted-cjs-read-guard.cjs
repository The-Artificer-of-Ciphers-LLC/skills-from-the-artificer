#!/usr/bin/env node
'use strict';

/**
 * emitted-cjs-read-guard.cjs — PreToolUse(Read|Edit|Write|NotebookEdit) gate.
 *
 * ## The rule it enforces
 *
 * `gsd-core/bin/lib/*.cjs` is tsc build output of `src/*.cts` (ADR-457). The
 * maintainer's rule, stated plainly: "we don't read CJS, they are output for
 * the CTS." Reading the emitted copy shows generated code instead of the
 * authored source (misleading — comments, formatting, and even control flow
 * can differ post-transpile), and EDITING it is actively destructive: the
 * change is silently discarded the next time `npm run build:lib` runs, with
 * no error and no trace that the "fix" ever existed.
 *
 * ## Why gitignore is the discriminator, not a hardcoded list
 *
 * Not every `.cjs` under `gsd-core/bin/lib/` is a `.cts` build artifact.
 * `gsd-core/bin/lib/exit-code-registry.cjs` and `scripts/lib/cli-exit.cjs`
 * are TRACKED generated artifacts with no `.cts` source at all — redirecting
 * those to a nonexistent file would produce a denial with no correct
 * alternative, and a gate with no correct alternative gets switched off.
 * The reliable signal is `git check-ignore`: build output produced by
 * `tsc` from `.cts` is gitignored (`gsd-core/bin/lib/io.cjs` at
 * .gitignore:244, `cli-exit.cjs` at .gitignore:140); hand-shipped or
 * otherwise-tracked `.cjs` files are not. This hook trusts that signal over
 * any path pattern.
 *
 * ## Worktree handling
 *
 * This hook may run from within a git worktree under
 * `.claude/worktrees/<name>/...` where the same relative file exists. A
 * plain `git check-ignore` needs to run with `cwd` set to the directory the
 * target file actually lives in (not this hook's own directory), so the
 * check resolves against whichever repo/worktree root is actually in play.
 *
 * ## Failure posture — deliberately OPEN, not closed
 *
 * This is the OPPOSITE posture from this repo's safety gates (e.g.
 * memtrace-first-guard.cjs, which fails closed on principle). This hook is a
 * routing CONVENIENCE, not a safety boundary: missing `git`, a timeout, an
 * unparseable payload, an ignored file with no discoverable `.cts` sibling —
 * all of these ALLOW. Worst case on a failure here is someone reads a
 * generated file, which is merely unhelpful, not unsafe. Do NOT "fix" this
 * into failing closed later; that would turn a convenience into a gate that
 * can block real work on a `git` hiccup.
 */

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

function readStdin() {
  try { return fs.readFileSync(0, 'utf8'); } catch { return ''; }
}

let payload = {};
try { payload = JSON.parse(readStdin() || '{}'); } catch { payload = {}; }

const toolName = String(payload.tool_name || '');
const input = payload.tool_input || {};

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

const HUMAN_ESCAPE_MSG = 'Human escape: GSD_ALLOW_EMITTED_READ=1 must be exported in the shell that ' +
  'launches Claude Code. An inline command prefix does NOT work and is not self-issuable — this hook ' +
  'is a separate process, so process.env is fixed by whoever started the session, not by anything the ' +
  'model can write mid-turn.';

// ── 0. Only tools that can touch a file path ────────────────────────────────
const WATCHED_TOOLS = new Set(['Read', 'Edit', 'Write', 'NotebookEdit']);
if (!WATCHED_TOOLS.has(toolName)) allow();

const rawPath = String(input.file_path || input.notebook_path || '');
if (!rawPath) allow();
if (!rawPath.endsWith('.cjs')) allow();

let absPath;
try {
  absPath = path.resolve(rawPath);
} catch {
  allow();
}

// ── Human escape (logged), matching the repo's GSD_HUMAN_OVERRIDE idiom ─────
if (process.env.GSD_ALLOW_EMITTED_READ === '1') {
  try {
    fs.appendFileSync(
      path.join(__dirname, '..', '..', '.gsd', 'override.log'),
      `${new Date().toISOString()}  EMITTED_CJS_READ_OVERRIDE: ${toolName} ${absPath}\n`,
    );
  } catch { /* logging is best-effort; never block on it */ }
  allow();
}

// ── 1. Is this file actually gitignored? ────────────────────────────────────
// cwd is the directory the target file lives in, not this hook's own
// directory — required so a worktree copy under .claude/worktrees/<name>/
// resolves `git check-ignore` against its own repo/worktree root, not the
// canonical checkout's.
let ignored = false;
try {
  const result = spawnSync('git', ['check-ignore', '-q', absPath], {
    cwd: path.dirname(absPath),
    timeout: 5000,
  });
  // status 0 = ignored, 1 = not ignored, anything else (incl. null on
  // timeout/spawn failure) is unknown — fail open per this hook's posture.
  if (result.error || result.status === null) allow();
  ignored = result.status === 0;
} catch {
  allow();
}

if (!ignored) allow();

// ── 2. Compute the candidate .cts source ────────────────────────────────────
// Primary: replace a `gsd-core/bin/lib/` path segment with `src/`, swapping
// the extension. Nested subdirectories are preserved as-is (e.g.
// gsd-core/bin/lib/installer-migrations/x.cjs -> src/installer-migrations/x.cts).
const LIB_SEGMENT = `${path.sep}gsd-core${path.sep}bin${path.sep}lib${path.sep}`;
let candidate = null;

const libIdx = absPath.indexOf(LIB_SEGMENT);
if (libIdx !== -1) {
  const rel = absPath.slice(libIdx + LIB_SEGMENT.length);
  const repoRoot = absPath.slice(0, libIdx);
  const relCts = rel.slice(0, -'.cjs'.length) + '.cts';
  candidate = path.join(repoRoot, 'src', relCts);
}

// Fallback: a sibling .cts file next to the .cjs itself.
const siblingCts = absPath.slice(0, -'.cjs'.length) + '.cts';

let ctsPath = null;
if (candidate && fs.existsSync(candidate)) {
  ctsPath = candidate;
} else if (fs.existsSync(siblingCts)) {
  ctsPath = siblingCts;
}

// No discoverable .cts source — this is a gitignored .cjs with nowhere to
// redirect to. Allow rather than deny into a dead end.
if (!ctsPath) allow();

deny(
  `EMITTED-CJS: ${absPath} is tsc build output (ADR-457) generated from a .cts source — reading it shows ` +
  'generated code, and any edit here is silently destroyed by the next `npm run build:lib`. ' +
  `Use the authored source instead: ${ctsPath}\n\n` +
  'This repo indexes .cts in Memtrace but NOT gsd-core/bin/lib/*.cjs build output — for discovery, use ' +
  'mcp__memtrace__find_symbol / mcp__memtrace__get_source_window against the .cts path above, not this file.\n\n' +
  HUMAN_ESCAPE_MSG,
);
