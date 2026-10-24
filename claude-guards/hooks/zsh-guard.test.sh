#!/usr/bin/env bash
# Behavioral regression suite for zsh-guard.cjs.
#   bash ~/.claude/hooks/zsh-guard.test.sh
set -uo pipefail
cd "$(dirname "$0")" || exit 1
GUARD=./zsh-guard.cjs
N=0; F=0
pass() { N=$((N+1)); echo "PASS  $1"; }
fail() { N=$((N+1)); F=$((F+1)); echo "FAIL  $1 -> $2"; }

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
mkdir -p "$WORK/present"; : > "$WORK/present/a.md"

# run <command> -> sets OUT (stdout JSON) ; payload built by node, cwd=$WORK
run() {
  OUT=$(node -e '
    const [command, cwd] = process.argv.slice(1);
    process.stdout.write(JSON.stringify({ tool_name: "Bash", cwd, tool_input: { command } }));
  ' "$1" "$WORK" | node "$GUARD" 2>&1)
}
decision() { node -e 'try{const o=JSON.parse(process.argv[1]).hookSpecificOutput;process.stdout.write(o.permissionDecision)}catch{process.stdout.write("none")}' "$OUT"; }
rewritten() { node -e 'try{process.stdout.write(JSON.parse(process.argv[1]).hookSpecificOutput.updatedInput.command)}catch{}' "$OUT"; }

deny() { run "$2"; [ "$(decision)" = deny ] && pass "$1" || fail "$1" "expected deny, got [$OUT]"; }
allow() { run "$2"; [ "$(decision)" = none ] && pass "$1" || fail "$1" "expected silent allow, got [$OUT]"; }
fix() {
  run "$2"
  if [ "$(decision)" = allow ] && [ "$(rewritten)" = "$3" ]; then pass "$1"; else fail "$1" "expected rewrite to [$3], got [$OUT]"; fi
}

# 1 for-loop word splitting
deny  "for over bare var"          'V=$(ls); for x in $V; do echo $x; done'
allow "for over split var"         'V=$(ls); for x in ${=V}; do echo $x; done'
# 2 flag glob auto-quote (rewrite, not deny)
fix   "--include glob auto-quoted" "grep -rn foo . --include=*.md" "grep -rn foo . --include='*.md'"
fix   "-name glob auto-quoted"     "find . -name *.cjs" "find . -name '*.cjs'"
allow "--include already quoted"   "grep -rn foo . --include='*.md'"
# 3 NOMATCH on file args
deny  "rm literal glob no match"   'rm -rf archive-*'
allow "ls literal glob matches"    'ls present/*.md'
allow "rm glob with (N)"           'rm -rf archive-*(N)'
deny  "rm var-prefixed glob"       'T=/x; rm -rf -- "$T"/archive-*'
allow "ls var-prefixed glob"       'T=/x; ls "$T"/archive-*'
allow "glob inside [[ ]]"          '[[ $f == *.md ]] && echo y'
allow "quoted glob arg"            "ls 'archive-*'"
allow "case pattern"               'case $f in *.md) echo md;; esac'
# 4 /usr/bin
deny  "/usr/bin/cat"               '/usr/bin/cat foo'
allow "/bin/cat"                   '/bin/cat foo'
# 5 bash-only
deny  "BASH_REMATCH"               '[[ abc =~ (b) ]]; echo ${BASH_REMATCH[1]}'
deny  "declare -A"                 'declare -A m; m[a]=1'
deny  "lowercase expansion"        'v=ABC; echo ${v,,}'
deny  "indirect expansion"         'n=HOME; echo ${!n}'
deny  "read -a"                    'read -a arr <<< "a b"'
deny  "BASH_SOURCE"                'echo ${BASH_SOURCE[0]}'
allow "bash -c reexec"             "bash -c 'declare -A m; m[a]=1'"
# 6 GNU userland
deny  "sed -i no suffix"           "sed -i 's/a/b/' f.txt"
deny  "sed -i -e"                  "sed -i -e 's/a/b/' f.txt"
allow "sed -i empty suffix"        "sed -i '' 's/a/b/' f.txt"
allow "sed -i.bak"                 "sed -i.bak 's/a/b/' f.txt"
deny  "grep -P"                    "grep -P '\\d+' f.txt"
deny  "date -d"                    'date -d yesterday +%F'
deny  "xargs -r"                   'ls | xargs -r rm'
deny  "stat -c"                    'stat -c %Y f'
deny  "find -printf"               "find . -printf '%p\\n'"
# heredoc + quoted mentions never trigger
allow "heredoc body ignored"       $'cat <<\'EOF\'\nsed -i foo\ndeclare -A x\nEOF'
allow "quoted mention ignored"     "echo 'use sed -i here and declare -A'"
allow "plain command"              'git status --short'

echo "---"; echo "$((N-F))/$N passed"
[ "$F" = 0 ]
