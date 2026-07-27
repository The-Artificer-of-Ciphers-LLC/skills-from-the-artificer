#!/usr/bin/env node
'use strict';

/**
 * artifact-gate.cjs — a config-driven PreToolUse gate for workflow directives.
 *
 * ## The problem it solves
 *
 * A long directive is read ONCE, before any work exists. Then hours of
 * `tool-result -> decide -> tool-call` go by with nothing re-presenting it. Steps
 * marked ABSOLUTE get skipped anyway — and the ones that get skipped are always
 * the same set: the ones whose output is unobservable.
 *
 * A step that writes a failing test survives, because the next step needs that
 * test. A step that produces "a better understanding of the design" does not,
 * because doing it and claiming it are indistinguishable, and the free option
 * wins.
 *
 *     A step that produces no artifact cannot be enforced, and will be skipped.
 *
 * So: make each blocking step write a file, and make the NEXT action require it.
 * Compliance stops depending on disposition and becomes a precondition. A hook
 * fires at the instant of the action, which is the one moment the rule is
 * actually load-bearing.
 *
 * ## How it works
 *
 * Reads `.artifact-gate.json` from the repo root. Each "family" describes one
 * directive: where its artifacts live, which file ARMS it, and which actions are
 * denied until which artifacts exist. Nothing is enforced until a family is
 * armed, so ordinary ad-hoc work in the same repo is unaffected.
 *
 * See SKILL.md for the contract schema and contracts/ for worked examples.
 *
 * ## Failure posture
 *
 * - No git repo, or no `.artifact-gate.json`      -> ALLOW (not adopted here).
 * - Malformed `.artifact-gate.json`               -> DENY, loudly. A silently
 *   ignored contract is exactly the non-enforcement this tool exists to prevent.
 *   The contract file itself is always exempt, so you can always fix it.
 * - Armed family, missing artifact                -> DENY. This is the job.
 *
 * Human escape: `ARTIFACT_GATE_OVERRIDE=1` as a command prefix or an env var.
 * Logged to `.artifact-gate-override.log` at the repo root.
 */

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const CONFIG_NAME = '.artifact-gate.json';
const OVERRIDE = 'ARTIFACT_GATE_OVERRIDE';
const DEFAULT_EXEMPT = ['^\\.claude/'];

// ── harness I/O ─────────────────────────────────────────────────────────────
function readStdin() {
  try { return fs.readFileSync(0, 'utf8'); } catch { return ''; }
}

let payload = {};
try { payload = JSON.parse(readStdin() || '{}'); } catch { payload = {}; }

const toolName = String(payload.tool_name || '');
const input = payload.tool_input || {};
const cwd = String(payload.cwd || process.cwd());
const command = String(input.command || '');

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

function git(args) {
  try {
    return execFileSync('git', args, { cwd, encoding: 'utf8', timeout: 5000 }).trim();
  } catch { return ''; }
}

const isEdit = toolName === 'Edit' || toolName === 'Write' || toolName === 'NotebookEdit';
const isBash = toolName === 'Bash';
if (!isEdit && !isBash) allow();

// ── human escape, logged ────────────────────────────────────────────────────
if (new RegExp(`${OVERRIDE}=1`).test(command) || process.env[OVERRIDE] === '1') {
  try {
    const root = git(['rev-parse', '--show-toplevel']);
    if (root) {
      fs.appendFileSync(
        path.join(root, '.artifact-gate-override.log'),
        `${new Date().toISOString()}  ${toolName} ${(command || input.file_path || '').slice(0, 200)}\n`,
      );
    }
  } catch { /* logging is best-effort */ }
  allow();
}

// Fails OPEN: this gates ordinary editing, so an infrastructure hiccup must not
// brick every edit in the repo.
const repoRoot = git(['rev-parse', '--show-toplevel']);
if (!repoRoot) allow();

const configPath = path.join(repoRoot, CONFIG_NAME);
if (!fs.existsSync(configPath)) allow();

// ── path helpers ────────────────────────────────────────────────────────────
const exists = (p) => { try { return fs.existsSync(p); } catch { return false; } };

function readJson(p) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; }
}

/**
 * Repo-relative path, symlink-safe.
 *
 * A prefix comparison (`abs.startsWith(repoRoot)`) is NOT sound: git reports the
 * PHYSICAL toplevel while the tool payload carries whatever path the caller used.
 * On macOS `/tmp` -> `/private/tmp` and `/var` -> `/private/var`, so the two
 * disagree, the relative path comes out ABSOLUTE, every `src/**` rule then
 * matches nothing, and the gate fails open silently on exactly what it guards.
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
    // that DOES exist and re-attach the not-yet-created tail — resolving only the
    // immediate dirname would miss `src/new/deep/x.ts`.
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

/** Minimal, predictable glob: `**` spans separators, `*` does not. */
function globToRe(glob) {
  let out = '';
  for (let i = 0; i < glob.length; i += 1) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') { out += '.*'; i += 1; } else { out += '[^/]*'; }
    } else if (c === '?') out += '[^/]';
    else out += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${out}$`);
}

// ── config ──────────────────────────────────────────────────────────────────
const rawConfig = readJson(configPath);
const targetPath = String(input.file_path || '');
const rel = repoRelative(targetPath);

// The contract file must stay editable or a typo in it is unrecoverable.
if (isEdit && rel === CONFIG_NAME) allow();

if (!rawConfig || !Array.isArray(rawConfig.families)) {
  deny(
    `ARTIFACT GATE — \`${CONFIG_NAME}\` is missing or malformed, so no contract can be enforced.\n\n` +
    `File: ${configPath}\n` +
    'Expected: {"families":[{"name":"...","dir":"...","arm":"...","gates":[...]}]}\n\n' +
    'This denies rather than ignoring the file on purpose. A contract that silently ' +
    'fails to load is indistinguishable from having no gate at all — which is the exact ' +
    'non-enforcement this tool exists to prevent, and you would not find out until an ' +
    `unreviewed change shipped. The contract file itself stays editable, so fix it in place.\n` +
    `Human escape (never self-issue): prefix ${OVERRIDE}=1.`,
  );
}

const exemptRes = (Array.isArray(rawConfig.exempt) ? rawConfig.exempt : DEFAULT_EXEMPT)
  .map((r) => new RegExp(r));

// ── template interpolation ──────────────────────────────────────────────────
const branch = git(['rev-parse', '--abbrev-ref', 'HEAD']);
const slug = branch && branch !== 'HEAD' ? branch.replace(/[^A-Za-z0-9._-]/g, '-') : '';

/** `{slug}`, `{branch}`, `{capture}`, `{arm.field}` -> values. */
function interpolate(str, vars) {
  return String(str).replace(/\{([A-Za-z0-9_.]+)\}/g, (m, key) => {
    if (Object.prototype.hasOwnProperty.call(vars, key)) return String(vars[key]);
    if (key.startsWith('arm.')) {
      const v = vars.__arm ? vars.__arm[key.slice(4)] : undefined;
      return v === undefined ? m : String(v);
    }
    return m;
  });
}

/**
 * Resolve a dotted path with optional array-find: `issues[issue=123].state`.
 * Returns undefined when any hop is missing — callers distinguish that from a
 * literal null.
 */
function resolvePath(obj, expr) {
  let cur = obj;
  for (const rawSeg of String(expr).split('.')) {
    if (cur === null || cur === undefined) return undefined;
    const m = rawSeg.match(/^([^[]*)(?:\[([^=\]]+)=([^\]]*)\])?$/);
    if (!m) return undefined;
    const [, key, findKey, findVal] = m;
    if (key) cur = cur[key];
    if (findKey !== undefined) {
      if (!Array.isArray(cur)) return undefined;
      cur = cur.find((e) => e && String(e[findKey]) === String(findVal));
    }
  }
  return cur;
}

function assertFails(a, doc, vars) {
  if (a.when && !new RegExp(interpolate(a.when, vars)).test(command)) return null;
  const got = resolvePath(doc, interpolate(a.path, vars));
  const show = () => JSON.stringify(got);
  if ('equals' in a && got !== a.equals) return `${a.path} is ${show()}, expected ${JSON.stringify(a.equals)}`;
  if ('notEquals' in a && got === a.notEquals) return `${a.path} is ${show()}, which is not permitted`;
  if ('in' in a && !a.in.includes(got)) return `${a.path} is ${show()}, expected one of ${JSON.stringify(a.in)}`;
  if ('notIn' in a && a.notIn.includes(got)) return `${a.path} is ${show()}, which is not permitted`;
  if (a.empty === true && !(Array.isArray(got) ? got.length === 0 : (got === undefined || got === null || got === '')))
    return `${a.path} is ${show()}, expected empty`;
  if (a.nonEmpty === true && (Array.isArray(got) ? got.length === 0 : (got === undefined || got === null || got === '')))
    return `${a.path} is ${show()}, expected non-empty`;
  if (a.exists === true && got === undefined) return `${a.path} is not present`;
  if (a.integer === true && !Number.isInteger(got)) return `${a.path} is ${show()}, expected an integer`;
  if ('min' in a && !(typeof got === 'number' && got >= a.min)) return `${a.path} is ${show()}, expected >= ${a.min}`;
  // `every` recurses one assertion over each element of an array. This is what lets
  // a contract say "each unfixed finding must carry a real issue number" — the
  // shape that stops a finding from surviving only as prose.
  if (a.every) {
    // Absent is vacuously satisfied: "no unfixed findings" is the normal case, and a
    // gate that denied every artifact omitting the field would be unusable within a
    // day. A field that IS present but is not an array is still an error. Compose
    // with `exists: true` when the field is genuinely mandatory.
    if (got === undefined || got === null) return null;
    if (!Array.isArray(got)) return `${a.path} is ${show()}, expected an array`;
    for (let i = 0; i < got.length; i += 1) {
      const sub = assertFails(a.every, got[i], vars);
      if (sub) return `${a.path}[${i}].${sub}`;
    }
  }
  return null;
}

// ── evaluate every armed family ─────────────────────────────────────────────
for (const fam of rawConfig.families) {
  if (!fam || !fam.dir || !fam.arm) continue;

  const baseVars = { slug, branch };
  // A branch-scoped family cannot arm on a detached HEAD; a repo-scoped one can.
  if (String(fam.dir).includes('{slug}') && !slug) continue;

  const famDir = path.join(repoRoot, interpolate(fam.dir, baseVars));
  const armPath = path.join(famDir, fam.arm);
  if (!exists(armPath)) continue;
  if (fam.disarm && exists(path.join(famDir, fam.disarm))) continue;

  baseVars.__arm = readJson(armPath) || {};

  const famRel = interpolate(fam.dir, baseVars);
  const isExempt = (r) => exemptRes.some((re) => re.test(r)) || r.startsWith(`${famRel}/`);

  for (const gate of (fam.gates || [])) {
    if (!gate) continue;

    const vars = { ...baseVars };

    // -- does this gate apply to the action in hand? -------------------------
    if (gate.on === 'edit') {
      if (!isEdit || !rel || isExempt(rel)) continue;
      const pats = gate.paths || [];
      if (!pats.some((p) => globToRe(p).test(rel))) continue;
      vars.path = rel;
    } else if (gate.on === 'bash') {
      if (!isBash) continue;
      if (!gate.match || !new RegExp(gate.match).test(command)) continue;
      if (gate.when && !new RegExp(gate.when).test(command)) continue;
      if (gate.unless && new RegExp(gate.unless).test(command)) continue;
    } else continue;

    // -- captures ------------------------------------------------------------
    if (gate.capture) {
      const m = command.match(new RegExp(gate.capture.pattern));
      if (m && m[1] !== undefined) {
        vars[gate.capture.as] = m[1];
      } else if (gate.capture.required !== false) {
        deny(
          `ARTIFACT GATE [${fam.name}] — cannot determine \`${gate.capture.as}\` for this command, ` +
          'so the gate cannot find the artifact it requires.\n\n' +
          `Command: ${command.slice(0, 200)}\n` +
          `Expected to match: /${gate.capture.pattern}/\n\n` +
          `${gate.capture.hint || 'Pass the value positionally so the gate can resolve it.'}\n` +
          `Human escape (never self-issue): prefix ${OVERRIDE}=1.`,
        );
      } else continue;
    }

    // -- requirement ---------------------------------------------------------
    const wanted = gate.requiresAnyOf || (gate.requires ? [gate.requires] : []);
    if (!wanted.length) continue;

    const resolved = wanted.map((w) => {
      const s = interpolate(w, vars);
      // A leading '/' means repo-relative; otherwise relative to the family dir.
      return s.startsWith('/')
        ? { rel: s.slice(1), abs: path.join(repoRoot, s.slice(1)) }
        : { rel: `${famRel}/${s}`, abs: path.join(famDir, s) };
    });

    const found = resolved.find((r) => exists(r.abs));
    const label = `ARTIFACT GATE [${fam.name}]`;
    const escape = `Human escape (never self-issue): prefix ${OVERRIDE}=1.`;

    if (!found) {
      deny(
        `${label} — blocked: a required artifact does not exist.\n\n` +
        `${resolved.length > 1 ? 'Needs ONE of:' : 'Missing:'}\n` +
        resolved.map((r) => `  ${r.rel}`).join('\n') + '\n\n' +
        `${gate.message || 'Produce it, then retry.'}\n${escape}`,
      );
    }

    // -- content assertions --------------------------------------------------
    if (Array.isArray(gate.assert) && gate.assert.length) {
      const doc = readJson(found.abs);
      if (!doc) {
        deny(
          `${label} — blocked: \`${found.rel}\` exists but is not readable JSON.\n\n` +
          'This gate checks the file\'s CONTENTS, not merely its presence, so it must parse.\n\n' +
          `${gate.message || ''}\n${escape}`,
        );
      }
      for (const a of gate.assert) {
        const failure = assertFails(a, doc, vars);
        if (failure) {
          deny(
            `${label} — blocked by \`${found.rel}\`: ${failure}.\n\n` +
            `${a.else || gate.message || 'Record the real state and retry.'}\n\n` +
            'Recording a value you did not observe, in order to clear this gate, is ' +
            `falsification — not a workaround.\n${escape}`,
          );
        }
      }
    }
  }
}

allow();
