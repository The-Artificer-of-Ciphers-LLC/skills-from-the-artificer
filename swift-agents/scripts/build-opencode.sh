#!/usr/bin/env bash
# Generate opencode agent files from the canonical Claude agents in ../agents/.
#
# Why separate files: Claude's `tools:` is a list and `name:` is explicit; opencode
# wants a `tools`/`permission` map, derives the name from the filename, and passes
# unknown frontmatter keys through to the provider as model options. The body (the
# actual instructions) is byte-identical; only the frontmatter is translated.
#
#   Claude tools list          -> opencode permission
#   no Edit/Write              -> edit: deny
#   Task present               -> mode: all  (orchestrator; usable as a primary agent)
#   otherwise                  -> mode: subagent
#   bash is never granted      -> bash: deny
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
mkdir -p "$here/opencode/agents"
for f in "$here"/agents/*.md; do
  n="$(basename "$f")"
  awk '
    NR==1 && $0=="---" { infm=1; next }
    infm && $0=="---" { infm=0; body=1; next }
    infm {
      if ($0 ~ /^description:/) { indesc=1; desc=$0; next }
      if ($0 ~ /^tools:/)       { indesc=0; intools=1; next }
      if ($0 ~ /^[A-Za-z_-]+:/) { indesc=0; intools=0; next }
      if (indesc)  { desc=desc "\n" $0 }
      if (intools && $0 ~ /^  - /) { t=$0; sub(/^  - /,"",t); tools[t]=1 }
      next
    }
    body { rest = rest $0 "\n" }
    END {
      printf "---\n%s\n", desc
      printf "mode: %s\n", ("Task" in tools) ? "all" : "subagent"
      printf "permission:\n"
      printf "  edit: %s\n", (("Edit" in tools)||("Write" in tools)) ? "allow" : "deny"
      printf "  bash: deny\n"
      printf "---\n%s", rest
    }' "$f" > "$here/opencode/agents/$n"
done
echo "built $(ls "$here"/opencode/agents/*.md | wc -l | tr -d ' ') opencode agents"
