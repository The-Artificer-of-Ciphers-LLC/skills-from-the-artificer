#!/usr/bin/env node
// gsd-measure-dont-infer-guard.cjs — PreToolUse DENY guard enforcing
// "measure, don't infer": a grep/rg TEXT-match count is not a fact about
// code. It counts comment prose, string literals, and near-miss
// identifiers, not the actual AST construct being claimed.
//
// Denies a Bash command only when ALL THREE hold:
//   (1) COUNTS      — grep/egrep/rg has a count flag (-c/--count/bundled 'c'),
//                      rg has --stats, or its output is piped (anywhere
//                      downstream) into one of:
//                        `wc -l`, `wc -w`, `uniq -c` (sort optional, any flags),
//                        `sed -n '$='`, `nl` followed later by `tail`,
//                        or an `awk` whose program has an END block
//                        referencing NR, `count`, or a `++` accumulator.
//                      A `grep -c`/`grep --count` inside a `$(...)` command
//                      substitution (e.g. a for-loop accumulator reading a
//                      shell-variable target) counts too, and there the
//                      TARGET condition below is treated as satisfied
//                      unconditionally — the substitution itself is the tell.
//   (2) PATTERN     — the search pattern looks like a code construct
//                      (escaped-dot+identifier, parens, code keywords, camelCase).
//   (3) TARGET      — the search target looks like source code (extension,
//                      source dir, or recursive search with no non-source filter).
//
// Escape hatch — exactly one, and it is NOT self-issuable:
//   GSD_MEASURE_GUARD_OFF=1 exported in the shell that launches Claude Code.
// The former inline `# text-count-ok:` / `# raw-lines-ok:` comment escapes
// were REMOVED 2026-09-09: the model authored its own justification inside
// the command being judged, which is not a control, it is a documented
// off-switch. See the note at the check site.
//
// Repeat-denial detector (runs BEFORE the three-condition check above):
// enumerating counting mechanisms forever is the wrong fix, since a denied
// question can be re-asked by rewording the pattern, swapping wc/uniq/sed/nl
// for another mechanism, or moving the same grep into a subagent. Instead,
// every denial is fingerprinted on (normalized pattern, target roots) and
// persisted to ~/.claude/state/gsd-measure-guard-denials.jsonl. Any
// grep/egrep/rg invocation — counting or not — whose fingerprint matches a
// denial from the last 15 minutes is denied outright as a repeat, because a
// reworded shell command answers the underlying question no better than the
// original denial did.
//
// Blocking contract: PreToolUse hook exits 2 -> Claude Code blocks the tool
// call and feeds stderr back to the model. Exit 0 = allow. Never crash-to-deny.

'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const DENIAL_WINDOW_MS = 15 * 60 * 1000;
const DENIAL_FILE_CAP = 200;
const STATE_DIR = path.join(os.homedir(), '.claude', 'state');
const DENIAL_FILE = path.join(STATE_DIR, 'gsd-measure-guard-denials.jsonl');

const ANTI_CIRCUMVENTION =
  'DO NOT REPHRASE THIS COMMAND TO GET PAST THIS GUARD.\n' +
  'Rewording the pattern, swapping the counting mechanism, changing the target path,\n' +
  'or moving the work into a subagent is circumvention, not problem-solving. If you\n' +
  'believe this guard is wrong, SAY SO TO THE USER and stop — do not route around it.\n' +
  '\n';

function allow() {
  process.exit(0);
}

// ---- fingerprinting ---------------------------------------------------

// normalizedPattern: lowercase, backslashes stripped, runs of regex
// metacharacters collapsed to a single '.', and any leading/trailing
// collapsed run trimmed away — so an unclosed `(` at a pattern's boundary
// (an artifact of how a particular shell quoting style truncated it) does
// not manufacture a distinct fingerprint. This is what makes
// `process\.exit`, `process\.exit\(`, and `"process.exit("` collide.
function normalizePattern(pattern) {
  if (typeof pattern !== 'string') return '';
  let p = pattern.toLowerCase();
  p = p.replace(/\\/g, '');
  p = p.replace(/[[\](){}*+?^$|.]+/g, '.');
  p = p.replace(/^\.+|\.+$/g, '');
  return p;
}

function firstPathSegment(target) {
  if (typeof target !== 'string' || !target) return '';
  const t = target.replace(/^\.\//, '');
  const idx = t.indexOf('/');
  return idx === -1 ? t : t.slice(0, idx);
}

function sortedTargetRoots(targets) {
  const roots = (targets || []).map(firstPathSegment).filter(Boolean);
  return Array.from(new Set(roots)).sort().join(',');
}

function fingerprintOf(pattern, targets) {
  const norm = normalizePattern(pattern);
  const roots = sortedTargetRoots(targets);
  return crypto.createHash('sha1').update(`${norm}|${roots}`).digest('hex');
}

// ---- denial persistence -------------------------------------------------
// A state-write (or state-read) failure here must NEVER change the
// allow/deny outcome — every function in this section fails closed to "no
// prior denial found" / "denial not recorded", never to a thrown error.

function readDenialRecords() {
  try {
    const raw = fs.readFileSync(DENIAL_FILE, 'utf8');
    return raw
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  } catch {
    return [];
  }
}

// Prunes records older than 15 minutes on each read.
function findRecentDenial(fp) {
  if (!fp) return null;
  try {
    const cutoff = Date.now() - DENIAL_WINDOW_MS;
    const records = readDenialRecords();
    for (const rec of records) {
      if (rec && rec.fingerprint === fp && typeof rec.ts === 'number' && rec.ts >= cutoff) {
        return rec;
      }
    }
    return null;
  } catch {
    return null;
  }
}

function recordDenial(pattern, targets, cwd) {
  try {
    fs.mkdirSync(STATE_DIR, { recursive: true });
    const now = Date.now();
    const cutoff = now - DENIAL_WINDOW_MS;
    let records = readDenialRecords().filter(
      (r) => r && typeof r.ts === 'number' && r.ts >= cutoff
    );
    records.push({
      ts: now,
      fingerprint: fingerprintOf(pattern, targets),
      pattern: String(pattern || ''),
      targets: Array.isArray(targets) ? targets : [],
      cwd: String(cwd || ''),
    });
    if (records.length > DENIAL_FILE_CAP) {
      records = records.slice(records.length - DENIAL_FILE_CAP);
    }
    const body = records.map((r) => JSON.stringify(r)).join('\n') + '\n';
    fs.writeFileSync(DENIAL_FILE, body, 'utf8');
  } catch {
    // A state-write failure must never change the allow/deny outcome.
  }
}

function main() {
  let raw = '';
  try {
    raw = fs.readFileSync(0, 'utf8');
  } catch {
    return allow(); // no stdin -> nothing to guard
  }
  if (!raw || !raw.trim()) return allow();

  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    return allow(); // unparseable -> fail open
  }

  const tool = (data && data.tool_name) || '';
  if (tool !== 'Bash') return allow();

  const input = (data && data.tool_input) || {};
  const cmd = String(input.command || '');
  if (!cmd.trim()) return allow();

  const cwd = (data && data.cwd) || process.cwd();

  // 2026-09-09: the inline `# text-count-ok:` / `# raw-lines-ok:` escapes are
  // DELETED. They were self-issuable — the constrained party authored the
  // justification, inside the very command being judged, with no external
  // check — so the "escape hatch" was in practice an instruction to the model
  // for how to switch the guard off, and it was used exactly that way
  // (measured in a live session: blocked on a `@State` count, wrote its own
  // justification comment, re-ran, allowed).
  //
  // An escape the constrained party can mint is not a control. The sound
  // design is the one gsd-memtrace-first-guard already uses: an env var that
  // must be EXPORTED IN THE SHELL THAT LAUNCHES CLAUDE CODE. This hook runs
  // as its own process, so the pending command text is not in its
  // environment and an inline `VAR=1 <cmd>` prefix cannot reach it.
  if (process.env.GSD_MEASURE_GUARD_OFF === '1') return allow();

  const EXT_LIST = [
    'ts', 'cts', 'mts', 'tsx', 'js', 'cjs', 'mjs', 'jsx',
    'py', 'go', 'rs', 'java', 'rb', 'php', 'c', 'h', 'cpp', 'swift', 'kt', 'sh',
  ];
  const DIR_LIST = [
    'src', 'lib', 'scripts', 'hooks', 'bin', 'app', 'pkg',
    'internal', 'cmd', 'eslint-rules', 'capabilities', 'tests', 'test',
  ];
  const CODE_TOKENS = [
    'function', 'class ', '=>', 'require', 'import ', 'module.exports',
    'export ', 'async ', 'await ', 'process.', 'process\\.', '=', '::',
  ];
  const VALUE_FLAGS = new Set([
    '-e', '-f', '-m', '-A', '-B', '-C', '-g',
    '--include', '--exclude', '--exclude-dir', '--max-count',
    '--glob', '--iglob', '--context', '--after-context', '--before-context',
    '--type', '--type-add',
  ]);

  // ---- quote-aware splitting ----------------------------------------------

  function splitTopLevel(str, separators) {
    const parts = [];
    let current = '';
    let inS = false;
    let inD = false;
    let i = 0;
    outer: while (i < str.length) {
      const c = str[i];
      if (c === "'" && !inD) {
        inS = !inS;
        current += c;
        i++;
        continue;
      }
      if (c === '"' && !inS) {
        inD = !inD;
        current += c;
        i++;
        continue;
      }
      if (!inS && !inD) {
        for (const sep of separators) {
          if (str.startsWith(sep, i)) {
            parts.push(current);
            current = '';
            i += sep.length;
            continue outer;
          }
        }
      }
      current += c;
      i++;
    }
    parts.push(current);
    return parts;
  }

  function tokenize(str) {
    const tokens = [];
    let cur = '';
    let has = false;
    let i = 0;
    while (i < str.length) {
      const c = str[i];
      if (/\s/.test(c)) {
        if (has) {
          tokens.push(cur);
          cur = '';
          has = false;
        }
        i++;
        continue;
      }
      if (c === "'") {
        has = true;
        i++;
        while (i < str.length && str[i] !== "'") {
          cur += str[i];
          i++;
        }
        i++; // skip closing quote (or end of string)
        continue;
      }
      if (c === '"') {
        has = true;
        i++;
        while (i < str.length && str[i] !== '"') {
          if (str[i] === '\\' && i + 1 < str.length && '$`"\\\n'.includes(str[i + 1])) {
            cur += str[i + 1];
            i += 2;
            continue;
          }
          cur += str[i];
          i++;
        }
        i++; // skip closing quote
        continue;
      }
      if (c === '\\' && i + 1 < str.length) {
        has = true;
        cur += str[i + 1];
        i += 2;
        continue;
      }
      has = true;
      cur += c;
      i++;
    }
    if (has) tokens.push(cur);
    return tokens;
  }

  function shortFlagHasLetter(token, letter) {
    if (!/^-[A-Za-z]+$/.test(token)) return false;
    return token.slice(1).includes(letter);
  }

  function hasCountFlag(flags) {
    return flags.some((f) => f === '--count' || shortFlagHasLetter(f, 'c'));
  }

  function hasRecursiveFlag(flags) {
    return flags.some(
      (f) =>
        f === '--recursive' ||
        shortFlagHasLetter(f, 'r') ||
        shortFlagHasLetter(f, 'R')
    );
  }

  function isWcLineCountStage(stage) {
    const toks = tokenize(stage);
    if (toks.length === 0) return false;
    const first = toks[0].replace(/^.*\//, ''); // strip path prefix
    if (first !== 'wc') return false;
    return toks
      .slice(1)
      .some((t) => t === '-l' || t === '--lines' || shortFlagHasLetter(t, 'l'));
  }

  function isWcWordCountStage(stage) {
    const toks = tokenize(stage);
    if (toks.length === 0) return false;
    const first = toks[0].replace(/^.*\//, '');
    if (first !== 'wc') return false;
    return toks
      .slice(1)
      .some((t) => t === '-w' || t === '--words' || shortFlagHasLetter(t, 'w'));
  }

  function isUniqCountStage(stage) {
    const toks = tokenize(stage);
    if (toks.length === 0) return false;
    const first = toks[0].replace(/^.*\//, '');
    if (first !== 'uniq') return false;
    return toks.slice(1).some((t) => t === '--count' || shortFlagHasLetter(t, 'c'));
  }

  function isAwkCountStage(stage) {
    const toks = tokenize(stage);
    if (toks.length === 0) return false;
    const first = toks[0].replace(/^.*\//, '');
    if (first !== 'awk') return false;
    if (!/\bEND\b/.test(stage)) return false;
    return /\bNR\b/.test(stage) || /\bcount\b/i.test(stage) || /\+\+/.test(stage);
  }

  // Leak #1: `sed -n '$='` prints the total line count — a count, not a listing.
  function isSedLineCountStage(stage) {
    const toks = tokenize(stage);
    if (toks.length === 0) return false;
    const first = toks[0].replace(/^.*\//, '');
    if (first !== 'sed') return false;
    const hasN = toks.some((t) => t === '-n' || t === '--quiet' || shortFlagHasLetter(t, 'n'));
    if (!hasN) return false;
    return toks.some((t) => t.includes('$='));
  }

  // Leak #2 (paired with isTailStage below): `nl | tail -1` reads off the
  // last line number `nl` assigned — a count via a different mechanism.
  function isNlStage(stage) {
    const toks = tokenize(stage);
    if (toks.length === 0) return false;
    return toks[0].replace(/^.*\//, '') === 'nl';
  }

  function isTailStage(stage) {
    const toks = tokenize(stage);
    if (toks.length === 0) return false;
    return toks[0].replace(/^.*\//, '') === 'tail';
  }

  function parseGrepStage(stage) {
    const m = stage
      .trim()
      .match(/^(?:\w+=\S+\s+)*(?:\S*\/)?(grep|egrep|rg)\b(.*)$/s);
    if (!m) return null;
    const rest = m[2] || '';
    const toks = tokenize(rest);

    const flags = [];
    const positionals = [];
    let eValue = null;
    let includeValue = null;

    let i = 0;
    while (i < toks.length) {
      const t = toks[i];
      if (t.startsWith('-')) {
        flags.push(t);
        const eq = t.indexOf('=');
        if (t.startsWith('--') && eq !== -1) {
          const name = t.slice(0, eq);
          const val = t.slice(eq + 1);
          if (name === '--include') includeValue = val;
          i++;
          continue;
        }
        if (VALUE_FLAGS.has(t)) {
          const val = toks[i + 1];
          if (t === '-e' && eValue === null && val !== undefined) eValue = val;
          if (t === '--include' && val !== undefined) includeValue = val;
          i += val !== undefined ? 2 : 1;
          continue;
        }
        i++;
        continue;
      }
      positionals.push(t);
      i++;
    }

    let pattern;
    let targets;
    if (eValue !== null) {
      pattern = eValue;
      targets = positionals;
    } else {
      pattern = positionals[0];
      targets = positionals.slice(1);
    }

    return { tool: m[1], flags, pattern, targets, includeValue };
  }

  function patternIsCodeConstruct(pattern) {
    if (typeof pattern !== 'string' || pattern.length === 0) return false;
    if (/\\\.[A-Za-z_]/.test(pattern)) return true;
    if (pattern.includes('(')) return true;
    if (CODE_TOKENS.some((tok) => pattern.includes(tok))) return true;
    if (/[a-z]+[A-Z]/.test(pattern)) return true;
    return false;
  }

  function extHasSourceExt(str) {
    if (typeof str !== 'string' || !str) return false;
    return EXT_LIST.some((ext) => str.toLowerCase().endsWith('.' + ext));
  }

  function isSourceDir(target) {
    if (typeof target !== 'string' || !target) return false;
    let t = target.replace(/^\.\//, '').replace(/\/+$/, '');
    return DIR_LIST.some((d) => t === d || t.startsWith(d + '/'));
  }

  function targetLooksSource(targets, includeValue, recursive) {
    if (extHasSourceExt(includeValue)) return true;
    if (targets.some((t) => extHasSourceExt(t))) return true;
    if (targets.some((t) => isSourceDir(t))) return true;
    if (recursive) {
      const includeRestrictsAway = includeValue && !extHasSourceExt(includeValue);
      if (!includeRestrictsAway) return true;
    }
    return false;
  }

  function isDirectCount(parsed) {
    return hasCountFlag(parsed.flags) || (parsed.tool === 'rg' && parsed.flags.includes('--stats'));
  }

  // ---- generalized grep-invocation extraction ----------------------------
  // The repeat-denial detector (and, below, the three-condition check) must
  // consider any command that CONTAINS a grep/egrep/rg invocation anywhere —
  // inside `$(...)`/`$((...))`, a for/while/if body, after `;`/`&&`/`||`/`|`,
  // not only a command whose FIRST word is grep/rg. Extracting every
  // invocation once, up front, is what lets both checks see e.g. a `grep -c`
  // buried in a `for`-loop arithmetic accumulator or an `if grep -qc ...`
  // condition — without adding a second counting mechanism.

  // true at index i if str[i] falls inside a single- or double-quoted span.
  function computeQuoteMask(str) {
    const mask = new Array(str.length).fill(false);
    let inS = false;
    let inD = false;
    for (let i = 0; i < str.length; i++) {
      const c = str[i];
      if (c === "'" && !inD) {
        inS = !inS;
        mask[i] = true;
        continue;
      }
      if (c === '"' && !inS) {
        inD = !inD;
        mask[i] = true;
        continue;
      }
      mask[i] = inS || inD;
    }
    return mask;
  }

  // Ranges of `$(...)`/`$((...))` command-substitution spans, e.g. a
  // for-loop accumulator `total=$(( total + $(grep -c "x" "$f") ))`.
  // Balanced-paren extraction; quotes inside the substitution are not
  // quote-aware, and nested `$((...))` arithmetic is not re-nested exactly —
  // both are acceptable approximations here, because this is used only to
  // test whether a grep invocation's START falls inside SOME substitution
  // span, never to re-parse the span's content.
  function extractSubstitutionRanges(str) {
    const ranges = [];
    let i = 0;
    while (i < str.length) {
      if (str[i] === '$' && str[i + 1] === '(') {
        const start = i;
        let depth = 1;
        let j = i + 2;
        while (j < str.length && depth > 0) {
          if (str[j] === '(') depth++;
          else if (str[j] === ')') depth--;
          j++;
        }
        ranges.push({ start, end: j });
        i = j;
      } else {
        i++;
      }
    }
    return ranges;
  }

  const VAR_REF_RE = /^\$\{?([A-Za-z_][A-Za-z0-9_]*)\}?$/;

  // `for VAR in <glob-list> ... do` bindings, so a grep TARGET that is a
  // loop variable (e.g. `grep -c "x" "$f"` inside `for f in src/*.cts; do
  // ... done`) can be resolved back to the glob it was bound from.
  function collectLoopBindings(str) {
    const bindings = new Map();
    const re = /\bfor\s+([A-Za-z_][A-Za-z0-9_]*)\s+in\s+([^;\n]*?)(?:;|\bdo\b)/g;
    let m;
    while ((m = re.exec(str)) !== null) {
      if (!bindings.has(m[1])) bindings.set(m[1], tokenize(m[2]));
    }
    return bindings;
  }

  // Classifies one grep TARGET token against the source-ext/source-dir
  // rules, resolving it through a loop binding first if it is a bare shell
  // variable reference. isSource: true/false when determinate, null when
  // genuinely unresolvable (a loop variable with no discoverable binding) —
  // the fail-closed case the caller applies when COUNTS and PATTERN already
  // hold: "measure, don't infer" cuts both ways, so an unmeasurable target
  // is not assumed safe either.
  function classifyTarget(target, loopBindings) {
    const varMatch = VAR_REF_RE.exec(target);
    if (!varMatch) {
      return { effective: [target], isSource: extHasSourceExt(target) || isSourceDir(target) };
    }
    const tokens = loopBindings.get(varMatch[1]);
    if (!tokens || tokens.length === 0) return { effective: [target], isSource: null };
    return { effective: tokens, isSource: tokens.some((t) => extHasSourceExt(t) || isSourceDir(t)) };
  }

  function classifyTargets(parsed, loopBindings) {
    const classifications = (parsed.targets || []).map((t) => classifyTarget(t, loopBindings));
    const anyResolvedSource = classifications.some((c) => c.isSource === true);
    const anyUnresolved = classifications.some((c) => c.isSource === null);
    const effectiveTargets = classifications.length
      ? classifications.flatMap((c) => c.effective)
      : parsed.targets;
    return { anyResolvedSource, anyUnresolved, effectiveTargets };
  }

  // Scans the WHOLE command for every grep/egrep/rg invocation — a word-
  // boundary match not inside a quoted string — and extracts each one
  // forward, quote-aware, to the next unquoted `;`, `|`, `)`, `&&`, `||`, or
  // end of string. Starting extraction AT the tool word (rather than
  // requiring it to be the first word of a stage) is what catches `if grep
  // -qc ...`, a grep nested in `$((...))`, etc.
  function extractGrepInvocations(str) {
    const quoteMask = computeQuoteMask(str);
    const subRanges = extractSubstitutionRanges(str);
    const wordRe = /\b(grep|egrep|rg)\b/g;
    const invocations = [];
    let m;
    while ((m = wordRe.exec(str)) !== null) {
      const start = m.index;
      if (quoteMask[start]) continue; // a quoted MENTION, not an invocation

      let i = start;
      let inS = false;
      let inD = false;
      while (i < str.length) {
        const c = str[i];
        if (c === "'" && !inD) {
          inS = !inS;
          i++;
          continue;
        }
        if (c === '"' && !inS) {
          inD = !inD;
          i++;
          continue;
        }
        if (!inS && !inD) {
          if (c === ';' || c === '|' || c === ')') break;
          if (str.startsWith('&&', i) || str.startsWith('||', i)) break;
        }
        i++;
      }

      const parsed = parseGrepStage(str.slice(start, i).trim());
      if (!parsed) continue;
      const insideSubstitution = subRanges.some((r) => start >= r.start && start < r.end);
      invocations.push({ parsed, insideSubstitution });
    }
    return invocations;
  }

  // ---- walk the command: statements -> pipeline stages --------------------

  const loopBindings = collectLoopBindings(cmd);

  // Generalized pass: every grep/egrep/rg invocation anywhere in the
  // command — repeat-denial check first (runs whether or not the invocation
  // counts), then the three-condition check restricted to direct count
  // flags/modes (a `grep -c` etc. found this way is never itself the head
  // of a pipeline stage worth scanning downstream of — that stays the job
  // of the pipeline-stage pass below).
  for (const inv of extractGrepInvocations(cmd)) {
    const { parsed, insideSubstitution } = inv;
    const cls = classifyTargets(parsed, loopBindings);

    const fp = fingerprintOf(parsed.pattern, cls.effectiveTargets);
    const priorDenial = findRecentDenial(fp);
    if (priorDenial) {
      recordDenial(parsed.pattern, cls.effectiveTargets, cwd);
      denyRepeat(cmd, priorDenial);
    }

    const directCount = isDirectCount(parsed);
    const codeConstruct = patternIsCodeConstruct(parsed.pattern);
    if (!directCount || !codeConstruct) continue;

    const recursive = hasRecursiveFlag(parsed.flags);
    const literalSource = targetLooksSource(parsed.targets, parsed.includeValue, recursive);
    // Fail-closed: TARGET is treated as satisfied when it is genuinely
    // unresolvable (an unbound loop variable) or the invocation sits inside
    // a `$(...)` substitution (the substitution itself is the tell — see
    // the module banner) — never for a target that resolves cleanly to a
    // non-source path/extension.
    const failClosed = !literalSource && !cls.anyResolvedSource && (cls.anyUnresolved || insideSubstitution);
    const isSource = literalSource || cls.anyResolvedSource || failClosed;
    if (!isSource) continue;

    const matched = [
      `COUNTS: count flag/mode among [${parsed.flags.join(' ') || '(none)'}]`,
      `PATTERN is a code construct: "${parsed.pattern}"`,
      `TARGET looks like source: [${cls.effectiveTargets.join(' ') || '(none)'}]` +
        (recursive ? ' (recursive)' : '') +
        (parsed.includeValue ? ` --include=${parsed.includeValue}` : '') +
        (failClosed ? ' (unresolved target, fail-closed)' : ''),
    ];

    recordDenial(parsed.pattern, cls.effectiveTargets, cwd);
    deny(cmd, matched);
  }

  // Pipeline-stage pass: grep as (the whole of) a pipeline stage, possibly
  // piped downstream into wc/uniq/awk/sed/nl+tail. Kept separate from the
  // generalized pass above because "downstream pipe" detection needs actual
  // pipeline-stage boundaries, which only make sense when grep IS a stage —
  // not when it is nested inside a substitution or loop/if body. The
  // generalized pass above already ran the repeat-denial check for every
  // invocation this loop will see, so this loop does not repeat it.
  const statements = splitTopLevel(cmd, ['&&', '||', ';']);

  for (const statement of statements) {
    const stages = splitTopLevel(statement, ['|']);
    for (let idx = 0; idx < stages.length; idx++) {
      const parsed = parseGrepStage(stages[idx]);
      if (!parsed) continue;

      const directCount = isDirectCount(parsed);
      let downstreamCountStage = null;
      if (!directCount) {
        for (let k = idx + 1; k < stages.length; k++) {
          if (
            isWcLineCountStage(stages[k]) ||
            isWcWordCountStage(stages[k]) ||
            isUniqCountStage(stages[k]) ||
            isAwkCountStage(stages[k]) ||
            isSedLineCountStage(stages[k])
          ) {
            downstreamCountStage = stages[k].trim();
            break;
          }
          if (isNlStage(stages[k]) && k + 1 < stages.length && isTailStage(stages[k + 1])) {
            downstreamCountStage = `${stages[k].trim()} | ${stages[k + 1].trim()}`;
            break;
          }
        }
      }
      const counts = directCount || downstreamCountStage !== null;
      if (!counts) continue;

      const codeConstruct = patternIsCodeConstruct(parsed.pattern);
      if (!codeConstruct) continue;

      const recursive = hasRecursiveFlag(parsed.flags);
      const isSource = targetLooksSource(parsed.targets, parsed.includeValue, recursive);
      if (!isSource) continue;

      // All three conditions matched -> deny.
      const matched = [];
      matched.push(
        directCount
          ? `COUNTS: count flag/mode among [${parsed.flags.join(' ') || '(none)'}]`
          : `COUNTS: piped into '${downstreamCountStage}'`
      );
      matched.push(`PATTERN is a code construct: "${parsed.pattern}"`);
      matched.push(
        `TARGET looks like source: [${parsed.targets.join(' ') || '(none)'}]` +
          (recursive ? ' (recursive)' : '') +
          (parsed.includeValue ? ` --include=${parsed.includeValue}` : '')
      );

      recordDenial(parsed.pattern, classifyTargets(parsed, loopBindings).effectiveTargets, cwd);
      deny(cmd, matched);
    }
  }

  allow();
}

function deny(cmd, matched) {
  const msg =
    ANTI_CIRCUMVENTION +
    "MEASURE, DON'T INFER — a grep count is a TEXT-match count, not a fact about code.\n" +
    '\n' +
    'It counts comment prose, string literals, and near-miss identifiers. Worked example\n' +
    "from 2026-08-26: `grep -c 'process\\.exit' src/` reported ~2x the real number because\n" +
    'it matched (a) comments that DISCUSS `catch { process.exit(0) }` and (b) every\n' +
    '`process.exitCode` assignment — which is the CORRECT pattern, counted as if it were\n' +
    'the defect.\n' +
    '\n' +
    'If the number is going into a claim, count the construct, not the text:\n' +
    '  parse with @typescript-eslint/parser and walk for the actual node type.\n' +
    '\n' +
    'For an indexed repo, the graph answers census questions natively and exactly —\n' +
    'these return structural counts, not regex hits:\n' +
    '  mcp__memtrace__find_code            ranked symbols for a concept\n' +
    '  mcp__memtrace__find_symbol          exact symbol -> file:start:end\n' +
    '  mcp__memtrace__get_symbol_context   callers / callees for a symbol\n' +
    '  mcp__memtrace__get_impact           blast radius\n' +
    '  mcp__memtrace__get_repository_stats node counts by kind, edges, communities\n' +
    '\n' +
    'There is NO inline escape. If this guard is firing wrongly, SAY SO TO THE USER\n' +
    'and stop. A human can export GSD_MEASURE_GUARD_OFF=1 in the shell that launches\n' +
    'Claude Code; that is not self-issuable — this hook runs as its own process, so an\n' +
    'inline `VAR=1 <cmd>` prefix does not reach it.\n' +
    '\n' +
    `Offending command:\n  ${cmd}\n` +
    `Matched conditions:\n  - ${matched.join('\n  - ')}\n`;
  process.stderr.write(msg);
  process.exit(2);
}

function denyRepeat(cmd, priorDenial) {
  const ageSec = Math.max(0, Math.round((Date.now() - priorDenial.ts) / 1000));
  const msg =
    ANTI_CIRCUMVENTION +
    'REPEAT OF A DENIED QUESTION — this is the same (pattern, target) you were just\n' +
    'denied for, arriving by a different mechanism. That is the circumvention pattern\n' +
    'this guard exists to stop: the previous denial routed you to the graph, and\n' +
    'rewording the shell command does not answer the question any better than it did\n' +
    '30 seconds ago.\n' +
    '\n' +
    'Answer it with the graph instead:\n' +
    '  mcp__memtrace__find_code / find_symbol / get_symbol_context / get_impact\n' +
    '  mcp__memtrace__get_repository_stats\n' +
    '\n' +
    'There is NO inline escape. Do not reword this again — say so to the user instead.\n' +
    '\n' +
    `Offending command:\n  ${cmd}\n` +
    `Previously denied ${ageSec}s ago for pattern: "${priorDenial.pattern}"\n`;
  process.stderr.write(msg);
  process.exit(2);
}

try {
  main();
} catch {
  allow(); // never crash-to-deny
}
