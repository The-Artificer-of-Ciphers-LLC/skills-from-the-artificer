#!/usr/bin/env node
// no-defer-guard.js — PreToolUse DENY guard enforcing the no-defer rule.
//
// Claude reflexively reaches for two tools to DEFER a defect it found instead of
// fixing it inline. This guard makes that physically impossible:
//   1. mcp__ccd_session__spawn_task  — ALWAYS denied (its only purpose is deferral)
//   2. Bash `gh issue create|new`    — denied UNLESS an explicit triage marker is set
//
// Rule (~/.claude/CLAUDE.md "NEVER DEFER A DEFECT"): any defect you discover while
// working — in your diff or anywhere in the tree — you FIX in the current change.
// one-concern-per-PR does NOT apply to defects you surface.
//
// Blocking contract: PreToolUse hook exits 2 -> Claude Code blocks the tool call and
// feeds stderr back to the model.

'use strict';
const fs = require('fs');

let raw = '';
try {
  raw = fs.readFileSync(0, 'utf8');
} catch {
  process.exit(0); // no stdin -> nothing to guard
}
if (!raw.trim()) process.exit(0);

let data;
try {
  data = JSON.parse(raw);
} catch {
  process.exit(0); // unparseable -> fail open (do not wedge unrelated tools)
}

const tool = data.tool_name || '';
const input = data.tool_input || {};

function deny(reason) {
  process.stderr.write(reason + '\n');
  process.exit(2);
}

// (1) spawn_task — no legitimate non-deferral use. Hard deny, no override.
if (tool === 'mcp__ccd_session__spawn_task' || /(^|__)spawn_task$/.test(tool)) {
  deny(
    'BLOCKED — no-defer rule (~/.claude/CLAUDE.md "NEVER DEFER A DEFECT").\n' +
      'Do NOT spawn a background task for something you noticed. If it is a defect, FIX it\n' +
      'inline in the current change. one-concern-per-PR does NOT apply to defects you surface.\n' +
      'There is no override for spawn_task — fix it, or it is not a defect.'
  );
}

// (2) gh issue create|new — dual-use: legitimate maintainer triage vs. deferring a
// self-found defect. Block by default; allow only with a deliberate, self-documenting
// marker the user adds ONLY for genuine user-requested triage of a pre-existing /
// user-reported issue — NEVER for a defect discovered while coding.
if (tool === 'Bash') {
  const cmd = String(input.command || '');
  if (/\bgh\s+issue\s+(create|new)\b/.test(cmd) && !/GSD_ISSUE_TRIAGE_OK=1/.test(cmd)) {
    deny(
      'BLOCKED — no-defer rule (~/.claude/CLAUDE.md "NEVER DEFER A DEFECT").\n' +
        'Do NOT open a GitHub issue for a defect you found — FIX it inline in the current change.\n' +
        'This guard exists because filing/deferring a self-found defect is forbidden.\n' +
        'Only for a DELIBERATE, legitimate issue — user-requested triage of a pre-existing /\n' +
        'user-reported problem, OR a planned epic/roadmap sub-issue — may you re-run the command\n' +
        'prefixed with GSD_ISSUE_TRIAGE_OK=1. NEVER for a defect you discovered while coding,\n' +
        'and never to launder a defer.'
    );
  }
}

// (3) Tracking-intent language with no issue reference anywhere in the same body —
// closes the "comment as tracking" anti-pattern (CONTRIBUTING.md, gsd-core): recording
// a known-but-unfixed gap in a comment, changeset note, or TODO and treating that as
// tracking it is forbidden — a refactor deletes the code they annotate while the gap
// stays real. A gap that matters gets an issue. A gap with no issue is not tracked.
const TRACKING_PATTERNS = [
  /tracked\s+(as|separately|elsewhere|in a follow)/i,
  /tracking\s+(this|that)\s+separately/i,
  /as a follow[- ]?up/i,
  /follow[- ]?up\s+(issue|item|work|PR|task)/i,
  /(wants|needs|deserves|warrants)\s+(its|their)\s+own\s+issue/i,
  /should be (filed|tracked|opened|raised)/i,
  /will be (filed|tracked|addressed|handled)\s+(separately|later|in a follow)/i,
  /left\s+(for|to)\s+(a\s+)?(future|later|separate|follow)/i,
  /revisit\s+(this\s+)?(later|separately)/i,
  /for a separate\s+(decision|issue|PR|change)/i,
  /surfac(ed|ing)\s+(here\s+|this\s+)?for\s+(the\s+)?(maintainer|orchestrator|reviewer|later)/i,
  /not\s+(fixed|addressed|handled)\s+(here|in this)/i,
  /out of scope[,;:]\s*(surfaced|raised|flagged|noted)/i,
  /flagging\s+(this\s+)?for/i,
  /KNOWN GAP/i,
  /TODO\s*[:(]/i,
];
const ISSUE_REF = /#\d{2,}|github\.com\/[^\s"')]+\/(issues|pull)\/\d+/i;

function hasTrackingIntent(text) {
  return TRACKING_PATTERNS.some((re) => re.test(text));
}

function trackingDeny() {
  deny(
    'BLOCKED — no-defer rule: a comment/changeset note is not a tracking mechanism\n' +
      '(CONTRIBUTING.md: "a gap that matters gets an issue; a gap with no issue is not tracked").\n' +
      'This body uses tracking-intent language ("follow-up", "KNOWN GAP", "should be tracked", etc.)\n' +
      'but cites no issue (#NNN or a github.com/.../issues/NNN URL). Open the issue FIRST, then cite\n' +
      'its number in this text. If this note genuinely needs no issue, the USER (not you) may re-run\n' +
      'with GSD_TRACKING_NOTE_OK=1 — this escape is not self-issuable.'
  );
}

function isGhTrackingSurface(cmd) {
  if (/\bgh\s+issue\s+comment\b/.test(cmd)) return true;
  if (/\bgh\s+pr\s+comment\b/.test(cmd)) return true;
  if (/\bgh\s+pr\s+review\b/.test(cmd)) return true;
  if (/\bgh\s+issue\s+create\b/.test(cmd)) return true;
  if (/\bgh\s+pr\s+create\b/.test(cmd)) return true;
  if (/\bgh\s+(issue|pr)\s+close\b/.test(cmd) && /--comment\b/.test(cmd)) return true;
  if (/\bgh\s+api\b/.test(cmd) && /\/comments\b/.test(cmd)) return true;
  return false;
}

function extractGhBody(cmd) {
  const isApi = /\bgh\s+api\b/.test(cmd);
  // --body-file / -F <path>. For `gh api`, -F is a field flag (not a body-file
  // shorthand), so only honor the long form there to avoid misreading a field as a path.
  const fileFlagRe = isApi
    ? /--body-file\s+(?:"([^"]+)"|'([^']+)'|(\S+))/
    : /(?:--body-file|-F)\s+(?:"([^"]+)"|'([^']+)'|(\S+))/;
  const fm = cmd.match(fileFlagRe);
  if (fm) {
    const path = fm[1] || fm[2] || fm[3];
    try {
      return fs.readFileSync(path, 'utf8');
    } catch {
      return null; // can't read the referenced file -> fail open, do not wedge the tool
    }
  }
  const bm =
    cmd.match(/(?:--body|-b)\s+"([^"]*)"/) || cmd.match(/(?:--body|-b)\s+'([^']*)'/);
  if (bm) return bm[1];
  // Heredoc or inline body (or gh api -f/-F field pairs) — scan the whole command string.
  return cmd;
}

if (tool === 'Bash') {
  const cmd = String(input.command || '');
  if (!/GSD_TRACKING_NOTE_OK=1/.test(cmd) && isGhTrackingSurface(cmd)) {
    const body = extractGhBody(cmd);
    if (body !== null && hasTrackingIntent(body) && !ISSUE_REF.test(body)) {
      trackingDeny();
    }
  }
}

if (tool === 'Write' || tool === 'Edit' || tool === 'MultiEdit') {
  const path = String(input.file_path || '');
  if (/\.changeset\/.*\.md$/.test(path)) {
    const parts = [];
    if (typeof input.content === 'string') parts.push(input.content);
    if (typeof input.new_string === 'string') parts.push(input.new_string);
    if (Array.isArray(input.edits)) {
      for (const e of input.edits) {
        if (e && typeof e.new_string === 'string') parts.push(e.new_string);
      }
    }
    const body = parts.join('\n');
    if (hasTrackingIntent(body) && !ISSUE_REF.test(body)) {
      trackingDeny();
    }
  }
}

process.exit(0);
