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
./tier-guard.test.sh                #  54 cases (also covers agent-dispatch-guard)
./measure-dont-infer-guard.test.sh  #  66 cases
```

## Memtrace quota fallback

Memtrace reports an exhausted quota as a normal (non-error) result. Three pieces turn that
into a cooldown that routes agents to CodeGraph and says when Memtrace returns:

    memtrace-quota-watch.cjs     PostToolUse + PostToolUseFailure  mcp__memtrace__.*
    memtrace-quota-gate.cjs      PreToolUse                        mcp__memtrace__.*
    memtrace-quota-state.cjs     shared state (not a hook)

The watch records the cooldown and injects the CodeGraph route plus the return time. A
normal Memtrace answer clears it. The gate denies billed Memtrace calls while the cooldown
is live, except the unbilled `list_indexed_repositories`, `get_repository_stats`,
`get_directory_tree`, any `fleet_*`, and one serialized probe once `probeAfter` passes
(`probeDue()` then `claimProbe()`; failed probes back off 15 min, 30 min, ... up to 4 h).
Escape hatch: `GSD_MEMTRACE_QUOTA_GATE=off`. All three fail open.

State file `~/.claude/state/memtrace-quota.json` (override `MEMTRACE_QUOTA_STATE`):
`{v, blocked, reason, ts, until, untilSource, probeAfter, probes, plan?, upgradeUrl?, monthlyUsed?, monthlyLimit?}`

| reason | until | untilSource |
|---|---|---|
| monthly | `quota.periodEnd`, capped at 24 h | periodEnd (else now+1 h, fallback) |
| daily (`throttleMode` or "Daily ..." message) | next UTC midnight | nextUtcMidnight |
| auth ("Authentication expired") / unreachable | now+5 min | fallback |

Tests: `memtrace-quota-state.test.sh`, `memtrace-quota-gate.test.sh`,
`guard-denial-breaker.test.sh`.

## agent-dispatch-guard.cjs

Runs on every `Agent` call (PreToolUse). It does three independent jobs.

| Job | Trigger | Result |
|---|---|---|
| A | `subagent_type` is `general-purpose`, `claude`, `explore`, `plan` or empty, and `model` is omitted | Deny. These types inherit the parent's model, so omitting it silently buys the parent's tier. |
| C | Same types, `model` is `opus`, and the prompt has no `OPUS-JUSTIFIED:` line | Deny. Job A proves a model was chosen; job C checks the choice is defended. |
| B | Any call that was not denied | Allow, and append a return contract (a line budget for the reply) to the prompt. |

A justification counts when text follows `OPUS-JUSTIFIED:` on the same line and is at
least 10 characters long. Named agents such as `sonnet-coder` pin their own model and
are never subject to jobs A or C.

Tier guidance used by the deny messages: `haiku` for mechanical search, IO and counting;
`sonnet` for coding, editing, fixing, review and operational sequences; `opus` for
architecture and ambiguous cross-codebase design only.

| Environment variable | Effect |
|---|---|
| `GSD_DISPATCH_GUARD=off` | Disable all three jobs. |
| `GSD_DISPATCH_OPUS_GUARD=off` | Disable job C only. |
| `GSD_DISPATCH_INHERIT_TYPES` | Comma-separated extra types treated as inheriting. |
| `GSD_DISPATCH_RETURN_LINES` | Override the return-contract line budget. |

### Why job C exists

Job A was added so that nobody pays opus rates by accident. It did not stop anyone paying
them on purpose: passing `model: "opus"` satisfied the check, and a coding task was
dispatched to opus that way. A guard that only asks "was a model named?" cannot tell a
considered choice from a copied one. Job C moves the burden onto the caller: opus stays
available, but the caller must write down why sonnet is not enough, which is usually
enough to make them pick sonnet.

### How to dispatch an opus subagent when you need one

1. Confirm the work is design or cross-codebase synthesis, not implementation of a
   settled design.
2. Set `model: "opus"` on the call.
3. Add a line to the prompt: `OPUS-JUSTIFIED: <why sonnet is not enough>`.
4. If the guard still denies, the reason after the marker is shorter than 10
   characters. Write a real reason, or switch to `sonnet`.

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

### What "landed" means

A branch is cleaned up only once its work has landed in the default branch, by either route:

| Route | Test | Why it exists |
|---|---|---|
| `ancestor` | the branch tip is an ancestor of `main` | plain merges and fast-forwards |
| `squash` | GitHub reports a MERGED PR for the branch whose **head SHA equals the local tip** (pushed, nothing added since), whose **base is the default branch**, and whose **merge commit is already in local `main`** | squash merges, where `is-ancestor` is always false because the commits are rewritten |

The original hook had only the `ancestor` test, so in a squash-merging repo it could never
reap anything and every agent worktree and feature branch piled up. Stacked PRs are handled
conservatively: a PR merged into another feature branch (not `main`) does not count, so
intermediate stack branches are left until the final PR lands.

### What it removes

- **Worktrees** under `<repo>/.claude/worktrees/` when the branch has landed AND the tree is
  clean AND it is not locked AND it is not in use (a live process cwd inside it, or
  HEAD/index/logs touched within `WORKTREE_REAP_MIN_AGE_SECONDS`, default 86400). Never the
  main checkout, a detached-HEAD worktree, or the default branch. It also works when the
  triggering command ran inside a linked worktree, where it acts on the main checkout's view.
- **Local branches** that have landed, are not the default branch, and are not checked out in
  any worktree. An `ancestor` branch must also be older than the minimum age so a brand-new
  empty branch is not mistaken for finished work.
- **Remote branches**: opt-in only (`WORKTREE_REAP_REMOTE=1`). Deleted only if the remote tip
  equals the local tip and no OPEN PR is based on the branch (deleting a stacked PR's base
  would close its child PR).

### The `-D` tradeoff

This used to say "never `-D`, so git itself refuses to discard unmerged work even if the
predicate were wrong." That safety net cannot exist for squash merges: git cannot see that a
squashed branch's work is in `main`, so `git branch -d` always refuses. The `squash` route
therefore uses `-D`, and relies on the four-part PR check above instead of git's own. The
`ancestor` route still uses `-d`, and worktrees are still removed without `--force`, so git
still refuses to drop uncommitted changes. Branch tips are recorded in
`~/.claude/hooks/worktree-reap.log` so a deleted branch can be restored with
`git branch <name> <sha>`.

### GitHub calls

`gh` is consulted at SessionStart, after commands that usually follow a merge (`gh pr merge`,
`git pull`/`fetch`/`switch`/`checkout`), or at most once per `WORKTREE_REAP_GH_INTERVAL`
seconds (default 1800); this hook is registered on every Bash call, so it must not hit the
network each time. Without `gh`, or with `WORKTREE_REAP_NO_GH=1`, only the `ancestor` route runs.
A failing `gh` call keeps everything.

It always exits 0: a hook that blocks your `git merge` is worse than the stale worktree it
was cleaning up.

| Variable | Default | Effect |
|---|---|---|
| `WORKTREE_REAP_DRYRUN` | `0` | `1` prints what it would remove and touches nothing |
| `WORKTREE_REAP_REMOTE` | `0` | `1` also deletes the remote branch (see conditions above) |
| `WORKTREE_REAP_MIN_AGE_SECONDS` | `86400` | in-use / freshness window |
| `WORKTREE_REAP_GH_INTERVAL` | `1800` | minimum seconds between non-triggered GitHub sweeps |
| `WORKTREE_REAP_NO_GH` | `0` | `1` disables the squash route |
| `WORKTREE_REAP_LOG` | `~/.claude/hooks/worktree-reap.log` | action log (last 500 lines kept) |

Run it with `WORKTREE_REAP_DRYRUN=1` first in any repo and check the selection against
`git worktree list` before letting it act. Tests: `bash claude-guards/hooks/worktree-reap.test.sh`
(temporary git repos, a bare origin, and a fake `gh`).

Registered async so it cannot stall a merge. Note that the `if: "Bash(git merge*)"`
filter has been observed firing on non-merge Bash calls; the script is idempotent and
cheap, so this is wasteful rather than harmful, but do not rely on the filter for
correctness.

## block-timeout-increase-guard.cjs — approving a block

When the guard blocks a timeout bump, the human answers with one word:

| You say | Result |
|---|---|
| `approve` | the blocked change is allowed on retry |
| `deny` | the change is refused; a retry is re-blocked with a "do not retry" message |
| `confirm IDENT = VALUE` | the original typed phrase; still works, at any time |

The short reply is deliberately narrow, because a bare "approve" is easy to mean for something else:

- It binds only if it is **your very next message** after the block. If you say anything else first,
  the binding is gone and the typed phrase (or a fresh block + `approve`) is needed.
- It covers only the value(s) named in that block. If several blocks happened since your last
  message, one `approve` covers all of them, since you saw them all.
- It must be the whole message: `approve`, `Approve!`, `APPROVE.` count; `approve it` does not.
- Decisions are applied in order and the last wins: a later `deny` overrides an earlier approval, and
  an `approve` that answers a fresh block reverses a denial.
- Everything is read from the session transcript, never from a file an agent could write. A block is
  recognised only as a non-human `tool_result` with `is_error: true` that starts with the hook-error
  prefix, so output that merely prints the guard's text cannot pose as one. Replies from a subagent
  or sidechain never count.
- Blocks raised **inside a subagent** are in that subagent's own transcript, so there the typed
  phrase is the way.

`~/.claude/timeout-guard-approvals.log` records each approved change with `via: "reply"` or `"typed"`.

## block-timeout-increase-guard.cjs — the unshipped-product exemption

The guard blocks edits that raise a timeout-shaped value, because bumping a timeout in a
SHIPPED product usually papers over a real performance or reliability problem. A product that
has not shipped has no such users, so edits under a path listed in
`~/.claude/timeout-guard-unshipped.txt` are exempt:

    # one absolute repo path per line; '#' comments allowed
    /Users/you/projects/some-unshipped-product

- Linked worktrees live under the repo path, so they are covered.
- The list is **user-level on purpose**. A repo-committed marker could be added by an agent to
  switch the guard off, which defeats the point.
- It **fails closed**: a missing, unreadable, empty or comment-only list, a relative
  `file_path`, a prefix lookalike (`app-evil` vs `app`) and a `..` traversal out of the root
  all leave the guard applying as before.
- Remove a line when its product ships.

Tests: `bash claude-guards/hooks/block-timeout-increase-guard.test.sh` (38 checks, isolated `HOME`).
