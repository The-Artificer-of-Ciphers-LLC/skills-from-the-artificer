#!/usr/bin/env bash
# Behavioral regression suite for gsd-memtrace-first-guard.cjs.
# Run after ANY edit to this hook:
#   bash ~/.claude/hooks/gsd-memtrace-first-guard.test.sh
#
# Covers the three real false-positive classes fixed 2026-08-26:
#   FP1 - non-indexed paths (throwaway mktemp fixtures)
#   FP2 - --include/--exclude glob VALUES mis-cited as path operands
#   FP3 - interpreter/pkg-manager script EXECUTION mis-cited as a search
# and confirms the guard's real job (denying a text search/read whose
# target is an indexed source file inside the real repo) is not gutted.
set -uo pipefail
cd "$(dirname "$0")" || exit 1
GUARD="$(pwd)/gsd-memtrace-first-guard.cjs"

REAL_REPO=/Users/trekkie/projects/gsd-core

N=0
F=0
pass() { N=$((N+1)); echo "PASS  $1"; }
fail() { N=$((N+1)); F=$((F+1)); echo "FAIL  $1 -> $2"; }

# run <payload-json>
# Populates globals OUT (stdout) and RC (exit code). GSD_MEMTRACE_GUARD_OFF
# is force-unset so nothing leaks in from the ambient shell (hermeticity).
run() {
  local payload="$1"
  OUT=$(
    unset GSD_MEMTRACE_GUARD_OFF
    # Hermeticity: the 1.5.0 detection layer writes to ~/.claude/logs. The
    # behavioural cases must not pollute the real audit trail; the logging
    # layer has its own dedicated test below with an isolated HOME.
    GSD_MEMTRACE_GUARD_LOG=0 printf '%s' "$payload" | GSD_MEMTRACE_GUARD_LOG=0 node "$GUARD" 2>/dev/null
  )
  RC=$?
}

check() {
  local name="$1" py="$2" res
  if res=$(printf '%s' "$OUT" | python3 -c "$py" 2>&1); then
    pass "$name"
  else
    fail "$name" "$res"
  fi
}

assert_rc() {
  local name="$1" expected="$2"
  if [ "$RC" = "$expected" ]; then pass "$name"; else fail "$name" "rc=$RC (expected $expected)"; fi
}

ALLOW_CHECK='import json,sys
d=json.load(sys.stdin)
ho=d["hookSpecificOutput"]
assert ho.get("permissionDecision") != "deny", ho'

DENY_CHECK='import json,sys
d=json.load(sys.stdin)
ho=d["hookSpecificOutput"]
assert ho.get("permissionDecision") == "deny", ho'

NOT_PATH_OPERAND_CHECK='import json,sys
d=json.load(sys.stdin)
ho=d["hookSpecificOutput"]
if ho.get("permissionDecision") == "deny":
    reason = ho.get("permissionDecisionReason", "")
    assert "path operand" not in reason or "include" not in reason, reason
'

# --- fixture for the FP1 temp-dir case: a throwaway repo-shaped dir under
# the OS temp root, containing an indexed-looking source file. ---
TMPFIXTURE=$(mktemp -d)
mkdir -p "$TMPFIXTURE/src"
printf 'export const x = 1;\n' > "$TMPFIXTURE/src/thing.cts"

# Fixture for HOLE B: a temp dir that IS a clone of the repo under test
# (same remote.origin.url), which must NOT be exempt.
REAL_ORIGIN=$(git -C "$REAL_REPO" config --get remote.origin.url 2>/dev/null || echo "")
TMPCLONE=$(mktemp -d)
mkdir -p "$TMPCLONE/src"
printf 'export const y = 2;\n' > "$TMPCLONE/src/thing.cts"
git -C "$TMPCLONE" init -q 2>/dev/null
[ -n "$REAL_ORIGIN" ] && git -C "$TMPCLONE" remote add origin "$REAL_ORIGIN" 2>/dev/null

trap 'rm -rf "$TMPFIXTURE" "$TMPCLONE"' EXIT

echo "=== MUST ALLOW (false positives) ==="

# FP3: running a generator/script is execution, not a text search.
run "{\"tool_name\":\"Bash\",\"tool_input\":{\"command\":\"node scripts/gen-adr-index.cjs --write\"},\"cwd\":\"$REAL_REPO\"}"
check "FP3: node scripts/gen-adr-index.cjs --write -> allow" "$ALLOW_CHECK"

# FP2: --include glob VALUE (joined form) is a filter, not a path operand.
run "{\"tool_name\":\"Bash\",\"tool_input\":{\"command\":\"grep -rn \\\"x\\\" --include='*.cts' .\"},\"cwd\":\"$REAL_REPO\"}"
check "FP2: grep --include='*.cts' (joined) -> allow" "$ALLOW_CHECK"
check "FP2: grep --include='*.cts' (joined) -> not denied citing include value as path operand" "$NOT_PATH_OPERAND_CHECK"

# FP2: --include glob VALUE (space-separated form) is a filter, not a path operand.
run "{\"tool_name\":\"Bash\",\"tool_input\":{\"command\":\"grep -rn x --include *.cts .\"},\"cwd\":\"$REAL_REPO\"}"
check "FP2: grep --include *.cts (space-separated) -> allow" "$ALLOW_CHECK"
check "FP2: grep --include *.cts (space-separated) -> not denied citing include value as path operand" "$NOT_PATH_OPERAND_CHECK"

# FP1: a .cts path under a throwaway mktemp fixture is indexed by nothing.
run "{\"tool_name\":\"Bash\",\"tool_input\":{\"command\":\"cat $TMPFIXTURE/src/thing.cts\"},\"cwd\":\"$TMPFIXTURE\"}"
check "FP1: cat on .cts under mktemp fixture -> allow" "$ALLOW_CHECK"

run "{\"tool_name\":\"Bash\",\"tool_input\":{\"command\":\"grep -rn x $TMPFIXTURE/src/thing.cts\"},\"cwd\":\"$TMPFIXTURE\"}"
check "FP1: grep on .cts under mktemp fixture -> allow" "$ALLOW_CHECK"

run "{\"tool_name\":\"Read\",\"tool_input\":{\"file_path\":\"$REAL_REPO/README.md\"},\"cwd\":\"$REAL_REPO\"}"
check "Read on prose .md inside real repo -> allow" "$ALLOW_CHECK"

run "{\"tool_name\":\"Read\",\"tool_input\":{\"file_path\":\"$TMPFIXTURE/src/thing.cts\"},\"cwd\":\"$TMPFIXTURE\"}"
check "HOLE B preserved FP1: Read .cts under non-git mktemp fixture -> allow" "$ALLOW_CHECK"

# FP4 (found 2026-09-07): a leading `cd <dir>` before a pure git script
# defeated GIT_PREFIX_RE (anchored at literal start-of-string), so a
# `git commit -m "$(cat <<'EOF' ...)"` heredoc-message idiom — this repo's
# own mandated way to pass a multi-line commit message safely — was denied
# citing the bare word "cat" inside the heredoc as a search of an unrelated
# indexed source file that merely happened to also be `git add`ed earlier
# in the same multi-line command.
run "{\"tool_name\":\"Bash\",\"tool_input\":{\"command\":\"cd $REAL_REPO\ngit add tests/some-file.test.cjs\ngit commit -m \\\"\$(cat <<'EOF'\nfix: something\nEOF\n)\\\"\ngit rev-parse HEAD\"},\"cwd\":\"$REAL_REPO\"}"
check "FP4: leading cd + git commit heredoc -m idiom -> allow" "$ALLOW_CHECK"

# FP5 (found 2026-09-08): the SAME leading-`cd` defeat, but for FP3 instead of
# GIT_PREFIX_RE — getExecutedScriptArg only recognised tokens[0] as the
# interpreter/package-manager, so `cd <dir>` before `node -c src/foo.cts` meant no
# interpreter was recognised at all, and the syntax-checked (never searched) file
# was cited as a "path operand" the moment an unrelated `| tail` appeared later in
# the same multi-line command (measured: `cd <dir>\nnode -c tests/helpers/emitted-
# runtime.cjs && ... \nnpm run lint 2>&1 | tail -10` denied).
run "{\"tool_name\":\"Bash\",\"tool_input\":{\"command\":\"cd $REAL_REPO\nnode -c src/cli-exit.cts && echo ok\nnpm run lint 2>&1 | tail -10\"},\"cwd\":\"$REAL_REPO\"}"
check "FP5: leading cd + node -c <source> + later | tail -> allow" "$ALLOW_CHECK"

echo "=== MUST STILL DENY (the guard's real job, not regressed) ==="

run "{\"tool_name\":\"Bash\",\"tool_input\":{\"command\":\"cat src/cli-exit.cts\"},\"cwd\":\"$REAL_REPO\"}"
check "DENY: cat src/cli-exit.cts inside real repo" "$DENY_CHECK"

run "{\"tool_name\":\"Bash\",\"tool_input\":{\"command\":\"grep -rn \\\"someSymbol\\\" src/foo.cts\"},\"cwd\":\"$REAL_REPO\"}"
check "DENY: grep -rn someSymbol src/foo.cts inside real repo" "$DENY_CHECK"

run "{\"tool_name\":\"Bash\",\"tool_input\":{\"command\":\"sed -n '1,50p' src/io.cts\"},\"cwd\":\"$REAL_REPO\"}"
check "DENY: sed -n 1,50p src/io.cts inside real repo" "$DENY_CHECK"

# FP4 guard-rail: a leading `cd` must NOT exempt a genuine search — only a
# command that is ENTIRELY git (past the cd) is exempt. stripLeadingCd only
# feeds the GIT_PREFIX_RE re-check; SEARCH_BIN_RE still scans the whole
# original string regardless, so this must still deny.
run "{\"tool_name\":\"Bash\",\"tool_input\":{\"command\":\"cd $REAL_REPO\ncat src/cli-exit.cts\"},\"cwd\":\"$REAL_REPO\"}"
check "DENY: leading cd + cat src/cli-exit.cts (not an all-git command) inside real repo" "$DENY_CHECK"

# FP5 guard-rail: a leading `cd` must not exempt a genuine grep SEARCH either — grep
# is not in INTERPRETER_WORDS/PKG_MANAGER_WORDS, so stripLeadingCd changes nothing
# about whether THIS command counts as execution vs. search; it must still deny.
run "{\"tool_name\":\"Bash\",\"tool_input\":{\"command\":\"cd $REAL_REPO\ngrep -rn someSymbol src/cli-exit.cts\"},\"cwd\":\"$REAL_REPO\"}"
check "DENY: leading cd + grep src/cli-exit.cts (not an interpreter execution) inside real repo" "$DENY_CHECK"

echo "=== MUST DENY (1.2.0 circumvention holes) ==="

run "{\"tool_name\":\"Read\",\"tool_input\":{\"file_path\":\"src/cli-exit.cts\"},\"cwd\":\"$REAL_REPO\"}"
check "HOLE A: Read on indexed source (relative path) -> deny" "$DENY_CHECK"

run "{\"tool_name\":\"Read\",\"tool_input\":{\"file_path\":\"$REAL_REPO/src/cli-exit.cts\"},\"cwd\":\"$REAL_REPO\"}"
check "HOLE A: Read on indexed source (absolute path) -> deny" "$DENY_CHECK"

# A silently-skipped block is how a suite loses coverage without anyone
# noticing (observed 2026-09-10: one run reported 189/189 instead of 191/191
# because this `git config` returned empty; the two HOLE B cases vanished with
# no FAIL line). Never skip silently -- fail loudly instead.
if [ -z "$REAL_ORIGIN" ]; then
  fail "HOLE B fixture: remote.origin.url of $REAL_REPO" "empty -- HOLE B cases could not run"
  fail "HOLE B fixture (2nd case placeholder)" "empty remote.origin.url"
fi
if [ -n "$REAL_ORIGIN" ]; then
  run "{\"tool_name\":\"Read\",\"tool_input\":{\"file_path\":\"$TMPCLONE/src/thing.cts\"},\"cwd\":\"$REAL_REPO\"}"
  check "HOLE B: Read .cts in temp clone of current repo -> deny" "$DENY_CHECK"

  run "{\"tool_name\":\"Bash\",\"tool_input\":{\"command\":\"cat $TMPCLONE/src/thing.cts\"},\"cwd\":\"$REAL_REPO\"}"
  check "HOLE B: Bash read of .cts in temp clone of current repo -> deny" "$DENY_CHECK"
fi

echo "=== deny message content ==="

run "{\"tool_name\":\"Bash\",\"tool_input\":{\"command\":\"cat src/cli-exit.cts\"},\"cwd\":\"$REAL_REPO\"}"
check "deny reason carries the anti-circumvention preamble verbatim" '
import json,sys
d=json.load(sys.stdin)
reason = d["hookSpecificOutput"]["permissionDecisionReason"]
assert reason.startswith("DO NOT REPHRASE THIS COMMAND TO GET PAST THIS GUARD."), reason
assert "circumvention, not problem-solving" in reason, reason
'

echo "=== fail-open: never crash-to-deny ==="

run '{"tool_name":"Write","tool_input":{"file_path":"src/cli-exit.cts"}}'
assert_rc "non-matched tool_name -> rc0" 0
check "non-matched tool_name -> allow" "$ALLOW_CHECK"

run ''
assert_rc "empty stdin -> rc0" 0
check "empty stdin -> allow" "$ALLOW_CHECK"

run '{not valid json'
assert_rc "malformed json -> rc0" 0
check "malformed json -> allow" "$ALLOW_CHECK"

########################################################################
# 1.5.0 adversarial suite (added 2026-09-09 by an independent reviewer).
#
# Sources: (a) five FALSE POSITIVES observed in a live session, (b) a
# bypass sweep run against the live 1.4.0 hook. Every case below was
# measured against 1.4.0 before any fix was written; the "was 1.4.0"
# annotation records what the unfixed hook actually did.
########################################################################

echo "=== 1.5.0 MUST ALLOW: text-in-command is not a path operand ==="

# FP6 (was 1.4.0: DENY). A heredoc BODY is data being written, not a set of
# path operands. This exact shape blocked the authoring of THIS test file.
run "{\"tool_name\":\"Bash\",\"tool_input\":{\"command\":\"cat >> notes.md <<'EOF'\nsee src/cli-exit.cts for details\nEOF\"},\"cwd\":\"$REAL_REPO\"}"
check "FP6: heredoc body naming a source file, target is .md -> allow" "$ALLOW_CHECK"

# FP7 (was 1.4.0: DENY). A '#' comment inside a script body is prose.
# This is the exact shape a live session rephrased its way past.
run "{\"tool_name\":\"Bash\",\"tool_input\":{\"command\":\"python3 - <<'EOF'\n# reads src/cli-exit.cts\nprint(1)\nEOF\ncat notes.md\"},\"cwd\":\"$REAL_REPO\"}"
check "FP7: code comment naming a source file -> allow" "$ALLOW_CHECK"

# FP8 (was 1.4.0: DENY). For grep-family, the FIRST non-flag operand is the
# search PATTERN; only the operands after it are paths. Here the real target
# is a config file and the source name is the pattern.
run "{\"tool_name\":\"Bash\",\"tool_input\":{\"command\":\"grep -n 'cli-exit.cts' package.json\"},\"cwd\":\"$REAL_REPO\"}"
check "FP8: quoted grep PATTERN ending in a source ext, target is config -> allow" "$ALLOW_CHECK"

# FP9 (was 1.4.0: DENY). The deny text itself exempts "file-inventory counts";
# find's -name VALUE is a filter, not a path operand.
run "{\"tool_name\":\"Bash\",\"tool_input\":{\"command\":\"find src -name '*.cts' | head -5\"},\"cwd\":\"$REAL_REPO\"}"
check "FP9: find -name '*.cts' | head (file inventory) -> allow" "$ALLOW_CHECK"

# FP10 (was 1.4.0: DENY). Appending prose to a Markdown file.
run "{\"tool_name\":\"Bash\",\"tool_input\":{\"command\":\"echo 'see src/cli-exit.cts' >> notes.md && cat notes.md\"},\"cwd\":\"$REAL_REPO\"}"
check "FP10: append+read a .md whose TEXT names a source file -> allow" "$ALLOW_CHECK"

echo "=== 1.5.0 MUST DENY: read-surface bypasses (all ALLOWed by 1.4.0) ==="

for tool in nl strings more tac rev "od -c" "xxd" "cut -c1-80" "column -t"; do
  run "{\"tool_name\":\"Bash\",\"tool_input\":{\"command\":\"$tool src/cli-exit.cts\"},\"cwd\":\"$REAL_REPO\"}"
  check "BYPASS(bin): $tool src/cli-exit.cts -> deny" "$DENY_CHECK"
done

run "{\"tool_name\":\"Bash\",\"tool_input\":{\"command\":\"perl -pe '' src/cli-exit.cts\"},\"cwd\":\"$REAL_REPO\"}"
check "BYPASS(bin): perl -pe '' src/cli-exit.cts -> deny" "$DENY_CHECK"

# git is exempted wholesale as a "VCS query surface", but three git
# subcommands are full file-READ surfaces, not history queries.
run "{\"tool_name\":\"Bash\",\"tool_input\":{\"command\":\"git show HEAD:src/cli-exit.cts\"},\"cwd\":\"$REAL_REPO\"}"
check "BYPASS(git): git show HEAD:<source> -> deny" "$DENY_CHECK"

run "{\"tool_name\":\"Bash\",\"tool_input\":{\"command\":\"git cat-file -p HEAD:src/cli-exit.cts\"},\"cwd\":\"$REAL_REPO\"}"
check "BYPASS(git): git cat-file -p HEAD:<source> -> deny" "$DENY_CHECK"

run "{\"tool_name\":\"Bash\",\"tool_input\":{\"command\":\"git grep -n someSymbol -- '*.cts'\"},\"cwd\":\"$REAL_REPO\"}"
check "BYPASS(git): git grep -- '*.cts' -> deny" "$DENY_CHECK"

# git's genuine history surface must stay exempt (guard-rail for the above).
run "{\"tool_name\":\"Bash\",\"tool_input\":{\"command\":\"git log --oneline -20 -- src/cli-exit.cts\"},\"cwd\":\"$REAL_REPO\"}"
check "GUARD-RAIL: git log -- <source> stays allowed" "$ALLOW_CHECK"

run "{\"tool_name\":\"Bash\",\"tool_input\":{\"command\":\"git diff HEAD~1 -- src/cli-exit.cts\"},\"cwd\":\"$REAL_REPO\"}"
check "GUARD-RAIL: git diff -- <source> stays allowed" "$ALLOW_CHECK"

echo "=== 1.5.0 MUST DENY: punctuation/quoting defeats of extension matching ==="

# Trailing shell punctuation made extOf() return '' -> whole check skipped.
run "{\"tool_name\":\"Bash\",\"tool_input\":{\"command\":\"F=src/cli-exit.cts; cat \$F\"},\"cwd\":\"$REAL_REPO\"}"
check "BYPASS(punct): trailing ';' after the path -> deny" "$DENY_CHECK"

run "{\"tool_name\":\"Bash\",\"tool_input\":{\"command\":\"cat \$(printf '%s' src/cli-exit.cts)\"},\"cwd\":\"$REAL_REPO\"}"
check "BYPASS(punct): command substitution, trailing ')' -> deny" "$DENY_CHECK"

run "{\"tool_name\":\"Bash\",\"tool_input\":{\"command\":\"cat src/cli-exit.cts:1\"},\"cwd\":\"$REAL_REPO\"}"
check "BYPASS(punct): 'file:line' suffix -> deny" "$DENY_CHECK"

# Adjacent-quoted-string concatenation splits the extension in the token text
# while the shell still resolves it to the same file.
run "{\"tool_name\":\"Bash\",\"tool_input\":{\"command\":\"cat 'src/cli-exit.c''ts'\"},\"cwd\":\"$REAL_REPO\"}"
check "BYPASS(quote): quote-split extension -> deny" "$DENY_CHECK"

# A glob that can only expand to a source file.
run "{\"tool_name\":\"Bash\",\"tool_input\":{\"command\":\"cat src/cli-exit.ct?\"},\"cwd\":\"$REAL_REPO\"}"
check "BYPASS(glob): single-char wildcard in the extension -> deny" "$DENY_CHECK"

echo "=== 1.5.0 MUST DENY: tool-input-shape holes ==="

# The Glob TOOL sends its pattern in `pattern`, not `glob` -- checkGrepGlob
# only ever read `glob`/`path`, so the Glob tool was matched but never checked.
run "{\"tool_name\":\"Glob\",\"tool_input\":{\"pattern\":\"**/*.cts\"},\"cwd\":\"$REAL_REPO\"}"
check "HOLE C: Glob tool pattern '**/*.cts' -> deny" "$DENY_CHECK"

# Brace-alternation glob never matched globRestrictsToSource's `$`-anchored RE.
run "{\"tool_name\":\"Grep\",\"tool_input\":{\"pattern\":\"x\",\"glob\":\"{*.cts,*.h}\",\"path\":\"src\"},\"cwd\":\"$REAL_REPO\"}"
check "HOLE D: Grep glob brace form '{*.cts,*.h}' -> deny" "$DENY_CHECK"

echo "=== 1.5.0 KNOWN GAP (pinned deliberately, NOT a bug to silently fix) ==="

# An unrestricted Grep over a source directory is the single most common
# code-discovery move a model makes, and 1.4.0 allows it: checkGrepGlob only
# fires when glob/type restricts to a source language or `path` IS a source
# file. Closing this would deny nearly every Grep inside a source repo,
# including prose search, so it is a PRODUCT decision for the human, not a
# reviewer's unilateral widening. Pinned here so any future change to it is
# deliberate and shows up as a test edit.
run "{\"tool_name\":\"Grep\",\"tool_input\":{\"pattern\":\"someSymbol\",\"path\":\"src\"},\"cwd\":\"$REAL_REPO\"}"
check "KNOWN GAP: unrestricted Grep over a source dir is ALLOWED (by design, for now)" "$ALLOW_CHECK"

echo "=== 1.5.0 detection layer (isolated HOME) ==="

LOGHOME=$(mktemp -d)
logrun() { # logrun <payload>
  printf '%s' "$1" | env -u GSD_MEMTRACE_GUARD_OFF HOME="$LOGHOME" node "$GUARD" >/dev/null 2>&1
}
# 1. a denied command...
logrun "{\"tool_name\":\"Bash\",\"tool_input\":{\"command\":\"cat src/cli-exit.cts && npm run lint 2>&1 | tail -5\"},\"cwd\":\"$REAL_REPO\",\"session_id\":\"S1\"}"
# 2. ...then the SAME command with the offending fragment deleted (evasion #1).
logrun "{\"tool_name\":\"Bash\",\"tool_input\":{\"command\":\"npm run lint 2>&1 | tail -5\"},\"cwd\":\"$REAL_REPO\",\"session_id\":\"S1\"}"

if [ -f "$LOGHOME/.claude/logs/gsd-memtrace-guard.jsonl" ]; then
  pass "detection: audit log created"
  if grep -q '"event":"deny"' "$LOGHOME/.claude/logs/gsd-memtrace-guard.jsonl"; then
    pass "detection: deny recorded"
  else
    fail "detection: deny recorded" "no deny event in log"
  fi
  if grep -q '"event":"evasion_suspected"' "$LOGHOME/.claude/logs/gsd-memtrace-guard.jsonl"; then
    pass "detection: deny-then-near-identical-allow flagged"
  else
    fail "detection: deny-then-near-identical-allow flagged" "$(cat "$LOGHOME/.claude/logs/gsd-memtrace-guard.jsonl")"
  fi
else
  fail "detection: audit log created" "no log file at $LOGHOME/.claude/logs/"
fi

# An unrelated command after a deny must NOT be flagged (no alert fatigue).
LOGHOME2=$(mktemp -d)
logrun2() { printf '%s' "$1" | env -u GSD_MEMTRACE_GUARD_OFF HOME="$LOGHOME2" node "$GUARD" >/dev/null 2>&1; }
logrun2 "{\"tool_name\":\"Bash\",\"tool_input\":{\"command\":\"cat src/cli-exit.cts\"},\"cwd\":\"$REAL_REPO\",\"session_id\":\"S2\"}"
logrun2 "{\"tool_name\":\"Bash\",\"tool_input\":{\"command\":\"gh pr list --limit 5\"},\"cwd\":\"$REAL_REPO\",\"session_id\":\"S2\"}"
if grep -q '"event":"evasion_suspected"' "$LOGHOME2/.claude/logs/gsd-memtrace-guard.jsonl" 2>/dev/null; then
  fail "detection: unrelated later command NOT flagged" "false positive alert"
else
  pass "detection: unrelated later command NOT flagged"
fi

# Logging must be disable-able and must never change the DECISION.
run "{\"tool_name\":\"Bash\",\"tool_input\":{\"command\":\"cat src/cli-exit.cts\"},\"cwd\":\"$REAL_REPO\"}"
check "detection: GSD_MEMTRACE_GUARD_LOG=0 still denies normally" "$DENY_CHECK"

rm -rf "$LOGHOME" "$LOGHOME2"

########################################################################
# 1.5.1 suite (added 2026-09-10 by an independent third reviewer).
#
# WHY THIS BLOCK EXISTS: the suite above uses .cts/.cjs/.h/.c exclusively
# (61 occurrences of `.cts`, ZERO of `.swift`) against a TypeScript
# REAL_REPO. The repo this guard actually protects day-to-day is a SWIFT
# codebase. A mutant that deletes `'py','go','rs','java','kt','swift',
# 'rb','php','cs',` from SOURCE_EXTS passed the suite above 60/60
# (measured 2026-09-10) -- i.e. the suite could not see the extension it
# is supposed to protect. Every case below is parameterised over BOTH a
# TypeScript and a Swift extension so that mutant dies.
#
# It also pins the four DENY->ALLOW defects fixed in 1.5.1, each of which
# was measured on 1.5.0 (ALLOW) and on the reconstructed real 1.4.0
# (DENY) before the fix was written.
########################################################################

# runcmd <shell-command> [cwd]  -- builds the Bash payload safely.
runcmd() {
  local cmd="$1" cwd="${2:-$REAL_REPO}"
  run "$(python3 -c 'import json,sys;print(json.dumps({"tool_name":"Bash","tool_input":{"command":sys.argv[1]},"cwd":sys.argv[2]}))' "$cmd" "$cwd")"
}
runtool() { # runtool <json-tool_input> <tool_name> [cwd]
  local ti="$1" tn="$2" cwd="${3:-$REAL_REPO}"
  run "$(python3 -c 'import json,sys;print(json.dumps({"tool_name":sys.argv[2],"tool_input":json.loads(sys.argv[1]),"cwd":sys.argv[3]}))' "$ti" "$tn" "$cwd")"
}

# --- a REAL on-disk Swift repository fixture -------------------------------
# It lives under the OS temp root, so FP1 would normally exempt it; giving it
# a remote.origin.url and using it as its own cwd makes isCloneOfCurrentRepo()
# true, which is the same mechanism the HOLE B fixture above relies on.
SWIFT_REPO=$(mktemp -d)
mkdir -p "$SWIFT_REPO/Sources/App"
printf 'struct Ledger { let amount: Decimal }\n' > "$SWIFT_REPO/Sources/App/Ledger.swift"
printf '# Notes\nsee Sources/App/Ledger.swift\n'  > "$SWIFT_REPO/NOTES.md"
git -C "$SWIFT_REPO" init -q 2>/dev/null
git -C "$SWIFT_REPO" remote add origin https://example.invalid/swift-fixture.git 2>/dev/null
trap 'rm -rf "$TMPFIXTURE" "$TMPCLONE" "$SWIFT_REPO"' EXIT

echo "=== 1.5.1 Swift fixture canary ==="
# If this canary fails, the fixture is no longer visible to the guard and
# EVERY Swift case below is vacuous -- fix the fixture, do not delete the tests.
runcmd "cat Sources/App/Ledger.swift" "$SWIFT_REPO"
check "CANARY: Swift fixture repo is visible to the guard (cat <src>.swift -> deny)" "$DENY_CHECK"

echo "=== 1.5.1 parameterised over TypeScript AND Swift ==="
# EXT_PATH pairs: a source path and the prose path that must stay allowed.
for SRC in "src/cli-exit.cts" "src/Ledger.swift" "Sources/App/Ledger.swift"; do
  runcmd "cat $SRC"
  check "PARAM DENY: cat $SRC" "$DENY_CHECK"

  runcmd "grep -rn someSymbol $SRC"
  check "PARAM DENY: grep -rn someSymbol $SRC" "$DENY_CHECK"

  runcmd "sed -n '1,50p' $SRC"
  check "PARAM DENY: sed -n 1,50p $SRC" "$DENY_CHECK"

  runcmd "head -20 $SRC"
  check "PARAM DENY: head -20 $SRC" "$DENY_CHECK"

  runcmd "nl $SRC"
  check "PARAM DENY: nl $SRC" "$DENY_CHECK"

  runcmd "git show HEAD:$SRC"
  check "PARAM DENY: git show HEAD:$SRC" "$DENY_CHECK"

  runtool "{\"file_path\":\"$SRC\"}" Read
  check "PARAM DENY: Read tool on $SRC" "$DENY_CHECK"

  # R1 -- wrapper prefixes (1.5.0 ALLOWed every one; real 1.4.0 DENIED).
  for WRAP in "env" "nice" "sudo" "time" "command" "exec" "eval" "nohup" "stdbuf -o0" "watch" "xargs" "timeout 5"; do
    runcmd "$WRAP cat $SRC"
    check "R1 DENY: $WRAP cat $SRC" "$DENY_CHECK"
  done

  # R1b -- a wrapper flag taking a SEPARATE value word (`sudo -u nobody`)
  # still hid the binary after WRAPPER_WORDS alone.
  for WRAP in "sudo -u nobody" "nice -n 10" "xargs -n 1" "timeout -s KILL 5" "env -u FOO"; do
    runcmd "$WRAP cat $SRC"
    check "R1b DENY: $WRAP cat $SRC" "$DENY_CHECK"
  done

  # ...and the same wrapper in front of a NON-read command must stay allowed.
  runcmd "sudo -u nobody npm test"
  check "R1b ALLOW: sudo -u nobody npm test (no read binary)" "$ALLOW_CHECK"

  # R2 -- an EMPTY pattern let the FILE fall into the pattern slot.
  for RB in grep rg sed awk; do
    runcmd "$RB '' $SRC"
    check "R2 DENY: $RB '' $SRC (empty pattern must not eat the path)" "$DENY_CHECK"
  done

  # R3 -- input redirection.
  runcmd "< $SRC cat"
  check "R3 DENY: < $SRC cat" "$DENY_CHECK"
  runcmd "cat<$SRC"
  check "R3 DENY: cat<$SRC (no space)" "$DENY_CHECK"
  runcmd "cat < $SRC"
  check "R3 DENY: cat < $SRC (spaced)" "$DENY_CHECK"

  # B1 -- `git -C` made the -C branch unreachable, so the subcommand read
  # as `.` and 1.5.0's own git fix never fired.
  runcmd "git -C . show HEAD:$SRC"
  check "B1 DENY: git -C . show HEAD:$SRC" "$DENY_CHECK"
  runcmd "git -C . grep -n sym -- $SRC"
  check "B1 DENY: git -C . grep -- $SRC" "$DENY_CHECK"

  # --- intended ALLOWs for the same extension (overcorrection guard-rails) ---
  runcmd "wc -l $SRC"
  check "PARAM ALLOW: wc -l $SRC (file-inventory count)" "$ALLOW_CHECK"

  runcmd "git log --oneline -20 -- $SRC"
  check "PARAM ALLOW: git log -- $SRC (VCS history)" "$ALLOW_CHECK"

  runcmd "git -C . diff HEAD~1 -- $SRC"
  check "PARAM ALLOW: git -C . diff -- $SRC (VCS history, -C skipped correctly)" "$ALLOW_CHECK"

  runcmd "grep -n '$SRC' package.json"
  check "PARAM ALLOW: grep -n '$SRC' package.json (path is the PATTERN)" "$ALLOW_CHECK"

  runcmd "echo 'see $SRC' >> notes.md && cat notes.md"
  check "PARAM ALLOW: append prose naming $SRC, read the .md" "$ALLOW_CHECK"

  runcmd "npm run build > $SRC.log 2>&1"
  check "PARAM ALLOW: output redirect is a write, not a read" "$ALLOW_CHECK"
done

echo "=== 1.5.1 Swift tool-input shapes ==="
runtool '{"pattern":"**/*.swift"}' Glob
check "SWIFT HOLE C: Glob tool pattern '**/*.swift' -> deny" "$DENY_CHECK"

runtool '{"pattern":"x","glob":"*.swift","path":"Sources"}' Grep
check "SWIFT: Grep glob '*.swift' -> deny" "$DENY_CHECK"

runtool '{"pattern":"x","glob":"{*.swift,*.md}","path":"Sources"}' Grep
check "SWIFT HOLE D: Grep brace glob '{*.swift,*.md}' -> deny" "$DENY_CHECK"

runtool '{"pattern":"x","type":"swift","path":"Sources"}' Grep
check "SWIFT: Grep type 'swift' -> deny" "$DENY_CHECK"

runtool '{"pattern":"x","glob":"*.md","path":"Sources"}' Grep
check "SWIFT ALLOW: Grep glob '*.md' (prose) -> allow" "$ALLOW_CHECK"

runtool "{\"file_path\":\"$SWIFT_REPO/NOTES.md\"}" Read "$SWIFT_REPO"
check "SWIFT ALLOW: Read prose .md in the Swift repo -> allow" "$ALLOW_CHECK"

runcmd "cat NOTES.md" "$SWIFT_REPO"
check "SWIFT ALLOW: cat NOTES.md whose TEXT names a .swift file -> allow" "$ALLOW_CHECK"

echo "=== 1.5.1 KNOWN GAP, Swift (pinned; do NOT silently change) ==="
# Same product decision as the .cts pin above: an unrestricted Grep over a
# source DIRECTORY is still ALLOWED. Adversary #1 left it deliberately;
# adversary #2 proposed denying only output_mode=="content". Pinned in BOTH
# output modes so either future decision shows up as a deliberate test edit.
runtool '{"pattern":"someSymbol","path":"Sources"}' Grep "$SWIFT_REPO"
check "KNOWN GAP (swift): unrestricted Grep over a source dir is ALLOWED" "$ALLOW_CHECK"

runtool '{"pattern":"someSymbol","path":"Sources","output_mode":"content"}' Grep "$SWIFT_REPO"
check "KNOWN GAP (swift): Grep output_mode=content over a source dir is ALLOWED" "$ALLOW_CHECK"

runtool '{"pattern":"someSymbol","path":"Sources","output_mode":"files_with_matches"}' Grep "$SWIFT_REPO"
check "KNOWN GAP (swift): Grep output_mode=files_with_matches over a source dir is ALLOWED" "$ALLOW_CHECK"

echo
echo "gsd-memtrace-first-guard suite: $((N-F))/$N passed"
[ $F -eq 0 ] && exit 0 || exit 1
