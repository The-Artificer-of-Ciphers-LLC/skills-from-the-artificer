#!/usr/bin/env node
'use strict';

/**
 * zsh-guard.cjs — PreToolUse(Bash) guard for zsh-invalid command shapes on macOS.
 *
 * This machine runs zsh 5.9 as $SHELL. Three bash habits are silently or loudly
 * wrong here, and each one has cost real cycles:
 *
 *   1. zsh has SH_WORD_SPLIT OFF. `for x in $VAR` iterates ONCE over the whole
 *      value; bash splits it. Verified: V=$'a\nb\nc'; for x in $V -> 1 iteration,
 *      for x in ${=V} -> 3. Note $(...) DOES split in zsh, so it is not flagged.
 *   2. zsh NOMATCH errors on an unquoted glob that matches nothing — and a token
 *      like `--include=*.yml` can never match a filename, so it ALWAYS errors,
 *      even when *.yml files exist. Verified both ways.
 *   3. On macOS, cat/echo/ps/kill/... live in /bin, not /usr/bin. Verified by
 *      probing each path; the list below is exactly the set where /bin/<x> exists
 *      and /usr/bin/<x> does not.
 *
 * Deny + explain, so the correct form is one edit away rather than one failed
 * command plus a re-read of the error.
 */

const BIN_NOT_USRBIN = [
  'cat', 'echo', 'ps', 'kill', 'sleep', 'test', 'pwd', 'ln', 'mv', 'rm', 'cp',
  'df', 'date', 'stty', 'sync', 'ls', 'mkdir', 'chmod',
];

/** Strip single/double-quoted spans so we only inspect UNQUOTED shell text. */
function unquotedOnly(cmd) {
  // Replace quoted runs with same-length filler so offsets stay comparable and
  // quoted content can never trigger a rule.
  return cmd.replace(/'[^']*'|"[^"]*"/g, (m) => ' '.repeat(m.length));
}

function check(cmd) {
  const findings = [];
  const bare = unquotedOnly(cmd);

  // 1. for-loop over a bare parameter expansion — no word splitting in zsh.
  //    ${=VAR} is the zsh splitting form and is intentionally NOT matched
  //    (`=` is not \w). "$VAR" is already blanked by unquotedOnly.
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

  // 2. Unquoted glob in a flag that wants a LITERAL pattern.
  const flagGlob = /(--(?:include|exclude)=|(?:^|\s)-(?:i?name|i?path)\s+)([^\s'"]*[*?[][^\s'"]*)/.exec(bare);
  if (flagGlob) {
    const flag = flagGlob[1].trim();
    findings.push(
      `zsh NOMATCH: \`${flag}${flagGlob[2]}\` is glob-expanded by the shell before the tool sees it, ` +
      `and errors "no matches found" — this fires even when matching files exist, because the whole ` +
      `token (flag included) can never match a filename.\n` +
      `  fix: quote the pattern — ${flag}'${flagGlob[2]}'`,
    );
  }

  // 3. macOS path: these live in /bin, not /usr/bin.
  const badPath = new RegExp(`/usr/bin/(${BIN_NOT_USRBIN.join('|')})\\b`).exec(bare);
  if (badPath) {
    findings.push(
      `/usr/bin/${badPath[1]} does not exist on macOS — it is /bin/${badPath[1]}.\n` +
      `  fix: /bin/${badPath[1]}   (or just \`${badPath[1]}\` and let PATH resolve it)`,
    );
  }

  // 4. bash-only constructs that FAIL SILENTLY under zsh — no error, just the
  //    wrong answer, so a verification command "succeeds" while proving nothing.
  //    Skip entirely when the command already re-execs under real bash.
  const reExecsBash = /\bbash\s+(?:-\w*c\w*\b|[^-\s]\S*)/.test(bare);
  if (!reExecsBash) {
    // 4a. $BASH_REMATCH is unset in zsh — [[ … =~ … ]] populates $match/$MATCH
    //     instead, so every BASH_REMATCH reference expands to EMPTY and the
    //     surrounding logic silently takes the else-path.
    if (/\bBASH_REMATCH\b/.test(bare)) {
      findings.push(
        `zsh does not populate $BASH_REMATCH — \`[[ … =~ … ]]\` in zsh sets $match/$MATCH ` +
        `instead, so every $BASH_REMATCH reference expands to EMPTY and the surrounding logic ` +
        `silently takes the else-path. Nothing errors — the command just proves nothing.\n` +
        `  fix: bash -c '…'   (re-exec under real bash — required when verifying a \`\`\`bash snippet)\n` +
        `  or:  use \${match[1]} (zsh) or a portable sed/grep -E pipeline`,
      );
    }

    // 4b. declare -A / mapfile / readarray are bash-only, and macOS ships
    //     /usr/bin/env bash 3.2.57, which lacks them even under real bash.
    const bashOnly = /\bdeclare\s+-A\b|\bmapfile\b|\breadarray\b/.exec(bare);
    if (bashOnly) {
      findings.push(
        `\`${bashOnly[0]}\` is bash-only and silently misbehaves under zsh — and macOS's ` +
        `/usr/bin/env bash is 3.2.57, which lacks it even under real bash.\n` +
        `  fix: bash -c '…' with /opt/homebrew/bin/bash, or restructure to indexed arrays / a python3 pipe`,
      );
    }
  }

  return findings;
}

let raw = '';
process.stdin.on('data', (d) => { raw += d; });
process.stdin.on('end', () => {
  let cmd = '';
  try {
    cmd = JSON.parse(raw)?.tool_input?.command ?? '';
  } catch {
    // Unparseable payload is not this guard's business — fail OPEN so a hook bug
    // never wedges every Bash call.
    process.exit(0);
  }
  if (!cmd) process.exit(0);

  const findings = check(cmd);
  if (findings.length === 0) process.exit(0);

  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason:
        `zsh-guard (this Mac runs zsh 5.9, not bash):\n\n${findings.join('\n\n')}`,
    },
  }));
  process.exit(0);
});
