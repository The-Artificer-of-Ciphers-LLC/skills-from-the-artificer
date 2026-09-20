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
    worktree-reap.sh                      PostToolUse:Bash + SessionStart
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

## This repo is exempt from worktree-guard

`worktree-guard.cjs` denies code writes in a main checkout, and it is registered at user
scope, so it fires here too. This repo commits `.gsd/main-checkout-ok` to opt out.

That is not a convenience. The guard's premise is that agentic coding belongs in a linked
worktree because `/security-review`, the push gate, and Memtrace's overlay all resolve
against the session cwd. That premise holds for a repo whose code is the product. It does
not hold here, where the tracked files *are* the hooks and editing them is inherently
main-checkout work — a worktree copy would test a symlink target that nothing points at.

The marker is preferred over the `GSD_WORKTREE_GUARD_OFF` env bypass for the reason the
guard's own header gives: a committed marker is version-controlled, scoped to one repo, and
visible in review, whereas an exported env var silently covers every sibling repo in that
shell.

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

Every change to these hooks leaves a timestamped backup. To undo one, copy the relevant
file back and restart Claude Code.

| To undo | Restore from |
|---|---|
| The symlinking itself | `~/.claude/hooks/.pre-symlink-backup-*/` |
| The user -> gsd-core scope demotion | `~/.claude/settings.json.bak.pre-scope-demote-*` |
| The un-prefix + re-globalize | `~/.claude/settings.json.bak.pre-unprefix-*` and `~/projects/gsd-core/.claude/settings.json.bak.pre-unprefix-*` |

The un-prefix backups come in a matching pair — that change edited both settings files, so
restoring only one leaves a guard registered at both scopes or at neither.

## worktree-reap.sh — housekeeping, not a guard

The only entry here that does not BLOCK anything. Agent worktrees under
`<repo>/.claude/worktrees/` accumulate forever: each one is a full checkout, and any
tool that indexes per-directory (Memtrace, for one) will happily index each as a
separate repository. One real case reached 22 stale worktree-scoped repo IDs holding
75% of the nodes in a 34 GB index.

It removes a worktree only when ALL THREE hold:

1. its branch is fully merged into the default branch, AND
2. its working tree is clean, AND
3. it is not locked

and only for worktrees under `<repo>/.claude/worktrees/`, so hand-made worktrees
elsewhere are out of range. It uses `git worktree remove` and `git branch -d` — never
the `--force`/`-D` variants — so git itself refuses to discard unmerged work even if
the predicate were wrong. It always exits 0: a hook that blocks your `git merge` is
worse than the stale worktree it was cleaning up.

`WORKTREE_REAP_DRYRUN=1` prints what it would remove and touches nothing. Run that
first in any repo — verify the selection against `git worktree list` before letting it
act. Reaped worktrees are appended to `~/.claude/hooks/worktree-reap.log` (last 500
lines kept).

Registered async so it cannot stall a merge. Note that the `if: "Bash(git merge*)"`
filter has been observed firing on non-merge Bash calls; the script is idempotent and
cheap, so this is wasteful rather than harmful, but do not rely on the filter for
correctness.
