# gsd-core-hooks

> A rule an agent can read once and forget is not enforced.

The `.claude/hooks/` suite from one real project, copied as-is. Fourteen scripts, each written to
close one specific incident (named, dated, in its own header comment) rather than designed
speculatively. Full rationale: [`SKILL.md`](SKILL.md).

**These are not generic** — same caveat as [`../commands/README.md`](../commands/README.md), and
for the same reason: written against one project's toolchain, not a drop-in. Read "What to adapt"
below before installing.

## What you get

```
gsd-core-hooks/
├── SKILL.md                          rationale, the three failure classes, when to use vs. artifact-gates/
├── README.md                         this file
└── hooks/
    ├── pre-pr-gate.sh                 PreToolUse(Bash)      — blocks push/PR unless THIS sha has a recorded passing verdict
    ├── record-gsd-verdict.sh          PostToolUse(Bash)     — the one sanctioned writer of that verdict, from a real gsd-test verdict line
    ├── gsd-verify-and-record.cjs      manual CLI            — spawns gsd-test itself and records a pass; works around sub-agent/backgrounded runs never reaching the PostToolUse hook
    ├── gsd-test-clean-tree-guard.sh   PreToolUse(Bash)      — denies a gsd-test dispatch against a dirty working tree (gsd-test is ref-based; uncommitted changes are never tested)
    ├── gsd-test-single-flight-guard.sh PreToolUse(Bash)     — denies a second gsd-test/verify-and-record dispatch while this worktree has one in flight
    ├── gsd-async-poll-guard.sh        PreToolUse(Bash)      — denies dispatching a long remote run through the tool harness's own background/timeout knobs (they silently kill at ~600s with no verdict)
    ├── gsd-bench-pin-guard.sh         PreToolUse(Bash)      — denies a gsd-test/verify-and-record dispatch that omits an explicit bench pin (unpinned runs pile onto one shared box)
    ├── gsd-foreground-poll-guard.sh   PreToolUse(Bash)      — denies a foreground `while`/`until` poll loop with a long sleep (dies at the harness ceiling, indistinguishable from the watched job failing)
    ├── gsd-pgrep-waiter-guard.sh      PreToolUse(Bash\|Monitor) — denies a `pgrep -f "<cmd>"` wait-loop whose own argv matches its search pattern (never terminates)
    ├── block-local-node-test.sh       PreToolUse(Bash)      — hard-denies local `node --test` / `npm test` (orphans the workstation; route through the remote runner)
    ├── require-memtrace-evidence.sh   PreToolUse(Bash)      — blocks `gh pr review --approve/--request-changes` unless the review body documents which Memtrace tools were actually called
    ├── gsd-phase-gate.cjs             PreToolUse(Edit\|Write\|Bash) — the project-specific artifact gate this repo's `artifact-gates/` engine was generalized from (see the note below)
    ├── emitted-cjs-read-guard.cjs     PreToolUse(Read\|Edit\|Write\|NotebookEdit) — denies reading/editing tsc-emitted `.cjs` output instead of its authored `.cts` source
    ├── worktree-fresh-base-guard.sh   PreToolUse(Bash\|EnterWorktree) — denies creating/entering a worktree branched off a stale base
    └── lib/prune-gsd-passes.cjs       library used by the pass-marker gate to garbage-collect stale per-sha markers (bounded growth — 906 markers observed after ~37 days unpruned)
```

## Install

```bash
mkdir -p ~/.claude/hooks
cp gsd-core-hooks/hooks/*.sh gsd-core-hooks/hooks/*.cjs ~/.claude/hooks/
mkdir -p ~/.claude/hooks/lib
cp gsd-core-hooks/hooks/lib/*.cjs ~/.claude/hooks/lib/
chmod +x ~/.claude/hooks/*.sh ~/.claude/hooks/*.cjs
```

Register the ones you actually want in `settings.json` (`~/.claude/settings.json` for all projects,
or `<repo>/.claude/settings.json` for one). This is the full wiring from the source project — trim
to what applies to yours:

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          { "type": "command", "command": "~/.claude/hooks/pre-pr-gate.sh", "timeout": 10 },
          { "type": "command", "command": "~/.claude/hooks/require-memtrace-evidence.sh", "timeout": 10 },
          { "type": "command", "command": "~/.claude/hooks/gsd-test-clean-tree-guard.sh", "timeout": 10 },
          { "type": "command", "command": "~/.claude/hooks/gsd-test-single-flight-guard.sh" },
          { "type": "command", "command": "~/.claude/hooks/gsd-async-poll-guard.sh", "timeout": 10 },
          { "type": "command", "command": "~/.claude/hooks/gsd-bench-pin-guard.sh", "timeout": 10 },
          { "type": "command", "command": "~/.claude/hooks/gsd-pgrep-waiter-guard.sh", "timeout": 10 },
          { "type": "command", "command": "~/.claude/hooks/gsd-foreground-poll-guard.sh", "timeout": 10 },
          { "type": "command", "command": "~/.claude/hooks/block-local-node-test.sh", "timeout": 10 },
          { "type": "command", "command": "node ~/.claude/hooks/gsd-phase-gate.cjs" }
        ]
      },
      {
        "matcher": "Monitor",
        "hooks": [{ "type": "command", "command": "~/.claude/hooks/gsd-pgrep-waiter-guard.sh", "timeout": 10 }]
      },
      {
        "matcher": "Edit|Write|NotebookEdit",
        "hooks": [{ "type": "command", "command": "node ~/.claude/hooks/gsd-phase-gate.cjs" }]
      },
      {
        "matcher": "Read|Edit|Write|NotebookEdit",
        "hooks": [{ "type": "command", "command": "node ~/.claude/hooks/emitted-cjs-read-guard.cjs" }]
      }
    ],
    "PostToolUse": [
      {
        "matcher": "Bash",
        "hooks": [{ "type": "command", "command": "~/.claude/hooks/record-gsd-verdict.sh", "timeout": 10 }]
      }
    ]
  }
}
```

> Some Claude Code versions do not expand `~` in hook commands — use an absolute path if a hook
> seems inert, and confirm by deliberately triggering one (e.g. try `node --test` locally after
> installing `block-local-node-test.sh`) rather than trusting silence.

Restart Claude Code.

## What to adapt

Every hook here assumes pieces of gsd-core's specific toolchain. At minimum:

- **The test runner.** `pre-pr-gate.sh`, `record-gsd-verdict.sh`, `gsd-verify-and-record.cjs`,
  `gsd-test-clean-tree-guard.sh`, `gsd-test-single-flight-guard.sh`, `gsd-async-poll-guard.sh`, and
  `gsd-bench-pin-guard.sh` all key on a remote dockerized runner called `gsd-test`, its
  `{"type":"verdict","outcome":"passed"}` line, and a per-sha pass-marker file. Substitute your own
  runner and its own "this pass belongs to this sha" binding — that binding is the part that
  matters, not the specific tool.
- **Memtrace.** `require-memtrace-evidence.sh` assumes the Memtrace MCP server is installed and
  indexing your repo. Without it, either point it at your own code-discovery tool or drop it — a
  guard that demands a tool you don't have just denies everything.
  The Memtrace-first *code-discovery* guard that used to live here was **removed**: it is not
  specific to this project, and a second, more complete implementation of the same rule already
  ships as global policy in [`../claude-guards/`](../claude-guards/), as
  `memtrace-first-guard.cjs`. Two copies of one rule under one name is a trap, not redundancy.
- **The build pipeline.** `emitted-cjs-read-guard.cjs` is specific to one repo's `.cts` → `.cjs` tsc
  output convention (ADR-457 in the source project). Drop it unless you have an analogous
  generated-file trap.
- **`gsd-phase-gate.cjs` vs. `artifact-gates/`.** This file is the original, project-specific
  8-step contract (`/rubber-duck`, `/grilling`, `/skills-from-the-artificer`, `/qa-test-architect`,
  `/tdd`, `/code-review`, `/writing-documentation-with-diataxis`, `/ci-preflight`) that
  [`../artifact-gates/`](../artifact-gates/)'s config-driven engine was generalized from. **Installing
  both wires two independent gates to the same `Edit|Write|Bash` matchers.** Use `artifact-gates/`
  for a new project; keep this file only if you specifically want gsd-core's exact contract as a
  reference to copy from, not to run alongside the generalized one.
- **The harness-ceiling guards are host-behavior facts, not project facts** — `gsd-async-poll-guard.sh`,
  `gsd-foreground-poll-guard.sh`, and `gsd-pgrep-waiter-guard.sh` describe the tool harness's own
  timeout ceiling (documented at ~600000ms in the source incidents), which may differ or not apply
  outside Claude Code. Verify the ceiling for your harness before trusting the exact numbers in the
  header comments.
- **`gsd-verify-and-record.cjs` is explicitly local-only tooling** — its own header says it
  "partners with the local push/PR gate and is intentionally NOT part of the shipped repo" it came
  from, since the gate it feeds (`.gsd/last-pass.json` / the per-sha marker directory) is local
  infra. It is included here for completeness and as a reference implementation of the
  foreground-capture workaround it solves — expect to rewrite it against your own runner rather than
  running it unedited.

## Uninstall

```bash
rm -rf ~/.claude/hooks   # or remove individual files
# then remove the corresponding entries from settings.json
```

## License

MIT, same as the rest of the repo.
