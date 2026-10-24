#!/usr/bin/env node
'use strict';

/**
 * zsh-guard.cjs — PreToolUse(Bash) guard for zsh/macOS-invalid command shapes.
 *
 * This machine is a Mac whose Bash tool runs commands under zsh 5.9, with BSD
 * userland. Habits carried over from bash/Linux are silently or loudly wrong
 * here, and each one has cost real retries. The guard does two things:
 *
 *   AUTO-FIX  (command is rewritten and allowed; no retry): an unquoted glob in
 *             a literal-pattern flag (`--include=*.md`, `-name *.md`). The fix
 *             is unambiguous (quote the value), so it is applied via
 *             `updatedInput` instead of denying.
 *   DENY      (command is blocked with the corrected form named): everything
 *             whose fix needs a decision.
 *
 * Rules:
 *   1. for x in $VAR            zsh does not word-split; runs once.
 *   2. flag glob                auto-quoted (see above).
 *   3. NOMATCH on a file arg    an unquoted glob that matches nothing aborts the
 *                               WHOLE command line in zsh ("no matches found"),
 *                               e.g. `rm -rf "$T"/archive-*` when nothing
 *                               matches. Literal globs are resolved against the
 *                               payload cwd; `rm`/`mv` with a variable-prefixed
 *                               glob cannot be resolved and are denied.
 *   4. /usr/bin/<x>             cat/echo/ps/... live in /bin on macOS.
 *   5. bash-only constructs     BASH_REMATCH, declare -A, mapfile, ${v,,},
 *                               ${!v}, shopt, read -a, BASH_SOURCE.
 *   6. GNU-only userland        sed -i without a suffix arg, grep -P, date -d,
 *                               timeout, xargs -r, stat -c, head -n -N, tac,
 *                               readlink -f is fine on macOS >= 12.3.
 *
 * Heredoc bodies and quoted spans are never inspected. Fails OPEN on any
 * internal error so a hook bug never wedges every Bash call.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const BIN_NOT_USRBIN = [
  'cat', 'echo', 'ps', 'kill', 'sleep', 'test', 'pwd', 'ln', 'mv', 'rm', 'cp',
  'df', 'date', 'stty', 'sync', 'ls', 'mkdir', 'chmod',
];

// Commands whose positional args are paths: an unmatched unquoted glob there
// aborts the command line under zsh NOMATCH.
const FILE_ARG_CMDS = new Set([
  'rm', 'ls', 'cat', 'mv', 'cp', 'du', 'stat', 'wc', 'head', 'tail', 'chmod',
  'open', 'file', 'less', 'diff', 'ln', 'touch', 'tar', 'zip',
]);
const DESTRUCTIVE_CMDS = new Set(['rm', 'mv']);

/** Blank heredoc bodies (same length) so their text is never analysed. */
function blankHeredocs(cmd) {
  const lines = cmd.split('\n');
  const out = [];
  let tag = null;
  let strip = false;
  for (const line of lines) {
    if (tag !== null) {
      const probe = strip ? line.replace(/^\t+/, '') : line;
      if (probe.trim() === tag) { tag = null; out.push(line); } else { out.push(' '.repeat(line.length)); }
      continue;
    }
    out.push(line);
    const m = /<<(-?)\s*(?:'([^']+)'|"([^"]+)"|\\?([A-Za-z_][\w]*))/.exec(line);
    if (m) { strip = m[1] === '-'; tag = m[2] || m[3] || m[4]; }
  }
  return out.join('\n');
}

/** Replace quoted runs with same-length filler so offsets stay comparable. */
function unquotedOnly(cmd) {
  return cmd.replace(/'[^']*'|"(?:\\.|[^"\\])*"/g, (m) => ' '.repeat(m.length));
}

/**
 * Split into clauses and tokens, quote-aware. Each token records whether it
 * holds an unquoted glob char and whether it references a variable/substitution.
 */
function clausesOf(cmd) {
  const clauses = [];
  let toks = [];
  let cur = null;
  const flushTok = () => { if (cur) { toks.push(cur); cur = null; } };
  const flushClause = () => { flushTok(); if (toks.length) clauses.push(toks); toks = []; };
  const start = (i) => { if (!cur) cur = { text: '', glob: false, hasVar: false, nullGlob: false, start: i, end: i }; return cur; };
  let inS = false;
  let inD = false;
  for (let i = 0; i < cmd.length; i++) {
    const c = cmd[i];
    if (inS) { cur.text += c; cur.end = i + 1; if (c === "'") inS = false; continue; }
    if (inD) {
      cur.text += c; cur.end = i + 1;
      if (c === '\\') { cur.text += cmd[i + 1] || ''; i++; cur.end = i + 1; continue; }
      if (c === '$') cur.hasVar = true;
      if (c === '"') inD = false;
      continue;
    }
    if (c === "'") { start(i).text += c; cur.end = i + 1; inS = true; continue; }
    if (c === '"') { start(i).text += c; cur.end = i + 1; inD = true; continue; }
    if (c === '\\') { start(i).text += c + (cmd[i + 1] || ''); i++; cur.end = i + 1; continue; }
    if (c === '$') {
      start(i); cur.hasVar = true;
      if (cmd[i + 1] === '(' || cmd[i + 1] === '{') {
        const open = cmd[i + 1];
        const close = open === '(' ? ')' : '}';
        let depth = 1;
        let j = i + 2;
        while (j < cmd.length && depth > 0) {
          if (cmd[j] === open) depth++;
          else if (cmd[j] === close) depth--;
          j++;
        }
        cur.text += cmd.slice(i, j); i = j - 1; cur.end = j;
        continue;
      }
      cur.text += c; cur.end = i + 1;
      continue;
    }
    if (c === '\n' || c === ';' || c === '|' || c === '&') {
      flushClause();
      continue;
    }
    if (/\s/.test(c)) { flushTok(); continue; }
    if (c === '(' || c === ')') {
      // `(N)`-style glob qualifier glued to a glob token is part of the token.
      if (c === '(' && cur && cur.glob) {
        const m = /^\(N[A-Za-z.^-]*\)/.exec(cmd.slice(i));
        if (m) { cur.text += m[0]; cur.nullGlob = true; i += m[0].length - 1; cur.end = i + 1; continue; }
      }
      flushTok();
      continue;
    }
    start(i);
    cur.text += c; cur.end = i + 1;
    if (c === '*' || c === '?' || c === '[') cur.glob = true;
  }
  flushClause();
  return clauses;
}

function stripWrappers(tokens) {
  let i = 0;
  while (i < tokens.length && (/^\w+=/.test(tokens[i].text) || ['sudo', 'command', 'builtin', 'noglob', 'nocorrect', 'env'].includes(tokens[i].text))) i++;
  return tokens.slice(i);
}

function expandHome(p) {
  return p.startsWith('~/') ? path.join(os.homedir(), p.slice(2)) : p;
}

function globMatches(pattern, cwd) {
  try {
    if (typeof fs.globSync !== 'function') return null; // unknown: do not guess
    const abs = path.isAbsolute(expandHome(pattern)) ? expandHome(pattern) : path.join(cwd, pattern);
    const hits = fs.globSync(abs);
    return hits.length;
  } catch {
    return null;
  }
}

function toolAvailable(name) {
  for (const dir of (process.env.PATH || '').split(':')) {
    if (dir && fs.existsSync(path.join(dir, name))) return true;
  }
  return false;
}

function check(rawCmd, cwd) {
  const findings = [];
  let rewritten = rawCmd;
  const cmd = blankHeredocs(rawCmd);
  const bare = unquotedOnly(cmd);
  // Quotes kept, interiors masked: lets a rule see `-i ''` yet ignore quoted mentions.
  const shape = cmd.replace(/'([^']*)'|"((?:\\.|[^"\\])*)"/g, (m, a, b) => m[0] + 'x'.repeat((a ?? b ?? '').length) + m[0]);

  // 1. for-loop over a bare parameter expansion — no word splitting in zsh.
  const forLoop = /\bfor\s+\w+\s+in\s+\$\{?(\w+)\}?\s*(?:;|\bdo\b|$)/m.exec(bare);
  if (forLoop) {
    findings.push(
      `zsh does not word-split "$${forLoop[1]}" — \`for … in $${forLoop[1]}\` runs ONCE over the ` +
      `whole value instead of per line.\n` +
      `  fix: for x in \${=${forLoop[1]}}   (zsh split flag)\n` +
      `  or:  printf '%s\\n' "$${forLoop[1]}" | while read -r x; do …; done   (portable, preferred for multi-line)\n` +
      `  note: $(…) DOES split in zsh — only bare $VAR is affected.`,
    );
  }

  // 2. Unquoted glob in a flag that wants a LITERAL pattern → AUTO-QUOTE.
  const flagGlobRe = /(--(?:include|exclude|exclude-dir|include-dir)=|(?:^|\s)-(?:i?name|i?path|i?regex)\s+)([^\s'"]*[*?[][^\s'"]*)/g;
  const fixes = [];
  let fm;
  while ((fm = flagGlobRe.exec(bare)) !== null) {
    const valueStart = fm.index + fm[0].length - fm[2].length;
    fixes.push({ start: valueStart, end: valueStart + fm[2].length, value: fm[2] });
  }
  if (fixes.length) {
    for (const f of fixes.slice().reverse()) {
      rewritten = rewritten.slice(0, f.start) + `'${f.value}'` + rewritten.slice(f.end);
    }
  }

  // 3. NOMATCH on file-arg commands.
  for (const toks of clausesOf(bare === cmd ? cmd : maskQuotesKeepShape(cmd))) {
    const t = stripWrappers(toks);
    if (!t.length) continue;
    const bin = path.basename(t[0].text);
    if (!FILE_ARG_CMDS.has(bin)) continue;
    for (const tok of t.slice(1)) {
      if (!tok.glob || tok.nullGlob || tok.text.startsWith('-')) continue;
      if (tok.hasVar) {
        if (DESTRUCTIVE_CMDS.has(bin)) {
          findings.push(
            `zsh NOMATCH: \`${bin} … ${tok.text}\` has an unquoted glob behind a variable. If it matches ` +
            `nothing, zsh aborts the ENTIRE command line with "no matches found" (not just this ${bin}), ` +
            `so everything after it in the same call silently does not run.\n` +
            `  fix: add the null-glob qualifier  ${tok.text}(N)   (zsh: expands to nothing when unmatched)\n` +
            `  or:  find "<dir>" -maxdepth 1 -name 'pattern' -exec ${bin} -rf {} +`,
          );
        }
        continue;
      }
      const n = globMatches(tok.text, cwd || process.cwd());
      if (n === 0) {
        findings.push(
          `zsh NOMATCH: \`${tok.text}\` matches nothing in ${cwd || process.cwd()}, so zsh aborts the ` +
          `whole command line with "no matches found" before \`${bin}\` runs.\n` +
          `  fix: ${tok.text}(N)   (zsh null-glob qualifier)  or  find . -maxdepth 1 -name '<pattern>'`,
        );
      }
    }
  }

  // 4. macOS path: these live in /bin, not /usr/bin.
  const badPath = new RegExp(`/usr/bin/(${BIN_NOT_USRBIN.join('|')})\\b`).exec(bare);
  if (badPath) {
    findings.push(
      `/usr/bin/${badPath[1]} does not exist on macOS — it is /bin/${badPath[1]}.\n` +
      `  fix: /bin/${badPath[1]}   (or just \`${badPath[1]}\` and let PATH resolve it)`,
    );
  }

  // 5/6. bash-only and GNU-only constructs. Skip when the command re-execs bash.
  const reExecsBash = /\bbash\s+(?:-\w*c\w*\b|[^-\s]\S*)/.test(bare);
  if (!reExecsBash) {
    if (/\bBASH_REMATCH\b/.test(bare)) {
      findings.push(
        `zsh does not populate $BASH_REMATCH — \`[[ … =~ … ]]\` in zsh sets $match/$MATCH ` +
        `instead, so every $BASH_REMATCH reference expands to EMPTY and the surrounding logic ` +
        `silently takes the else-path. Nothing errors — the command just proves nothing.\n` +
        `  fix: use \${match[1]} (zsh) or a portable sed/grep -E pipeline  (or bash -c '…' with /opt/homebrew/bin/bash)`,
      );
    }
    const bashOnly = /\bdeclare\s+-A\b|\bmapfile\b|\breadarray\b|\bshopt\b|\blocal\s+-n\b/.exec(bare);
    if (bashOnly) {
      findings.push(
        `\`${bashOnly[0]}\` is bash-only and fails or misbehaves under zsh (macOS /usr/bin/env bash is 3.2.57 and lacks it too).\n` +
        `  fix: zsh equivalents (typeset -A, setopt, \${(f)"$(…)"}) or bash -c '…' with /opt/homebrew/bin/bash`,
      );
    }
    if (/\$\{[A-Za-z_]\w*(?:,,|\^\^)\}|\$\{!\w+\}|\$\{!\w+\[@\]\}/.test(bare)) {
      findings.push(
        '`${v,,}` / `${v^^}` / `${!v}` are bash expansions: zsh errors "bad substitution" or returns something else.\n' +
        '  fix: ${(L)v} lowercase, ${(U)v} uppercase, ${(P)v} indirect, ${(k)arr} keys',
      );
    }
    if (/\bread\s+(?:-\w*\s+)*-a\b/.test(bare)) {
      findings.push('`read -a` is bash; zsh uses `read -A arr`. fix: read -A, or `arr=("${(@f)…}")`.');
    }
    if (/\bBASH_SOURCE\b|\bBASH_VERSION\b|\bFUNCNAME\b/.test(bare)) {
      findings.push('`$BASH_SOURCE` / `$BASH_VERSION` / `$FUNCNAME` are unset in zsh and expand to empty. fix: ${(%):-%x} for the script path, $0 inside functions.');
    }
    if (/\bsed\s+(?:-[A-Za-z]+\s+)*-i\s+(?!(?:''|"")(?:\s|$))/.test(shape)) {
      findings.push(
        'BSD sed (macOS) requires a suffix argument after -i: `sed -i \'s/a/b/\' f` makes sed treat the script as the suffix and fail.\n' +
        "  fix: sed -i '' 's/a/b/' f   (or -i.bak)",
      );
    }
    if (/\bgrep\s+(?:-[A-Za-z]*P[A-Za-z]*|--perl-regexp)\b/.test(bare)) {
      findings.push('BSD grep has no -P. fix: grep -E, or rg (installed) for PCRE: rg -P.');
    }
    if (/\bdate\s+(?:-d\b|--date)/.test(bare)) {
      findings.push('BSD date has no -d/--date. fix: date -j -f "%Y-%m-%d" "2026-01-01" +%s  or  date -v-7d +%F  (relative).');
    }
    if (/(?:^|[;&|(\s])timeout\s+\d/.test(bare) && !toolAvailable('timeout')) {
      findings.push('`timeout` is not installed on macOS. fix: ' + (toolAvailable('gtimeout') ? 'gtimeout' : 'use the Bash tool timeout parameter, or `brew install coreutils` for gtimeout') + '.');
    }
    if (/\bxargs\s+(?:-[A-Za-z]*\s+)*-r\b/.test(bare)) {
      findings.push('BSD xargs has no -r (it already skips empty input). fix: drop -r.');
    }
    if (/\bstat\s+(?:-[A-Za-z]*\s+)*-c\b/.test(bare)) {
      findings.push('BSD stat has no -c. fix: stat -f "%m" file (mtime), stat -f "%z" file (size).');
    }
    if (/\bhead\s+-n?\s*-\d+/.test(bare)) {
      findings.push('BSD head rejects negative counts. fix: sed "$d" for all-but-last, or `awk` / `python3`.');
    }
    if (/(?:^|[;&|(\s])tac\b/.test(bare) && !toolAvailable('tac')) {
      findings.push('`tac` does not exist on macOS. fix: tail -r.');
    }
    if (/\bfind\b[^|;&]*\s-printf\b/.test(bare)) {
      findings.push('BSD find has no -printf. fix: -exec stat -f "%N %m" {} + or -print0 | xargs -0.');
    }
  }

  return { findings, rewritten: fixes.length ? rewritten : null, autoFixed: fixes.map((f) => f.value) };
}

/** Same-length mask of quoted spans but tokenizer-safe: quotes replaced with `x` so tokens stay glued. */
function maskQuotesKeepShape(cmd) {
  return cmd.replace(/'[^']*'|"(?:\\.|[^"\\])*"/g, (m) => {
    // Keep a quoted variable reference visible as a variable (hasVar) but never as a glob.
    const hasVar = m.includes('$');
    return (hasVar ? '$' : 'x') + 'x'.repeat(Math.max(0, m.length - 1));
  });
}

let raw = '';
process.stdin.on('data', (d) => { raw += d; });
process.stdin.on('end', () => {
  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    process.exit(0); // unparseable payload is not this guard's business — fail OPEN
  }
  try {
    if (payload?.tool_name && payload.tool_name !== 'Bash') process.exit(0);
    const input = payload?.tool_input || {};
    const cmd = input.command ?? '';
    if (!cmd) process.exit(0);

    const { findings, rewritten, autoFixed } = check(cmd, payload.cwd);

    if (findings.length) {
      process.stdout.write(JSON.stringify({
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'deny',
          permissionDecisionReason:
            `zsh-guard (this Mac runs zsh 5.9 with BSD userland, not bash/GNU). Fix the command and re-run once:\n\n${findings.join('\n\n')}`,
        },
      }));
      process.exit(0);
    }
    if (rewritten) {
      process.stdout.write(JSON.stringify({
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'allow',
          permissionDecisionReason: `zsh-guard auto-quoted unquoted glob value(s) ${autoFixed.join(', ')} (zsh NOMATCH would have aborted the command).`,
          updatedInput: { ...input, command: rewritten },
        },
      }));
    }
  } catch {
    // fail OPEN
  }
  process.exit(0);
});

