#!/usr/bin/env node
// gsd-hook-version: 1.5.1
//
// 1.5.1 (2026-09-10, THIRD-party verification of the 1.5.0 rewrite and of the
//   audit that reviewed it). Closes four measured DENY->ALLOW defects that
//   1.5.0 shipped. Each was reproduced against 1.5.0 (ALLOW) and against a
//   reconstructed real 1.4.0 (DENY) before the fix was written:
//     R1  wrapper prefixes -- clauseBinary() returned the clause's FIRST
//         non-flag token, so `env|nice|sudo|time|command|exec|eval|nohup|
//         timeout|stdbuf|xargs|watch ... cat <src>` (and `sudo -u <user> cat
//         <src>`) all ALLOWed. ~20 shapes 1.4.0 caught.
//     R2  `grep '' <src>` -- clauseOperands() tested `!t` BEFORE decrementing
//         the PATTERN slot, so an empty pattern let the FILE fill that slot
//         and the whole file dumped, ALLOWed. Two characters defeated the
//         guard's single most central case. Same for rg/sed/awk.
//     R3  `< <src> cat` and `cat<<src>` -- the glued `<` made baseNameOf()
//         return the FILENAME as the binary. INPUT redirects only; `>`/`>>`
//         are writes and are deliberately still ignored.
//     B1  `git -C . show HEAD:<src>` -- the `-C` branch in gitClauseOperands()
//         sat AFTER a startsWith('-') test and was unreachable, so the
//         subcommand read as `.` and 1.5.0's own headline git fix never fired.
//   Also: the audit log now rotates at 5 MB (one generation kept).
//   TEST SUITE: 1.5.0's suite was BLIND to the extension it protects -- 61
//   uses of `.cts`, ZERO of `.swift`, against a TypeScript REAL_REPO, while
//   the protected repo is Swift. A mutant deleting `swift` (and py/go/rs/
//   java/kt/rb/php/cs) from SOURCE_EXTS passed it 60/60. The suite is now
//   parameterised over BOTH extensions plus a real on-disk Swift fixture
//   repo; that mutant now fails 71 cases. 191 tests.
//   NOT FIXED, deliberately -- see the report: `find ... | xargs cat <src>`
//   (cross-clause, stdin-fed) still ALLOWs, `cat <src>.*` still ALLOWs
//   (documented bare-glob gap), an unexpanded `$VAR` in a path operand still
//   produces FALSE DENIES, and the unrestricted-Grep-over-a-source-directory
//   gap is untouched and pinned in all three output_modes.
//
// 1.5.0 (2026-09-09, independent adversarial review) — READ extractPathOperands()
// LINE BY LINE; it is the single function that decides what gets denied.
//   PRECISION (removes denials): decisions are now per-CLAUSE, not per-command.
//     A read binary in one clause no longer lends its read-ness to a filename
//     that merely appears in another. Heredoc bodies, `#` comments, quoted
//     grep PATTERNs, and `find -name` VALUES are no longer path operands.
//     This is a security property, not a convenience: 1.4.0 cried wolf often
//     enough to train the agent to treat denials as noise.
//   COVERAGE (adds denials): the read surface now includes
//     nl/strings/od/xxd/tac/rev/more/cut/column/perl/diff/... ; `git show`,
//     `git cat-file` and `git grep` are no longer covered by the blanket git
//     exemption; trailing shell punctuation, `file:line` suffixes,
//     adjacent-quote concatenation, `VAR=<path>` indirection and a glob
//     character in the extension no longer defeat extension matching; the
//     Glob TOOL's `pattern` field is finally read (HOLE C); brace-alternation
//     globs are recognised (HOLE D).
//   DETECTION: every deny is appended to ~/.claude/logs/gsd-memtrace-guard.jsonl,
//     and an allowed command that is the denied one minus the offending
//     fragment is flagged `evasion_suspected` (logged, never blocked).
//   KNOWN, DELIBERATE GAP: an unrestricted Grep over a source directory
//     (no glob/type) is still ALLOWED. Closing it would deny nearly every
//     Grep inside a source repo including prose search — a product decision
//     for the human, pinned by a test so any change is deliberate.
//   NOT AN ACCESS BOUNDARY: everything this guard blocks is obtainable via
//     mcp__memtrace__get_source_window, which the deny text itself prescribes.
//     It is a routing preference with an audit trail.
// memtrace-first-guard.cjs — PreToolUse guard on Read|Grep|Glob|Bash.
//
// Rule (CODE-DISCOVERY ROUTING, ~/.claude/CLAUDE.md): code-symbol lookups go
// through Memtrace (mcp__memtrace__find_symbol / find_code), not grep/rg/sed
// /awk/cat/head/tail/less. This guard denies ONLY the narrow, high-confidence
// shape of a text search/read whose target is an INDEXED SOURCE FILE —
// everything else (prose/config, non-indexed dirs, output-searching, VCS
// history search) passes through untouched.
//
// Precision guards (fixed false positives, all narrowing — never widening):
//   - A path operand only counts as "indexed" when it resolves inside the
//     CURRENT `git rev-parse --show-toplevel` and is not under any OS temp
//     dir ($TMPDIR/os.tmpdir()/tmp/private/tmp/var/folders). Non-repo or
//     throwaway `mktemp -d` fixtures never fire, regardless of extension.
//   - grep/rg's `--include`/`--exclude`/`--include-dir`/`--exclude-dir`
//     take a glob VALUE that filters scope — it is never a path operand.
//   - `node`/`python`/`bash`/`npm`/etc. EXECUTING a script (its first
//     non-flag argument) is not a text search — that argument is exempt
//     from path-operand detection even if it has a source extension.
//   - FP4 (1.3.0): GIT_PREFIX_RE only matched a command whose literal FIRST
//     characters were `git`, so a routine leading `cd <dir>` line before an
//     otherwise all-git script defeated the VCS exemption entirely — and the
//     bare word "cat" inside that script's own `git commit -m "$(cat <<'EOF'
//     ...)"` heredoc (this repo's mandated safe idiom for a multi-line commit
//     message) then tripped SEARCH_BIN_RE as if it were a real search of
//     whatever indexed source file the same script happened to `git add`
//     earlier. A leading `cd <path>` (chained with `&&`/`;`, or its own line)
//     is now stripped before the GIT_PREFIX_RE re-check ONLY — SEARCH_BIN_RE
//     still scans the untouched original string, so a `cd` before a genuine
//     search is unaffected (see the FP4 guard-rail test case).
//
// Circumvention holes closed in 1.2.0 (both WIDENING — they add denials):
//   - HOLE A (tool-shaped): the guard matched only Grep|Glob|Bash, so the
//     `Read` tool read indexed source files untouched. When Bash was denied,
//     `Read` was a one-step bypass of the identical question. Read is now
//     matched and its `file_path` checked with the same semantics.
//   - HOLE B (location-shaped): FP1 exempts every OS temp dir so throwaway
//     `mktemp -d` fixtures never fire. That also exempted a *clone of the
//     repo under test* placed in a temp dir — clone it to /tmp, then read it
//     freely. A temp path is now still exempt UNLESS it sits in a git repo
//     whose `origin` matches the current repo's `origin`. Fixtures with no
//     git repo, or with an unrelated origin, are unaffected.
//
// Fail-open contract: any unexpected error, unparseable stdin, stdin that
// never closes within the timeout, or a `git rev-parse` failure resolves to
// ALLOW/no-fire. A guard that can wedge every Grep/Glob/Bash call on an
// internal bug is worse than one that occasionally misses a case it should
// have caught.

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const SOURCE_EXTS = [
  'cts', 'mts', 'ts', 'tsx', 'js', 'jsx', 'cjs', 'mjs',
  'py', 'go', 'rs', 'java', 'kt', 'swift', 'rb', 'php', 'cs',
  'c', 'h', 'cc', 'cpp', 'hpp', 'scala', 'dart', 'pl',
];
const SOURCE_EXT_SET = new Set(SOURCE_EXTS);

// ripgrep/rg-style `--type`/`type:` aliases that don't literally spell the
// extension. Best-effort; not exhaustive.
const TYPE_ALIASES = new Map([
  ['typescript', 'ts'],
  ['javascript', 'js'],
  ['python', 'py'],
  ['rust', 'rs'],
  ['golang', 'go'],
  ['ruby', 'rb'],
]);

const NOT_INDEXED_DIRS = new Set([
  'bin', 'node_modules', 'dist', 'out', 'build', 'coverage',
  'vendor', 'target', '.git', 'skills', 'npm', '.memdb', '.memtrace', '.claude',
]);

// 1.5.0: the read surface is much wider than the original grep/cat list.
// Anything that streams a file's bytes to stdout answers the identical
// question `cat` does; 1.4.0 allowed nl/strings/od/xxd/tac/rev/more/cut/
// column/perl on an indexed source file (all measured 2026-09-09).
// `wc` and `find` are deliberately ABSENT: the deny text exempts
// "file-inventory counts", and they must keep passing.
const READ_BIN_WORDS = new Set([
  'grep', 'egrep', 'fgrep', 'rg', 'ag', 'ack',
  'sed', 'awk', 'gawk', 'nawk', 'perl',
  'cat', 'bat', 'head', 'tail', 'tac', 'rev', 'nl',
  'less', 'more', 'most', 'view', 'strings',
  'od', 'xxd', 'hexdump', 'cut', 'column', 'expand', 'unexpand', 'fold', 'pr',
  'tr', 'fmt', 'diff', 'cmp',
]);
// grep-family: the FIRST non-flag operand is the search PATTERN, not a path.
const GREP_FAMILY = new Set(['grep', 'egrep', 'fgrep', 'rg', 'ag', 'ack']);
// sed/awk: the first non-flag operand is the SCRIPT, not a path.
const SCRIPT_FIRST_FAMILY = new Set(['sed', 'awk', 'gawk', 'nawk']);
// Flags that consume a following value which is never a path operand, for
// ANY binary. Keep this list conservative — every entry here is a place a
// real path operand could be skipped by accident.
const VALUE_TAKING_FLAGS = new Set([
  '--include', '--exclude', '--include-dir', '--exclude-dir',
  '-name', '-iname', '-path', '-ipath', '-wholename', '-regex', '-iregex',
]);
// Short flags that take a value ONLY in the grep/rg family. `-t` and `-g`
// mean something else elsewhere (`column -t <file>` takes no value), so
// applying them globally silently skipped a genuine path operand.
const GREP_VALUE_TAKING_FLAGS = new Set([
  '-e', '--regexp', '-f', '--file', '-m', '--max-count',
  '-A', '-B', '-C', '--after-context', '--before-context', '--context',
  '-g', '--glob', '--iglob', '-t', '--type', '--type-not',
]);
// A pattern is already supplied by these, so the first operand is a PATH.
const EXPLICIT_PATTERN_FLAGS = new Set(['-e', '--regexp', '-f', '--file']);
// git subcommands that are FILE-READ surfaces, not history queries. 1.4.0
// exempted all of git, so `git show HEAD:<source>` was a one-token bypass.
const GIT_READ_SUBCOMMANDS = new Set(['show', 'cat-file', 'grep']);
const GIT_PREFIX_RE = /^\s*git(\.exe)?\s/;
// A leading `cd <path>` (optionally chained with `&&`/`;`, or on its own
// line before the real command) is a routine, benign shell habit that must
// not defeat the git-prefix exemption below. Without this, `cd <dir>\ngit
// commit -m "$(cat <<'EOF' ... EOF)"` — a repo-mandated heredoc idiom for
// safely passing a multi-line commit message — was denied: GIT_PREFIX_RE
// only matched a command whose LITERAL first characters were `git`, so the
// leading `cd` line meant the VCS exemption never fired, and the bare word
// "cat" inside the heredoc's own `$(cat <<'EOF' ...)` construction tripped
// SEARCH_BIN_RE as if it were a real search of an indexed source file
// (measured 2026-09-07: `cd <worktree>\ngit add ...\ngit commit -m "$(cat
// <<'EOF' ...)"` denied citing the unrelated test file path as the "path
// operand"). Stripping only a LEADING `cd`, and only when what remains
// still starts with `git`, is narrowing (adds an exemption) rather than
// widening (removes one) — a `cd` that precedes a genuine grep/cat/sed
// search is unaffected, since SEARCH_BIN_RE still scans the full original
// string for that case.
const LEADING_CD_RE = /^\s*cd(\.exe)?\s+(?:"[^"]*"|'[^']*'|\S+)\s*(?:&&|;|\r?\n)\s*/;

function stripLeadingCd(command) {
  const stripped = command.replace(LEADING_CD_RE, '');
  return stripped === command ? command : stripped;
}

// FP3: interpreters/package-managers whose first non-flag argument is a
// script/module being EXECUTED, not a search target.
const INTERPRETER_WORDS = new Set(['node', 'python', 'python3', 'bash', 'sh', 'zsh', 'ruby', 'perl']);
const PKG_MANAGER_WORDS = new Set(['npm', 'npx', 'pnpm', 'yarn']);

// FP2: these grep/rg flags take a glob VALUE that filters scope — it is
// never itself a path operand, whether joined ("--include=*.cts") or
// space-separated ("--include *.cts").
const FLAG_VALUE_FLAGS = new Set(['--include', '--exclude', '--include-dir', '--exclude-dir']);

// FP1: OS temp-dir roots. A path resolving under any of these is a
// throwaway fixture Memtrace structurally cannot have indexed, regardless
// of extension or of the fixture having its own nested git repo.
//
// Roots are realpath-resolved (falling back to the literal value if that
// fails) because callers compare against `abs`, which is itself realpath'd
// via resolveAbsolute(). Without this, macOS's /var -> /private/var symlink
// makes every candidate path resolve to /private/var/folders/... while an
// unresolved '/var/folders' root never matches it, silently defeating the
// temp-dir check (and, downstream, the HOLE B clone check that depends on
// isUnderTempDir firing in the first place).
function tempDirRoots() {
  return [os.tmpdir(), process.env.TMPDIR, '/tmp', '/private/tmp', '/var/folders']
    .filter((p) => typeof p === 'string' && p.length > 0)
    .map((p) => normalizeSlashes(p).replace(/\/+$/, ''))
    .map((p) => {
      try {
        return normalizeSlashes(fs.realpathSync(p)).replace(/\/+$/, '');
      } catch {
        return p;
      }
    });
}

function normalizeSlashes(p) {
  return String(p || '').replace(/\\/g, '/');
}

function stripQuotes(tok) {
  return String(tok || '').replace(/^['"]+|['"]+$/g, '');
}

function baseNameOf(tok) {
  const norm = normalizeSlashes(tok);
  const parts = norm.split('/');
  return parts[parts.length - 1];
}

// `git rev-parse --show-toplevel` run in `cwd`. Returns the realpath of the
// toplevel, or null if git errors, times out, or `cwd` isn't in a repo.
// Fail-closed toward "don't fire" per the guard's overall fail-open contract.
function getRepoToplevel(cwd) {
  try {
    const out = execFileSync(
      'git',
      ['rev-parse', '--show-toplevel'],
      { cwd: cwd || process.cwd(), timeout: 5000, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }
    ).trim();
    if (!out) return null;
    try {
      return fs.realpathSync(out);
    } catch {
      return path.normalize(out);
    }
  } catch {
    return null;
  }
}

function resolveAbsolute(cwd, maybeRelative) {
  try {
    const abs = path.isAbsolute(maybeRelative) ? maybeRelative : path.resolve(cwd || process.cwd(), maybeRelative);
    try {
      return fs.realpathSync(abs);
    } catch {
      return path.normalize(abs);
    }
  } catch {
    return null;
  }
}

function isUnderTempDir(absPath) {
  const norm = normalizeSlashes(absPath);
  return tempDirRoots().some((root) => norm === root || norm.startsWith(`${root}/`));
}

// HOLE B: a temp path is exempt (FP1) UNLESS it is a clone of the very repo
// we are currently in. Compare `remote.origin.url` of the git repo containing
// the path against the current repo's. Memoized per directory; any git
// failure resolves to "not a clone" so the fail-open contract is preserved.
const _originCache = new Map();

function gitOriginOf(dir) {
  if (_originCache.has(dir)) return _originCache.get(dir);
  let origin = null;
  try {
    origin = execFileSync(
      'git',
      ['-C', dir, 'config', '--get', 'remote.origin.url'],
      { timeout: 5000, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }
    ).trim() || null;
  } catch {
    origin = null;
  }
  _originCache.set(dir, origin);
  return origin;
}

function normalizeOrigin(url) {
  if (!url) return null;
  return String(url).trim().toLowerCase().replace(/\.git$/, '').replace(/\/+$/, '');
}

function dirForGit(absPath) {
  try {
    if (fs.statSync(absPath).isDirectory()) return absPath;
  } catch { /* not an existing dir */ }
  return path.dirname(absPath);
}

function isCloneOfCurrentRepo(absPath, toplevel) {
  if (!toplevel) return false;
  const cloneTop = getRepoToplevel(dirForGit(absPath));
  if (!cloneTop) return false;
  const a = normalizeOrigin(gitOriginOf(cloneTop));
  const b = normalizeOrigin(gitOriginOf(toplevel));
  return !!(a && b && a === b);
}

// FP1: a path operand only counts as "targeting an indexed repo" when it
// resolves inside the CURRENT git toplevel and is not under any OS temp
// dir. Throwaway `mktemp -d` fixtures are indexed by nothing, no matter
// what extension the files inside them carry.
function isPlausiblyIndexed(pathLike, cwd, toplevel) {
  if (!toplevel) return false; // no repo here (or git errored) -> can't be indexed
  const abs = resolveAbsolute(cwd, pathLike);
  if (!abs) return false;
  if (isUnderTempDir(abs)) return isCloneOfCurrentRepo(abs, toplevel);
  const normAbs = normalizeSlashes(abs);
  const normTop = normalizeSlashes(toplevel).replace(/\/+$/, '');
  return normAbs === normTop || normAbs.startsWith(`${normTop}/`);
}

// FP3: `node scripts/gen-adr-index.cjs --write` is a generator EXECUTION,
// not a text search — the source-file token is the program being run.
// Returns the raw token that is the script/module argument being executed,
// or null if this command isn't an interpreter/package-manager invocation.
function getExecutedScriptArg(tokens) {
  if (!tokens.length) return null;
  const first = baseNameOf(stripQuotes(tokens[0]));
  const isInterpreter = INTERPRETER_WORDS.has(first);
  const isPkgManager = PKG_MANAGER_WORDS.has(first);
  if (!isInterpreter && !isPkgManager) return null;

  let idx = 1;
  if (isPkgManager) {
    const next = tokens[idx] ? stripQuotes(tokens[idx]) : '';
    if (next === 'run' || next === 'exec' || next === 'x') idx += 1;
  }
  for (; idx < tokens.length; idx += 1) {
    if (tokens[idx].startsWith('-')) continue;
    return tokens[idx];
  }
  return null;
}

function extOf(p) {
  const norm = normalizeSlashes(p);
  const m = norm.match(/\.([A-Za-z0-9]+)$/);
  return m ? m[1].toLowerCase() : '';
}

function hasSourceExt(p) {
  return SOURCE_EXT_SET.has(extOf(p));
}

function isNotIndexedPath(p) {
  const norm = normalizeSlashes(p).replace(/^\.\//, '');
  const segments = norm.split('/').filter(Boolean);
  return segments.some((seg) => NOT_INDEXED_DIRS.has(seg));
}

// 1.5.0: the old `$`-anchored regex could not see inside a brace
// alternation, so `{*.cts,*.h}` — a perfectly ordinary Grep glob — sailed
// past (measured 2026-09-09). Split on brace/comma and test each branch.
function globRestrictsToSource(glob) {
  if (!glob) return false;
  const branches = String(glob).replace(/[{}]/g, ',').split(',')
    .map((s) => s.trim()).filter(Boolean);
  return branches.some((b) => {
    const m = b.match(/\*\.([A-Za-z0-9]+)$/) || b.match(/\.([A-Za-z0-9]+)$/);
    return !!(m && SOURCE_EXT_SET.has(m[1].toLowerCase()));
  });
}

// 1.5.0: a source extension that the SHELL will still resolve to a source
// file, even though the literal token text does not spell one:
//   - `src/a.ct?`  (single-char wildcard)
//   - `src/a.c*`   (star with at least one literal char)
// A bare `.*` is deliberately NOT matched — it also expands to .md/.json and
// treating it as source would be a real false positive. That is a known,
// documented residual hole rather than a silent one.
function hasSourceExtOrSourceGlob(p) {
  if (hasSourceExt(p)) return true;
  const m = normalizeSlashes(p).match(/\.([A-Za-z0-9?*]+)$/);
  if (!m) return false;
  const raw = m[1].toLowerCase();
  if (!/[?*]/.test(raw)) return false;
  if (!/[a-z0-9]/.test(raw)) return false; // bare `.*` / `.?` -> not enough signal
  const re = new RegExp(`^${raw.replace(/\*/g, '[a-z0-9]*').replace(/\?/g, '[a-z0-9]')}$`);
  return SOURCE_EXTS.some((e) => re.test(e));
}

// Normalise ONE candidate operand token to the path the shell would use.
// Every transformation here exists because a measured 1.4.0 bypass relied
// on the untransformed text: embedded quotes (`'a.c''ts'`), trailing shell
// punctuation (`a.cts;` / `a.cts)`), a `file:line` suffix, or a `VAR=`
// assignment prefix all made extOf() return '' and skipped the check.
function normalizeOperand(tok) {
  let t = String(tok || '');
  t = t.replace(/[`'"]/g, '');           // adjacent-quote concatenation
  t = t.replace(/^\$\(+|^\(+|^\{+/, ''); // $( / ( / { openers
  t = t.replace(/[)\]};,&|<>]+$/, '');   // closers + shell separators
  t = t.replace(/:\d+(?::\d+)?$/, '');   // file:line[:col]
  return t;
}

function typeRestrictsToSource(type) {
  if (!type) return false;
  const t = String(type).toLowerCase();
  const resolved = TYPE_ALIASES.get(t) || t;
  return SOURCE_EXT_SET.has(resolved);
}

// Returns a short "reason fragment" string if the Grep/Glob call should be
// denied, or null to allow.
function checkGrepGlob(input, cwd, toplevel, tool) {
  const pathVal = typeof input.path === 'string' ? input.path : '';
  // HOLE C (1.5.0): the Glob TOOL carries its glob in `pattern`, not `glob`.
  // The hook matched Glob but only ever read `glob`/`path`, so
  // Glob(pattern:"**/*.swift") — an exhaustive source-file listing — was
  // never checked at all. The Grep tool's `pattern` is a REGEX and must NOT
  // be read this way, hence the explicit tool discrimination.
  const globVal = typeof input.glob === 'string' && input.glob
    ? input.glob
    : (tool === 'Glob' && typeof input.pattern === 'string' ? input.pattern : '');
  const typeVal = typeof input.type === 'string' ? input.type : '';

  if (pathVal && isNotIndexedPath(pathVal)) return null; // Memtrace structurally can't serve it

  // FP1: not resolvable to somewhere inside the current repo's git
  // toplevel (or resolves under an OS temp dir) -> not indexed, don't fire.
  if (!isPlausiblyIndexed(pathVal || '.', cwd, toplevel)) return null;

  if (globVal && globRestrictsToSource(globVal)) {
    return `glob "${globVal}" restricts the search to an indexed source language`;
  }
  if (typeVal && typeRestrictsToSource(typeVal)) {
    return `type "${typeVal}" restricts the search to an indexed source language`;
  }
  if (pathVal && hasSourceExt(pathVal)) {
    return `target path "${pathVal}" is an indexed source file`;
  }
  return null;
}

// HOLE A: the Read tool asks the same question as `cat` / `sed -n '1,50p'`
// and must answer to the same rule. Read's input is a single `file_path`.
function checkRead(input, cwd, toplevel) {
  const fp = typeof input.file_path === 'string' ? input.file_path : '';
  if (!fp) return null;
  if (isNotIndexedPath(fp)) return null;
  if (!hasSourceExt(fp)) return null;
  if (!isPlausiblyIndexed(fp, cwd, toplevel)) return null;
  return `target path "${fp}" is an indexed source file`;
}

// The denial text advertises "re-reading a span Memtrace already returned"
// as exempt, but until now nothing in this file actually checked that --
// checkRead/checkBash were pure structural checks with no transcript
// awareness. This closes that gap: if a mcp__memtrace__* tool call appears
// anywhere in the transcript whose recorded tool_use input OR tool_result
// content references the same basename as the file being read, the guard
// treats Memtrace as already consulted for this file and allows the
// Read/Bash through. Fails closed toward "not found" (i.e. still deny) on
// any read/parse error, matching this file's fail-open-on-infra-error
// posture applied narrowly (a transcript read failure here just means this
// specific carve-out doesn't apply -- the original structural denial still
// fires, which is the safe default).
function wasMemtraceConsultedForPath(transcriptPath, absPath) {
  if (!transcriptPath || !absPath) return false;
  const needle = baseNameOf(absPath).toLowerCase();
  if (!needle) return false;
  let lines;
  try {
    lines = fs.readFileSync(transcriptPath, 'utf8').split('\n');
  } catch {
    return false;
  }
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = lines[i];
    if (!line || !line.includes('mcp__memtrace__')) continue;
    let d;
    try {
      d = JSON.parse(line);
    } catch {
      continue;
    }
    const content = d && d.message && d.message.content;
    if (!Array.isArray(content)) continue;
    for (const block of content) {
      if (!block || typeof block !== 'object') continue;
      if (block.type === 'tool_use' && String(block.name || '').startsWith('mcp__memtrace__')) {
        const inputStr = JSON.stringify(block.input || {}).toLowerCase();
        if (inputStr.includes(needle)) return true;
      }
      if (block.type === 'tool_result') {
        const resultStr = JSON.stringify(block.content || '').toLowerCase();
        if (resultStr.includes(needle)) return true;
      }
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// 1.5.0 OPERAND EXTRACTION.  *** READ THIS SECTION LINE BY LINE. ***
//
// This is the one place where a quiet loosening would hide: everything the
// guard denies flows through extractPathOperands(). 1.4.0 decided per
// COMMAND (does any read-binary word appear anywhere? then treat every
// whitespace token that ends in a source extension as a path operand),
// which produced both halves of the guard's failure mode:
//
//   * FALSE POSITIVES — a source filename mentioned in a heredoc body, a
//     `#` comment, a quoted grep PATTERN, or a `find -name` value was cited
//     as the "path operand" of an unrelated `cat`/`head` elsewhere in the
//     same command. Measured 2026-09-09; five separate shapes.
//   * FALSE NEGATIVES — trailing shell punctuation, adjacent-quote
//     concatenation, and a glob character in the extension all made the
//     extension test return '' and the check was skipped entirely.
//
// 1.5.0 decides per CLAUSE: split the command on shell separators, look at
// each clause's own binary, and derive operands using that binary's actual
// argument grammar. A `cat` in clause 3 can no longer lend its read-ness to
// a filename that appears in clause 1.
// ---------------------------------------------------------------------------

// Remove heredoc BODIES. A heredoc body is data being written, never a set
// of path operands — the shape that blocked the authoring of this hook's own
// regression test.
function stripHeredocBodies(command) {
  const lines = String(command).split('\n');
  const out = [];
  let tag = null;
  for (const line of lines) {
    if (tag !== null) {
      if (line.trim() === tag) tag = null;
      continue; // drop the body line either way
    }
    const m = line.match(/<<-?\s*(['"]?)([A-Za-z_][A-Za-z0-9_]*)\1/);
    out.push(line);
    if (m) tag = m[2];
  }
  return out.join('\n');
}

// Remove `#` comments. Only a `#` that STARTS a token counts, so a quoted
// pattern like grep '#define' is untouched.
function stripComments(command) {
  return String(command).split('\n')
    .map((line) => line.replace(/(^|\s)#[^\n]*$/, '$1'))
    .join('\n');
}

// 1.5.1 / P1 (R1): 1.5.0's clauseBinary() returned the clause's FIRST
// non-flag token as the binary, so any wrapper prefix hid the real one:
// `env|nice|sudo|time|command|exec|eval|nohup|timeout|stdbuf|xargs|watch ...
// cat <src>` all ALLOWed (measured 2026-09-10 against 1.5.0; real 1.4.0
// DENIED every one). These words are transparent — they run the NEXT word.
const WRAPPER_WORDS = new Set([
  'env', 'nice', 'sudo', 'doas', 'time', 'command', 'builtin', 'exec', 'eval',
  'nohup', 'timeout', 'stdbuf', 'setsid', 'caffeinate', 'arch', 'script',
  'watch', 'xargs', 'ionice', 'chrt', 'nohup',
]);
// A bare duration/count argument belonging to a wrapper we just skipped
// (`timeout 5 cat <src>`, `watch 2 cat <src>`). Only consulted AFTER a
// wrapper word has been seen, so a real binary is never mistaken for one.
const WRAPPER_ARG_RE = /^\d+(?:\.\d+)?[smhd]?$/;
// Wrapper flags that take a SEPARATE value word (`sudo -u nobody cat <src>`
// still ALLOWed with WRAPPER_WORDS alone, measured 2026-09-10). Consulted
// ONLY while still scanning for the real binary, i.e. only after a wrapper
// word has been seen -- a genuine path operand cannot legally appear there,
// so this can never skip one.
const WRAPPER_VALUE_FLAGS = new Set([
  '-u', '-n', '-I', '-P', '-d', '-c', '-s', '-g', '-C', '-p',
  '--user', '--chdir', '--unset', '--max-procs', '--replace', '--delimiter',
  '--signal', '--adjustment', '--kill-after', '--class', '--priority',
]);

const CLAUSE_SPLIT_RE = /\|\||&&|[|;\n]/;

// Does this clause's own binary read file bytes?
function clauseBinary(tokens) {
  let sawWrapper = false;
  let pendingValue = false;
  for (const raw of tokens) {
    const t = normalizeOperand(raw);
    if (!t) continue;
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(t)) continue; // leading VAR= assignment
    if (t.startsWith('-')) {
      pendingValue = sawWrapper && WRAPPER_VALUE_FLAGS.has(stripQuotes(raw));
      continue;
    }
    if (pendingValue) { pendingValue = false; continue; }         // `sudo -u nobody ...`
    const base = baseNameOf(t).toLowerCase();
    if (WRAPPER_WORDS.has(base)) { sawWrapper = true; continue; } // P1: see through it
    if (sawWrapper && WRAPPER_ARG_RE.test(t)) continue;           // `timeout 5 ...`
    return base;
  }
  return '';
}

// Operands of ONE clause, given its binary's argument grammar.
function clauseOperands(tokens, bin) {
  const ops = [];
  const grep = GREP_FAMILY.has(bin);
  const skipNext = new Set();
  tokens.forEach((raw, i) => {
    const f = stripQuotes(raw);
    if (VALUE_TAKING_FLAGS.has(f) || (grep && GREP_VALUE_TAKING_FLAGS.has(f))) skipNext.add(i + 1);
  });

  const scriptFirst = SCRIPT_FIRST_FAMILY.has(bin);
  const hasExplicitPattern = tokens.some((t) => EXPLICIT_PATTERN_FLAGS.has(stripQuotes(t)));
  // grep/sed/awk consume one leading non-flag operand that is NOT a path.
  let toConsume = ((grep && !hasExplicitPattern) || scriptFirst) ? 1 : 0;

  let seenBinary = false;
  let sawWrapper = false;
  let pendingValue = false;
  for (let i = 0; i < tokens.length; i += 1) {
    const raw = tokens[i];
    if (skipNext.has(i)) continue;
    if (raw.startsWith('-')) {
      pendingValue = !seenBinary && sawWrapper && WRAPPER_VALUE_FLAGS.has(stripQuotes(raw));
      continue;
    }
    const t = normalizeOperand(raw);
    if (!seenBinary && pendingValue) { pendingValue = false; continue; }
    if (!seenBinary) {
      // P1: the binary-position scan must skip exactly what clauseBinary()
      // skips, or the PATTERN/SCRIPT slot below is counted off by one.
      if (!t) continue;
      if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(t)) continue; // env VAR= prefix
      const base = baseNameOf(t).toLowerCase();
      if (WRAPPER_WORDS.has(base)) { sawWrapper = true; continue; }
      if (sawWrapper && WRAPPER_ARG_RE.test(t)) continue;
      seenBinary = true;
      continue; // the binary itself
    }
    // P2 (R2): the PATTERN/SCRIPT slot must be consumed by ANY non-flag
    // token, including one normalizeOperand() empties. 1.5.0 tested `!t`
    // FIRST, so `grep '' <src>` skipped the empty pattern without
    // decrementing and the FILE fell into the pattern slot -- a
    // two-character bypass of the guard's most central case (measured
    // 2026-09-10: ALLOW on 1.5.0, DENY on real 1.4.0).
    if (toConsume > 0) { toConsume -= 1; continue; } // the PATTERN / SCRIPT
    if (!t) continue;
    ops.push(t);
  }
  return ops;
}

// git: history queries stay exempt; the three read subcommands do not.
function gitClauseOperands(tokens) {
  let sub = '';
  let subIdx = -1;
  for (let i = 1; i < tokens.length; i += 1) {
    const t = normalizeOperand(tokens[i]);
    if (!t) continue;
    // P3 (B1): 1.5.0 tested startsWith('-') BEFORE this, so the `-C` branch
    // was unreachable and `git -C . show HEAD:<src>` read `.` as the
    // subcommand -> not in GIT_READ_SUBCOMMANDS -> ALLOW, silently defeating
    // 1.5.0's own headline git fix (measured 2026-09-10).
    if (t === '-C' || t === '--git-dir' || t === '--work-tree' || t === '--namespace') { i += 1; continue; }
    if (t.startsWith('-')) continue;
    sub = t.toLowerCase();
    subIdx = i;
    break;
  }
  if (!GIT_READ_SUBCOMMANDS.has(sub)) return [];
  const ops = [];
  for (let i = subIdx + 1; i < tokens.length; i += 1) {
    const raw = tokens[i];
    if (raw.startsWith('-') && raw !== '--') continue;
    const t = normalizeOperand(raw);
    if (!t || t === '--') continue;
    // `git show HEAD:path/to/file` — the path is after the first colon.
    ops.push(t.includes(':') ? t.slice(t.indexOf(':') + 1) : t);
  }
  return ops;
}

// `find` is file INVENTORY, which the deny text explicitly exempts — unless
// it hands each hit to a read binary via -exec.
function findClauseOperands(tokens) {
  const execIdx = tokens.findIndex((t) => stripQuotes(t) === '-exec' || stripQuotes(t) === '-execdir');
  if (execIdx === -1) return [];
  const execBin = baseNameOf(normalizeOperand(tokens[execIdx + 1] || '')).toLowerCase();
  if (!READ_BIN_WORDS.has(execBin)) return [];
  // The -name/-path value is what selects the files being dumped.
  const ops = [];
  tokens.forEach((raw, i) => {
    if (VALUE_TAKING_FLAGS.has(stripQuotes(raw))) {
      const v = normalizeOperand(tokens[i + 1] || '');
      if (v) ops.push(v);
    }
  });
  return ops;
}

// P4 (R3), NARROWED TO INPUT REDIRECTS. `< <src> cat` and `cat<<src>` both
// ALLOWed on 1.5.0 and DENIED on real 1.4.0 (measured 2026-09-10): the `<`
// glued to the token made baseNameOf() return the FILENAME as the binary.
// Splitting `<` and its target out of the token stream restores both.
//
// OUTPUT redirects (`>`, `>>`, `2>&1`) are stripped out of the token stream
// entirely (and never contribute a read operand): this is a READ guard, and
// `cat > out.cjs` / `node gen.cjs > out.swift` are writes. Left un-stripped,
// a read-binary clause like `cat > out.cjs` would have its `>` target
// collected by clauseOperands() as if it were a file being read — a pure
// false positive (measured 2026-09-12, `cat > .tmp-redirect-probe.cjs`
// wrongly DENIED). We handle: standalone operator + target (`>` `x`, `>>` `x`,
// `>|` `x`, `1>` `x`, `2>` `x`, `&>` `x`, `>&` `x`), glued operator+target
// (`>x`, `>>x`, `2>x`, `&>x`, `1>x`), and bare fd duplication with no file at
// all (`2>&1`, `>&2`), which is simply dropped.
const OUTPUT_REDIR_OP_RE = /^(?:[0-9]*>>?\|?|&>>?|>&)$/;
const OUTPUT_REDIR_GLUED_RE = /^([0-9]*(?:>>?\|?|&>>?))(.+)$/;
const OUTPUT_REDIR_FDDUP_RE = /^[0-9]*>&[0-9]+$/;

function splitInputRedirects(tokens) {
  const kept = [];
  const redirIn = [];
  for (let i = 0; i < tokens.length; i += 1) {
    const t = tokens[i];
    if (t.includes('<<')) { kept.push(t); continue; } // heredoc marker, not a file
    if (t === '<') {
      const v = tokens[i + 1];
      if (v) { redirIn.push(v); i += 1; }
      continue;
    }
    const m = t.match(/^([^<]*)<(.+)$/);
    if (m) {
      if (m[1]) kept.push(m[1]);
      redirIn.push(m[2]);
      continue;
    }
    // fd duplication with no filename target at all (`2>&1`, `>&2`): drop
    // the token outright, nothing follows it to consume.
    if (OUTPUT_REDIR_FDDUP_RE.test(t)) continue;
    // standalone output-redirect operator (`>`, `>>`, `1>`, `2>`, `&>`, `>&`,
    // `>|`) followed by its target token: drop both.
    if (OUTPUT_REDIR_OP_RE.test(t)) {
      if (tokens[i + 1]) i += 1;
      continue;
    }
    // glued operator+target (`>x`, `>>x`, `2>x`, `&>x`, `1>x`): drop the
    // whole token, since the "operand" is only the redirect target.
    const gm = t.match(OUTPUT_REDIR_GLUED_RE);
    if (gm && gm[2]) continue;
    kept.push(t);
  }
  return { kept, redirIn };
}

// THE function. Returns every token this command would actually hand to a
// file-reading binary as a path.
function extractPathOperands(command) {
  const cleaned = stripComments(stripHeredocBodies(stripLeadingCd(command)));
  const clauses = cleaned.split(CLAUSE_SPLIT_RE);
  const operands = [];
  let sawReadClause = false;

  for (const clause of clauses) {
    const rawTokens = clause.trim().split(/\s+/).filter(Boolean);
    if (!rawTokens.length) continue;
    const { kept: tokens, redirIn } = splitInputRedirects(rawTokens);
    if (!tokens.length) continue;
    const bin = clauseBinary(tokens);
    if (!bin) continue;

    if (bin === 'git') { operands.push(...gitClauseOperands(tokens)); continue; }
    if (bin === 'find') { operands.push(...findClauseOperands(tokens)); continue; }

    // FP3/FP5: an interpreter/pkg-manager EXECUTING a script is not a read.
    const scriptArg = getExecutedScriptArg(tokens);
    if (!READ_BIN_WORDS.has(bin)) continue;
    sawReadClause = true;
    for (const r of redirIn) {
      const rt = normalizeOperand(r);
      if (rt) operands.push(rt); // P4: `cat < <src>` reads <src>
    }
    for (const op of clauseOperands(tokens, bin)) {
      if (scriptArg && op === normalizeOperand(scriptArg)) continue;
      operands.push(op);
    }
  }

  // `F=<path>` followed by `cat "$F"`. The assignment value only counts as an
  // operand when the command actually contains a read clause, so a plain
  // `SRC=src/a.cts npm run build` stays untouched.
  if (sawReadClause) {
    const assignRe = /(?:^|[\s;&|(])([A-Za-z_][A-Za-z0-9_]*)=([^\s;&|)]+)/g;
    let m;
    while ((m = assignRe.exec(cleaned)) !== null) operands.push(normalizeOperand(m[2]));
  }
  return operands;
}

function checkBash(command, cwd, toplevel) {
  if (typeof command !== 'string' || !command.trim()) return null;
  for (const op of extractPathOperands(command)) {
    if (!op) continue;
    if (!hasSourceExtOrSourceGlob(op)) continue;
    if (isNotIndexedPath(op)) continue;
    if (!isPlausiblyIndexed(op, cwd, toplevel)) continue;
    return `path operand "${op}" is an indexed source file`;
  }
  return null;
}

function readStdin(timeoutMs) {
  return new Promise((resolve) => {
    let data = '';
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };
    const timer = setTimeout(() => finish(null), timeoutMs);
    if (typeof timer.unref === 'function') timer.unref();
    try {
      process.stdin.setEncoding('utf8');
      process.stdin.on('data', (chunk) => { data += chunk; });
      process.stdin.on('end', () => { clearTimeout(timer); finish(data); });
      process.stdin.on('error', () => { clearTimeout(timer); finish(null); });
      process.stdin.resume();
    } catch {
      clearTimeout(timer);
      finish(null);
    }
  });
}

// ---------------------------------------------------------------------------
// 1.5.0 DETECTION LAYER.
//
// Prevention is not fully reachable against an agent that authors its own
// command text: the guard is a ROUTING preference, not an access boundary
// (everything it blocks is obtainable via mcp__memtrace__get_source_window,
// which the deny text itself prescribes). So the second line of defence is
// an audit trail the human can read after the fact.
//
// The specific shape worth catching is the one that actually happened:
// a command is DENIED, the model deletes the offending fragment, and re-runs
// a near-identical command that is ALLOWED. That is invisible in the
// transcript unless something correlates the two.
//
// Cost budget: one bounded read + one bounded append per matched tool call.
// The ring file is capped at RING_MAX entries so it never grows.
// Disable with GSD_MEMTRACE_GUARD_LOG=0.
// ---------------------------------------------------------------------------
const LOG_DIR = path.join(os.homedir(), '.claude', 'logs');
const LOG_FILE = path.join(LOG_DIR, 'gsd-memtrace-guard.jsonl');
const RING_FILE = path.join(LOG_DIR, '.gsd-memtrace-recent-denies.json');
const RING_MAX = 40;
const EVASION_WINDOW_MS = 15 * 60 * 1000;
const EVASION_SIMILARITY = 0.75;
// Fraction of the ALLOWED command's words that already appeared in the
// DENIED one. 1.0 means "the new command adds nothing new" — the signature
// of deleting the offending fragment and re-running.
const EVASION_CONTAINMENT = 0.9;

function loggingEnabled() {
  return process.env.GSD_MEMTRACE_GUARD_LOG !== '0';
}

// Order-insensitive bag of meaningful words. Deleting one fragment from an
// otherwise identical command leaves similarity very high; writing a
// genuinely different command does not.
function commandSignature(tool, input) {
  const text = tool === 'Bash'
    ? String(input.command || '')
    : JSON.stringify(input || {});
  const words = String(text).toLowerCase().match(/[a-z0-9_.\-/]{3,}/g) || [];
  return Array.from(new Set(words));
}

function jaccard(a, b) {
  if (!a.length || !b.length) return 0;
  const sb = new Set(b);
  let inter = 0;
  for (const x of a) if (sb.has(x)) inter += 1;
  return inter / (a.length + b.length - inter);
}

// P6: the audit trail is append-only and had no bound. Rotate at 5 MB,
// keeping exactly one previous generation. Any failure here is swallowed --
// logging must never affect the decision.
const LOG_MAX_BYTES = 5 * 1024 * 1024;

function appendLog(record) {
  try {
    fs.mkdirSync(LOG_DIR, { recursive: true });
    try {
      if (fs.statSync(LOG_FILE).size > LOG_MAX_BYTES) {
        fs.renameSync(LOG_FILE, `${LOG_FILE}.1`);
      }
    } catch { /* no log yet, or rename raced another process */ }
    fs.appendFileSync(LOG_FILE, `${JSON.stringify(record)}\n`);
  } catch { /* logging must never affect the decision */ }
}

function readRing() {
  try {
    const parsed = JSON.parse(fs.readFileSync(RING_FILE, 'utf8'));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function pushRing(entry) {
  try {
    fs.mkdirSync(LOG_DIR, { recursive: true });
    const ring = readRing();
    ring.push(entry);
    fs.writeFileSync(RING_FILE, JSON.stringify(ring.slice(-RING_MAX)));
  } catch { /* ignore */ }
}

// Called on a DENY.
function recordDeny(ctx, reasonFragment) {
  if (!loggingEnabled()) return;
  const sig = commandSignature(ctx.tool, ctx.input);
  appendLog({
    ts: new Date().toISOString(),
    event: 'deny',
    session: ctx.session,
    tool: ctx.tool,
    cwd: ctx.cwd,
    reason: reasonFragment,
    command: ctx.tool === 'Bash' ? String(ctx.input.command || '').slice(0, 2000) : ctx.input,
  });
  pushRing({ ts: Date.now(), session: ctx.session, tool: ctx.tool, sig, reason: reasonFragment });
}

// Called on an ALLOW. Flags "blocked command followed by a near-identical
// command with the trigger removed" WITHOUT blocking it — this layer is
// evidence for the human, not a second gate that could wedge the session.
function detectEvasion(ctx) {
  if (!loggingEnabled()) return;
  const ring = readRing();
  if (!ring.length) return;
  const now = Date.now();
  const sig = commandSignature(ctx.tool, ctx.input);
  if (sig.length < 3) return; // too little signal to judge
  let best = null;
  for (const prev of ring) {
    if (!prev || !Array.isArray(prev.sig)) continue;
    if (now - (prev.ts || 0) > EVASION_WINDOW_MS) continue;
    if (prev.session && ctx.session && prev.session !== ctx.session) continue;
    // Two shapes count:
    //   jaccard    — the command was REWORDED into something equivalent.
    //   containment— the new command is (nearly) the denied one with the
    //                offending fragment DELETED, i.e. allowed ⊆ denied.
    //                This is the exact shape of the confirmed evasion:
    //                delete the trigger, re-run, sail through.
    const prevSet = new Set(prev.sig);
    let inter = 0;
    for (const w of sig) if (prevSet.has(w)) inter += 1;
    const containment = inter / sig.length;
    const score = Math.max(jaccard(sig, prev.sig), containment >= EVASION_CONTAINMENT ? containment : 0);
    if (!best || score > best.score) best = { score, prev, containment };
  }
  if (!best || best.score < EVASION_SIMILARITY) return;
  appendLog({
    ts: new Date().toISOString(),
    event: 'evasion_suspected',
    session: ctx.session,
    similarity: Number(best.score.toFixed(3)),
    seconds_after_deny: Math.round((now - best.prev.ts) / 1000),
    denied_reason: best.prev.reason,
    denied_tool: best.prev.tool,
    allowed_tool: ctx.tool,
    allowed_command: ctx.tool === 'Bash' ? String(ctx.input.command || '').slice(0, 2000) : ctx.input,
    dropped_terms: best.prev.sig.filter((w) => !sig.includes(w)).slice(0, 25),
  });
}

function allowOutput() {
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: { hookEventName: 'PreToolUse' },
  }));
}

function denyOutput(reasonFragment, toolLabel) {
  let reason =
    'DO NOT REPHRASE THIS COMMAND TO GET PAST THIS GUARD.\n' +
    'Changing the glob, switching to a directory scan, splitting the path, or using a\n' +
    'different tool to ask the same question is circumvention, not problem-solving. If\n' +
    'this guard is firing wrongly, SAY SO TO THE USER and stop — do not route around it.\n\n' +
    `MEMTRACE-FIRST: ${toolLabel} is targeting an indexed source file (${reasonFragment}). ` +
    'Use Memtrace instead: mcp__memtrace__find_symbol (exact symbol -> file:start:end), ' +
    'find_code (NL/concept search), get_source_window (bounded span read), ' +
    'get_symbol_context / get_impact (callers, blast radius). ' +
    'NO mcp__memtrace__* TOOLS? Restricted subagents (gsd-*, and any agent whose `tools:` \n' +
    'frontmatter omits the MCP server) reach the SAME graph over Bash via the `mt` CLI: \n' +
    '  mt find_symbol \'{\"name\":\"Foo\",\"repo_id\":\"bar\"}\'\n' +
    '  mt find_code   \'{\"query\":\"concept\",\"repo_id\":\"bar\",\"limit\":5}\'\n' +
    '  mt get_source_window \'{\"file_path\":\"a/b.ts\",\"start_line\":10,\"end_line\":40}\'\n' +
    '`mt tools` lists every tool. Identical server, no tool grant needed. This is the \n' +
    'prescribed route for a restricted agent — NOT a reason to fall back to grep. ' +
    'CAVEAT: in a git worktree, brand-new symbols live in an overlay. ONLY find_code takes a ' +
    '`worktree` param — find_symbol / get_symbol_context / get_impact do NOT, so a miss from ' +
    'those is not proof of absence; re-ask find_code({repo_id, query, worktree}). ' +
    'NOT blocked: prose/config .md/.json/.yml/.toml, file-inventory counts, anything under ' +
    'bin/ or other non-indexed dirs, and re-reading a span Memtrace already returned. ' +
    'Human escape: GSD_MEMTRACE_GUARD_OFF=1 must be exported in the shell that launches ' +
    'Claude Code. An inline command prefix does NOT work and is not self-issuable - this ' +
    'hook runs as its own process, so the pending command text is not in its environment.';
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: reason,
    },
  }));
}

async function main() {
  if (process.env.GSD_MEMTRACE_GUARD_OFF === '1') return allowOutput();

  const raw = await readStdin(4000);
  if (!raw || !raw.trim()) return allowOutput();

  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    return allowOutput();
  }
  if (!payload || typeof payload !== 'object') return allowOutput();

  const tool = payload.tool_name;
  const input = (payload.tool_input && typeof payload.tool_input === 'object') ? payload.tool_input : {};

  if (tool !== 'Grep' && tool !== 'Glob' && tool !== 'Bash' && tool !== 'Read') return allowOutput();

  const cwd = typeof payload.cwd === 'string' && payload.cwd ? payload.cwd : process.cwd();
  const toplevel = getRepoToplevel(cwd);

  let reason = null;
  if (tool === 'Grep' || tool === 'Glob') {
    reason = checkGrepGlob(input, cwd, toplevel, tool);
  } else if (tool === 'Read') {
    reason = checkRead(input, cwd, toplevel);
    if (reason) {
      const fp = typeof input.file_path === 'string' ? input.file_path : '';
      const abs = resolveAbsolute(cwd, fp);
      const transcriptPath = typeof payload.transcript_path === 'string' ? payload.transcript_path : '';
      if (abs && wasMemtraceConsultedForPath(transcriptPath, abs)) reason = null;
    }
  } else {
    reason = checkBash(input.command, cwd, toplevel);
  }

  const ctx = {
    tool,
    input,
    cwd,
    session: typeof payload.session_id === 'string' ? payload.session_id : '',
  };
  if (reason) {
    try { recordDeny(ctx, reason); } catch { /* never affect the decision */ }
    return denyOutput(reason, tool);
  }
  try { detectEvasion(ctx); } catch { /* never affect the decision */ }
  return allowOutput();
}

main()
  .catch(() => { try { allowOutput(); } catch { /* ignore */ } })
  .finally(() => process.exit(0));
