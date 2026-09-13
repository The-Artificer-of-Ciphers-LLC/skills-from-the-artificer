# claude-guards

Personal Claude Code guard hooks, kept under version control here and symlinked into
`~/.claude/hooks/`. Canonical copies live in this repo; `~/.claude/hooks/<name>` is a
symlink pointing back at `claude-guards/hooks/<name>`.

Distinct from [`../gsd-core-hooks/`](../gsd-core-hooks/), which is a packaged, published
skill documenting one project's suite. This folder is personal tooling — not a skill,
not packaged, no SKILL.md.

## Scope is settings.json, not the file

Claude Code has no per-repo hook matcher. A hook fires in whichever projects the
`settings.json` that *registers* it applies to:

| Registered in | Fires in |
|---|---|
| `~/.claude/settings.json` | every project |
| `<repo>/.claude/settings.json` | that repo only |

So all guards live together in `hooks/` and scope is expressed purely by which
settings file names them. Moving a guard between scopes is a settings edit — never a
file move.

### Current split

These are **global policy**, not one project's workflow — so they are registered at
**user** scope (`~/.claude/settings.json`) and carry no `gsd-` prefix:

    memtrace-first-guard.cjs              Read|Grep|Glob|Bash
    no-defer-guard.js                     Bash|mcp__ccd_session__spawn_task
    tier-guard.cjs                        Write|Edit|MultiEdit
    block-timeout-increase-guard.cjs      Write|Edit|MultiEdit
    measure-dont-infer-guard.cjs          Bash
    block-ci-rerun-guard.cjs              Bash
    worktree-guard.cjs                    Write|Edit|MultiEdit
    agent-dispatch-guard.cjs              Agent
    run-incomplete-guard.cjs              Stop
    subagent-output-cap.cjs               SubagentStop
    zsh-guard.cjs                         Bash
    session-model.cjs                     SessionStart

One hook keeps the prefix because it genuinely *is* gsd-core-specific — it hardcodes
that repo's `CLAUDE.md` path and no-ops everywhere else:

    gsd-claudemd-symlink.sh               SessionStart

`run-incomplete-guard.cjs` reads `.gsd/` lane artifacts, but the lanes it guards
(`bug-fixer`, `feature-builder`, `triage`) are global skills usable in any repo, and it
fails open where those artifacts don't exist — so it belongs at user scope too.

The `gsd-` prefix is also the GSD product's own namespace in `~/.claude/hooks/`
(`gsd-statusline.js`, `gsd-workflow-guard.js`, …, installed by GSD itself). Personal
guards squatting that prefix risked being overwritten by a GSD update.

### Names that stayed

Escape-hatch env vars (`GSD_WORKTREE_GUARD_OFF`, `GSD_MEASURE_GUARD_OFF`,
`GSD_MEMTRACE_GUARD_OFF`, the `GSD_TIER_GUARD*` family) and on-disk state paths
(`~/.claude/state/gsd-tier/`, `.gsd/main-checkout-ok`) were **not** renamed. Those are
live contracts — an exported bypass in your shell rc or a committed marker in another
repo would silently stop working.

## Tests

Three guards ship regression suites; run them after any edit — a hook that silently
stops denying is worse than no hook:

```bash
cd ~/.claude/hooks
./memtrace-first-guard.test.sh      # 199 cases
./tier-guard.test.sh                #  49 cases
./measure-dont-infer-guard.test.sh  #  66 cases
```

## Restoring

Pre-symlink originals are preserved in timestamped `.pre-symlink-backup-*/` directories
under `~/.claude/hooks/`, and prior settings in `settings.json.bak.pre-scope-demote-*`.
