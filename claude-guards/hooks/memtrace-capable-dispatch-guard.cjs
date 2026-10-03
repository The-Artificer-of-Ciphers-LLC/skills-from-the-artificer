#!/usr/bin/env node
// gsd-hook-version: 1.0.0
//
// MEMTRACE-CAPABLE DISPATCH GUARD (PreToolUse, matcher "Agent").
//
// RULE: inside gsd-core (or any of its worktrees) do not dispatch the
// sonnet-coder / haiku-scout / haiku-importer agent types. They have no
// Memtrace tools, so they cannot follow the Memtrace-first read rule and end up
// either failing the task or reading indexed source through guarded routes.
//
// INCIDENT (2026-09-29): sonnet-coder (no Memtrace tools) was dispatched for
// gsd-core source edits it could not perform compliantly; the resulting
// denials were then routed around instead of reported.
//
// Fails OPEN on any internal error (malformed stdin, unresolvable cwd, ...).
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// Scoped repo root: MEMTRACE_DISPATCH_GUARD_ROOT overrides the default ~/projects/gsd-core.
const GSD_CORE = process.env.MEMTRACE_DISPATCH_GUARD_ROOT || path.join(os.homedir(), 'projects', 'gsd-core');
const DENIED_TYPES = new Set(['sonnet-coder', 'haiku-scout', 'haiku-importer']);

function allow() {
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'allow' } }));
}

function readStdin(timeoutMs) {
  return new Promise((resolve) => {
    let data = '';
    let done = false;
    const finish = () => { if (!done) { done = true; resolve(data); } };
    const t = setTimeout(finish, timeoutMs);
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (c) => { data += c; });
    process.stdin.on('end', () => { clearTimeout(t); finish(); });
    process.stdin.on('error', () => { clearTimeout(t); finish(); });
  });
}

function real(p) {
  try { return fs.realpathSync(p); } catch { return p; }
}

function inGsdCore(cwd) {
  if (typeof cwd !== 'string' || !cwd) return false;
  const root = real(GSD_CORE).replace(/\/+$/, '');
  const c = real(cwd).replace(/\/+$/, '');
  return c === root || c.startsWith(root + '/');
}

async function main() {
  const raw = await readStdin(4000);
  if (!raw || !raw.trim()) return allow();
  let payload;
  try { payload = JSON.parse(raw); } catch { return allow(); }
  if (!payload || typeof payload !== 'object') return allow();
  const input = (payload.tool_input && typeof payload.tool_input === 'object') ? payload.tool_input : {};
  const type = typeof input.subagent_type === 'string' ? input.subagent_type.trim().toLowerCase() : '';
  if (!DENIED_TYPES.has(type)) return allow();
  if (!inGsdCore(payload.cwd)) return allow();
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason:
        type + ' has no Memtrace tools, so it cannot follow the Memtrace-first read rule in gsd-core. ' +
        'Dispatch subagent_type "general-purpose" with model "sonnet" and brief it to read source only via ' +
        'mcp__memtrace__get_source_window (Read only on a span Memtrace returned). ' +
        // CodeGraph fallback when Memtrace is unavailable / quota-exhausted. Citations:
        // https://github.com/colbymchenry/codegraph @6560052 README.md:486 (subagents never see MCP
        // guidance and use the `codegraph explore` CLI), :539 (`codegraph node <symbol|file>` reads a
        // file with line numbers), :541-543 (callers/callees/impact CLI), :537 (`query`).
        'If Memtrace is unavailable / quota-exhausted, brief the subagent to use the CodeGraph CLI via ' +
        'Bash instead: `codegraph query <sym>` (find_symbol), `codegraph explore <q>` (find_code), ' +
        '`codegraph node <file|sym>` (get_source_window / get_symbol_context), `codegraph callers|callees|' +
        'impact <sym>` (get_impact). Never grep/cat indexed source.',
    },
  }));
}

main()
  .catch(() => { try { allow(); } catch { /* ignore */ } })
  .finally(() => process.exit(0));
