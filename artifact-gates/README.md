# artifact-gates

> A step that produces no artifact cannot be enforced, and will be skipped.

Turns the blocking steps of a workflow directive into **preconditions**: each step writes a file,
and the next action is denied until that file exists. Ships a config-driven PreToolUse hook, two
example contracts, and a 69-case behavioral test suite.

Full rationale, contract schema, and design guidance: [`SKILL.md`](SKILL.md).

## What you get

```
artifact-gates/
├── SKILL.md                      the pattern — when to reach for it, how to design a contract
├── hooks/artifact-gate.cjs       the engine (Node, no dependencies)
├── contracts/minimal.json        starter: one family, design → tests → review
├── contracts/full-example.json   three families, incl. contents-checked merge policy
└── test/gate-test.sh             58 behavioral cases against the real hook
```

## Install

Three steps. The skill alone is inert — the hook is what enforces anything.

### 1. Install the skill

```bash
npx skills add The-Artificer-of-Ciphers-LLC/skills-from-the-artificer -g --skill artifact-gates
```

Or manually:

```bash
mkdir -p ~/.claude/skills/artifact-gates
cp SKILL.md ~/.claude/skills/artifact-gates/
```

### 2. Install the hook

```bash
mkdir -p ~/.claude/hooks
cp hooks/artifact-gate.cjs ~/.claude/hooks/
```

### 3. Register it in `settings.json`

Both matchers are required — one gates file edits, the other gates commands. Use
`~/.claude/settings.json` for all projects, or `<repo>/.claude/settings.json` for one.

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Edit|Write|NotebookEdit",
        "hooks": [{ "type": "command", "command": "node ~/.claude/hooks/artifact-gate.cjs" }]
      },
      {
        "matcher": "Bash",
        "hooks": [{ "type": "command", "command": "node ~/.claude/hooks/artifact-gate.cjs" }]
      }
    ]
  }
}
```

> Some Claude Code versions do not expand `~` in hook commands. If the gate seems inert, use the
> absolute path (`/Users/you/.claude/hooks/artifact-gate.cjs`) — and see *Verify the install* below,
> because a hook that silently does nothing is the one failure this whole tool exists to prevent.

Restart Claude Code.

### 4. Adopt it in a repo

```bash
cp contracts/minimal.json /path/to/repo/.artifact-gate.json
```

Nothing is enforced yet. A family activates only when its **arm file** exists, so ordinary work in
the repo is untouched until a directive run starts one:

```bash
mkdir -p .workflow/$(git rev-parse --abbrev-ref HEAD | tr -c 'A-Za-z0-9._-' '-')
echo '{"started":"'"$(date -u +%FT%TZ)"'"}' > .workflow/<slug>/00-run.json
```

From that point, editing `src/**` requires `10-design.md`, editing tests requires
`20-test-matrix.md`, and `git push` requires `30-review.json`.

Add `.workflow/` (or whatever `dir` you chose) to `.gitignore` if the artifacts are working
records rather than something you want reviewed. Committing them is also a legitimate choice —
they make a PR's reasoning auditable.

## Verify the install

Run the suite against the shipped engine — it uses a throwaway git repo and touches nothing else:

```bash
bash test/gate-test.sh
```

Expect `PASS=58 FAIL=0`. Then confirm the hook is actually wired into *your* session by arming a
family and trying a gated edit — a hook registered with a wrong path fails open silently, and it
looks exactly like a hook that is working and has nothing to complain about.

## Writing your own contract

Read [`SKILL.md`](SKILL.md) — particularly the three questions, which decide where the gates go.
The short version:

1. **What does this workflow actually skip?** Go look at a real run. Do not copy someone else's
   artifact set; you will end up guarding things that were never at risk.
2. **What is the highest-consequence action?** Gate that one, not the convenient one.
3. **Would someone switch this off within a week?** If yes it is too broad. A disabled gate
   enforces nothing.

`contracts/full-example.json` shows the harder cases: per-issue artifacts keyed by a value captured
out of the command, a repo-scoped family with an explicit disarm, and content assertions that turn
merge policy — *admin-merge may bypass a missing reviewer, never a red CI or a conflict* — into
something checked rather than remembered.

## Uninstall

```bash
rm -rf ~/.claude/skills/artifact-gates ~/.claude/hooks/artifact-gate.cjs
# then remove the two PreToolUse entries from settings.json
```

Per-repo, deleting `.artifact-gate.json` is enough — with no contract the hook allows everything.

## License

MIT, same as the rest of the repo.
