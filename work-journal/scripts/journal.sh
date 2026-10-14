#!/usr/bin/env bash
# Per-branch append-only work journal.
# Usage: journal.sh add            (entry body on stdin)
#        journal.sh tail [N]       (last N entries, default 5)
set -euo pipefail

common="$(git rev-parse --git-common-dir)"
branch="$(git rev-parse --abbrev-ref HEAD)"
dir="$common/work-journal"
file="$dir/${branch//\//-}.md"

case "${1:-}" in
  add)
    mkdir -p "$dir"
    body="$(cat)"
    [ -n "$body" ] || { echo "journal.sh: empty entry" >&2; exit 1; }
    sha="$(git rev-parse --short HEAD 2>/dev/null || echo none)"
    {
      printf '\n## %s | %s | %s\n\n' "$(date '+%Y-%m-%d %H:%M')" "$branch" "$sha"
      printf '%s\n' "$body"
    } >> "$file"
    echo "journal: appended to $file"
    ;;
  tail)
    n="${2:-5}"
    [ -f "$file" ] || { echo "journal: no entries for $branch"; exit 0; }
    awk -v n="$n" '
      /^## / { c++ }
      { lines[NR] = $0; idx[NR] = c }
      END { for (i = 1; i <= NR; i++) if (idx[i] > c - n) print lines[i] }
    ' "$file"
    ;;
  *)
    echo "usage: journal.sh add | tail [N]" >&2
    exit 2
    ;;
esac
