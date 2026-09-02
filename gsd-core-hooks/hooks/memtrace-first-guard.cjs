#!/usr/bin/env node
'use strict';

/**
 * memtrace-first-guard.cjs — PreToolUse(Bash|Grep|Glob) gate.
 *
 * Enforces CLAUDE.md's CODE-DISCOVERY ROUTING rule mechanically, because prose
 * did not hold: the rule is at the top of CLAUDE.md, marked ABSOLUTE, and was
 * still walked past mid-session (2026-07-26 — Memtrace used in Steps 0-2, then
 * `grep -n` on src/ for the next phase, costing a wrong design that a single
 * preflight_check overturned).
 *
 * ## The rule it enforces
 *
 * For code discovery in `src/` (symbol location, callers, "where is X"), the
 * FIRST call must be Memtrace. This hook denies a text search of `src/` unless
 * a `mcp__memtrace__*` tool call appears in the transcript AFTER the last
 * genuine user turn.
 *
 * ## Why "since the last user turn" and not a session marker
 *
 * A session-level "has Memtrace ever been called" marker does NOT catch the
 * real failure mode — it is satisfied forever by one call at session start,
 * which is exactly what happened on 2026-07-26. Anchoring to the last user turn
 * means: for each task you are given, consult the graph before grepping source.
 * Calibrated against the real transcript of that session: the offending greps
 * sat at lines 1007/1015, the last user turn at 987, the last Memtrace call at
 * 730 — i.e. this rule denies them, and a session marker would not have.
 *
 * Tool results arrive as user-role messages, so a "user turn" here means a
 * user-role message whose content is a plain string, or a content array with no
 * tool_result block. That distinction is load-bearing.
 *
 * ## Scope — deliberately narrow
 *
 * Only `src/` is gated: that is what Memtrace indexes in this repo (`.cts`
 * sources; `gsd-core/bin/lib/*.cjs` build output is NOT indexed). Gating paths
 * the graph cannot answer for would produce denials with no correct
 * alternative, and a gate with no correct alternative gets switched off.
 *
 * Carve-outs mirror CLAUDE.md's own documented fallback list: prose/config
 * files where the text IS the product, file-inventory counts, and reading a
 * span Memtrace already returned (a `Read` with offset/limit is not a search
 * and is never matched here).
 *
 * ## Failure posture
 *
 * Fails CLOSED, including when the transcript cannot be read — a human escape
 * exists (GSD_MEMTRACE_FIRST_OVERRIDE=1, logged), but ONLY via process.env, not
 * via any text in the pending command. This hook runs as its own process,
 * spawned by whatever launched Claude Code — so process.env reflects that
 * launcher's environment, which the model cannot write to mid-session. An
 * inline `VAR=1 cmd` prefix is just a substring of the not-yet-executed
 * command and is therefore not self-issuable; only a human exporting the var
 * in the shell that starts Claude Code clears the gate.
 */

const fs = require('node:fs');

function readStdin() {
  try { return fs.readFileSync(0, 'utf8'); } catch { return ''; }
}

let payload = {};
try { payload = JSON.parse(readStdin() || '{}'); } catch { payload = {}; }

const toolName = String(payload.tool_name || '');
const input = payload.tool_input || {};
const transcriptPath = String(payload.transcript_path || '');

function allow() { process.exit(0); }

const HUMAN_ESCAPE_MSG = 'Human escape: GSD_MEMTRACE_FIRST_OVERRIDE=1 must be exported in the shell ' +
  'that launches Claude Code. An inline command prefix does NOT work and is not self-issuable.';

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

// ── Human escape (logged), matching the repo's GSD_HUMAN_OVERRIDE idiom ──────
// process.env ONLY — deliberately not the pending command text. This hook is a
// separate process launched alongside Claude Code, so process.env is fixed by
// whoever started that session; a model-authored `VAR=1 cmd` prefix in the
// pending Bash command is never in this process's environment and cannot
// self-issue the override.
const rawCommand = String(input.command || '');
if (process.env.GSD_MEMTRACE_FIRST_OVERRIDE === '1') {
  try {
    fs.appendFileSync(
      '/Users/trekkie/projects/gsd-core/.gsd/override.log',
      `${new Date().toISOString()}  MEMTRACE_FIRST_OVERRIDE: ${toolName} ${rawCommand.slice(0, 200)}\n`,
    );
  } catch { /* logging is best-effort; never block on it */ }
  allow();
}

// ── 1. Is this pending call a code search of src/? ──────────────────────────
// CONTENT searchers only. `find` is deliberately absent: `find src -name '*.cts'`
// is filename enumeration, which CLAUDE.md lists as a documented fallback. A
// find that shells out to a content searcher is caught by the grep/rg alternative
// appearing later in the same command string.
const SEARCH_BIN = /(^|[\s;|&(])(grep|egrep|fgrep|rg|ag|ack)(\s|$)|(^|[\s;|&(])sed\s+-n/;

/**
 * Counting occurrences is a measurement Memtrace has no equivalent for, so it
 * stays out of the gate. `-l` / `--files-with-matches` is NOT here on purpose:
 * "which files reference Y" is the callers question the graph answers properly
 * (analyze_relationships / get_symbol_context), and letting it through the
 * inventory door would reopen the exact hole this gate exists to close.
 * Matches combined short-flag clusters (`-rc`), not just the bare flag.
 */
// The cluster is restricted to real grep short flags rather than `[a-zA-Z]*`,
// which matched any token containing a `c` — `find … -exec grep …` read as
// "counting" and sailed through the gate. Note the absence of lowercase `e`.
const COUNT_ONLY = /(^|\s)-[rRiIwWvhnE]*c[rRiIwWvhnE]*(\s|$)|(^|\s)--count(\s|$)|\|\s*wc\b/;

function mentionsSrc(s) {
  // `src` as a whole path token — WITH OR WITHOUT a trailing slash. Requiring
  // the slash let the most common form of the thing this gate exists to stop
  // (`grep -rn foo src`) through untouched. The trailing character class keeps
  // it a path token so unrelated words are not matched (`scripts` has no `src`
  // substring, but `--source` would without this anchor).
  return /(^|[\s'"=(])src(\/|\s|['"]|$)/.test(s) || /\.cts(\s|['"]|$)/.test(s);
}

let isCodeSearch = false;
let subject = '';

if (toolName === 'Grep' || toolName === 'Glob') {
  subject = `${input.pattern || ''} ${input.path || ''} ${input.glob || ''}`;
  isCodeSearch = mentionsSrc(subject);
} else if (toolName === 'Bash') {
  subject = rawCommand;
  isCodeSearch = SEARCH_BIN.test(subject) && mentionsSrc(subject) && !COUNT_ONLY.test(subject);
}

if (!isCodeSearch) allow();

// ── 2. Has Memtrace been consulted since the last genuine user turn? ────────
if (!transcriptPath) {
  deny(
    'MEMTRACE-FIRST: cannot verify a Memtrace call (no transcript_path in the hook payload), and this gate fails closed. ' +
    'Call mcp__memtrace__find_symbol / find_code / get_symbol_context for this lookup — that is the required path anyway. ' +
    HUMAN_ESCAPE_MSG,
  );
}

let lines = [];
try {
  lines = fs.readFileSync(transcriptPath, 'utf8').split('\n');
} catch {
  deny(
    `MEMTRACE-FIRST: transcript unreadable (${transcriptPath}); this gate fails closed. ` +
    'Use mcp__memtrace__find_symbol / find_code instead — it answers this in one call with exact file:start:end. ' +
    HUMAN_ESCAPE_MSG,
  );
}

let lastUserTurn = -1;
let lastMemtrace = -1;

for (let i = 0; i < lines.length; i++) {
  const line = lines[i];
  if (!line) continue;
  // Cheap prefilter before the JSON parse — transcripts run to thousands of
  // lines. Deliberately matches only `"role"` (no value, no colon spacing) and
  // the bare tool prefix: a prefilter that assumed compact `"role":"user"`
  // silently stopped finding user turns the moment the serializer inserted a
  // space, and this gate then failed OPEN. Never tighten this to include
  // punctuation or spacing that the transcript writer controls.
  if (!line.includes('"role"') && !line.includes('mcp__memtrace__')) continue;

  let d;
  try { d = JSON.parse(line); } catch { continue; }
  const msg = d.message || {};
  const role = msg.role || d.type;
  const content = msg.content;

  if (role === 'user') {
    // A tool RESULT is delivered as a user-role message. Only a genuine user
    // turn resets the requirement, or every tool call would clear the gate.
    const isToolResult = Array.isArray(content)
      && content.some((b) => b && typeof b === 'object' && b.type === 'tool_result');
    if (!isToolResult) lastUserTurn = i;
  }

  if (role === 'assistant' && Array.isArray(content)) {
    for (const b of content) {
      if (b && typeof b === 'object' && b.type === 'tool_use'
          && String(b.name || '').startsWith('mcp__memtrace__')) {
        lastMemtrace = i;
      }
    }
  }
}

// Every real session has at least one genuine user turn. Finding none means the
// transcript did not parse the way this gate assumes — a format drift, not an
// empty session. Verification is therefore impossible, so fail CLOSED rather
// than allow on an assumption we just proved wrong.
if (lastUserTurn === -1) {
  deny(
    'MEMTRACE-FIRST: could not identify any user turn in the transcript, so "has Memtrace been consulted ' +
    'for this task" is unverifiable and this gate fails closed. The transcript format has probably drifted ' +
    `(${transcriptPath}) — that is a bug in the guard worth fixing, not a reason to text-search src/. ` +
    'Use mcp__memtrace__find_symbol / find_code for this lookup. ' +
    HUMAN_ESCAPE_MSG,
  );
}

if (lastMemtrace > lastUserTurn) allow();

deny(
  'MEMTRACE-FIRST (CLAUDE.md → CODE-DISCOVERY ROUTING, ABSOLUTE): this is a text search of src/, and no ' +
  'mcp__memtrace__* call has been made since the last user turn.\n\n' +
  `Blocked: ${subject.slice(0, 160)}\n\n` +
  'Use the graph first — one call returns exact file:start_line:end_line plus what grep structurally cannot:\n' +
  '  • where is this symbol      → mcp__memtrace__find_symbol\n' +
  '  • where does X behavior live → mcp__memtrace__find_code\n' +
  '  • callers / callees / role   → mcp__memtrace__get_symbol_context\n' +
  '  • blast radius before edit   → mcp__memtrace__get_impact  (or preflight_check)\n\n' +
  'Zero results are NOT permission to grep — work the diagnostics ladder (list_indexed_repositories → ' +
  'get_repository_stats → check_job_status) and say which rung failed.\n' +
  'Genuinely outside the graph (prose/config, file counts, re-reading a span Memtrace already returned)? ' +
  'Those are not matched by this gate — narrow the command to the real target.\n' +
  HUMAN_ESCAPE_MSG,
);
