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

Registered at **user** scope (cross-project policy):

    gsd-memtrace-first-guard.cjs          Read|Grep|Glob|Bash
    gsd-no-defer-guard.js                 Bash|mcp__ccd_session__spawn_task
    gsd-tier-guard.cjs                    Write|Edit|MultiEdit
    gsd-block-timeout-increase-guard.cjs  Write|Edit|MultiEdit
    zsh-guard.cjs                         Bash
    gsd-claudemd-symlink.sh               SessionStart
    gsd-session-model.cjs                 SessionStart

Registered at **gsd-core project** scope (`~/projects/gsd-core/.claude/settings.json`)
because they encode that repo's workflow and were previously firing everywhere:

    gsd-measure-dont-infer-guard.cjs      Bash
    gsd-block-ci-rerun-guard.cjs          Bash
    gsd-worktree-guard.cjs                Write|Edit|MultiEdit
    gsd-agent-dispatch-guard.cjs          Agent
    gsd-run-incomplete-guard.cjs          Stop
    gsd-subagent-output-cap.cjs           SubagentStop

## Tests

Three guards ship regression suites; run them after any edit — a hook that silently
stops denying is worse than no hook:

```bash
cd ~/.claude/hooks
./gsd-memtrace-first-guard.test.sh      # 191 cases
./gsd-tier-guard.test.sh                #  49 cases
./gsd-measure-dont-infer-guard.test.sh  #  66 cases
```

## Restoring

Pre-symlink originals are preserved in timestamped `.pre-symlink-backup-*/` directories
under `~/.claude/hooks/`, and prior settings in `settings.json.bak.pre-scope-demote-*`.
