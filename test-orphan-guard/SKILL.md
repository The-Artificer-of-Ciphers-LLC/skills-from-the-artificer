---
name: test-orphan-guard
description: >-
  Detects and kills leftover or runaway `node --test` processes that pile up
  after a test run finishes or fails — the orphaned, CPU-pinned node processes
  that accumulate (often 10–15 at a time) until the machine bogs down or
  overheats. Use this skill whenever the user mentions leftover / zombie /
  orphan / stray node processes, a test runner that "doesn't clean up after
  itself", a machine getting slow or hot from node, `node --test` spawning
  processes that never die, or asks to kill / reap / clean up stray test
  processes — AND proactively wrap any `node --test` / `npm test` /
  `gsd-test` / test-suite run you launch so children can't leak in the first
  place. Especially relevant to `node --test --test-isolation=process` runs
  whose children get reparented to PID 1, and to fixtures that run with
  `--test-timeout=0` (no timeout) and therefore spin forever.
---

# test-orphan-guard

Node's test runner leaks processes. This skill stops the leak at the source and
cleans up what already leaked.

## Why this happens (read this first — it tells you what's safe to kill)

`node --test --test-isolation=process` runs **each test file in its own child
`node` process**. Those children are supposed to die when the run ends. Two
things break that:

1. **The runner dies without reaping its children.** If the top-level
   `node --test` is killed (Ctrl-C, a timeout in the harness, an OOM, a crashed
   wrapper), its child test processes get **reparented to PID 1** (launchd on
   macOS). They are now *orphans*: no parent will ever `wait()` on them or shut
   them down.
2. **A test has no timeout.** Fixtures run with `--test-timeout=0` never
   self-terminate. Combined with orphaning, a single hung test file can spin a
   full CPU core **forever** — and they stack up. Fifteen of them at ~35% CPU
   each is 5–6 cores pinned and a machine that's audibly struggling.

So the leaked processes are not "doing nothing" — they're usually **busy-looping
at high CPU**. The signatures that mark a process as *safe to kill*:

- **Orphan** — its `PPID` is `1`. Its runner is gone; it is definitionally a
  leftover. This is the strongest and most common signal.
- **Runaway** — its command line is a `node --test` process pinned at high CPU
  for minutes. A healthy test file finishes in seconds; one pinned for 3+
  minutes is hung.

Everything else that happens to be a node process — MCP servers (memtrace,
github, context7, xcodebuild), editor/Codex helpers, `node_repl`, LM Studio —
**must never be touched**. None of those carry `--test` on their command line,
which is the primary safety boundary the tools use.

## The two tools

This skill ships a **prevention** tool and a **cure** tool. They cover each
other: prevention stops same-process-group children from leaking; cure mops up
anything that still escapes (or already leaked before the skill was in place).

| Tool | Role | Use when |
|---|---|---|
| `scripts/guarded-test.sh` | **Prevention** | You are about to run tests |
| `scripts/reap-test-orphans.sh` | **Cure** | Leftovers already exist / machine is bogged down |

### Prevention — run tests through the guard

Whenever you run a node test suite for the user, launch it through the guard
instead of bare:

```bash
scripts/guarded-test.sh node --test          # instead of: node --test
scripts/guarded-test.sh npm test             # wraps whatever npm spawns
scripts/guarded-test.sh gsd-test-summary     # wraps project test runners too
```

It runs the command in its **own process group** and, on exit for *any* reason
(pass, fail, or Ctrl-C), sends `SIGTERM` then `SIGKILL` to the **whole group**.
This is why it works even when children outlive the runner: a process keeps its
process group when it's orphaned (only its parent changes), so a group-kill
still reaches it. The guard also registers its live run so the reaper won't
touch it mid-flight.

The only children it can't reach are ones node explicitly `detached`/`setsid`s
into a brand-new group — and the reaper catches those as PID-1 orphans. Belt
and suspenders.

### Cure — reap what already leaked

When the user says the machine is crawling, or you spot a pile of stray test
processes, run the reaper:

```bash
scripts/reap-test-orphans.sh --dry-run   # show what WOULD be killed, kill nothing
scripts/reap-test-orphans.sh             # actually kill (SIGTERM, then SIGKILL stragglers)
```

**Always dry-run first when you're unsure** — it prints the exact PIDs, ages,
CPU, kill reason, and test file, so you and the user can sanity-check before
anything dies. It's safe to read.

It finds kill targets by:
- enumerating node processes with `pgrep` (see gotcha below),
- keeping only those whose command matches `--test` / `*.test.[cm]?js` and is
  not `node_repl`,
- classifying each as **orphan** (`PPID==1`) or **runaway** (CPU ≥ threshold AND
  age ≥ threshold, *confirmed by a second CPU sample* so a momentary spike
  doesn't trip it),
- excluding its own PID/PPID and any process group belonging to a live
  `guarded-test.sh` run.

Tunable via env vars (defaults are conservative):

| Var | Default | Meaning |
|---|---|---|
| `CPU_THRESHOLD` | `20` | % CPU to count as "hot" |
| `RUNAWAY_AGE_SECONDS` | `180` | min age before a hot `--test` proc is a runaway |
| `CONFIRM_DELAY` | `2` | seconds between the two CPU samples |
| `TEST_MATCH` | `(--test\|\.test\.[cm]?js)` | what marks a node *test* process |
| `GUARD_STATE_DIR` | `~/.cache/test-orphan-guard` | live-run registry location |

Flags: `--dry-run`, `--quiet` (print only when it actually kills something —
used by the stop-hook so it's silent on no-op), `--help`.

## Always-on (so it fires even for runs the user launches themselves)

A skill only governs runs *you* (Claude) drive. To cover the user's own
`node --test` in their terminal, install the shell integration and the
stop-hook.

### Shell integration

Add to `~/.zshrc` (or `~/.bashrc`):

```bash
source "$HOME/.claude/skills/test-orphan-guard/assets/shell-integration.sh"
```

This defines a transparent `node` wrapper that routes `node --test …` through
the guard and passes everything else (REPL, `node script.js`) straight through
untouched. It also adds aliases `gtest` (guard) and `reap-tests` (reaper).

Opt-in background cleanup — reaps strays at most once a minute, silently:

```bash
export TEST_ORPHAN_GUARD_AUTOREAP=1   # set before the source line
```

> nvm/version-manager note: the wrapper resolves the real `node` binary once at
> shell start. If you `nvm use` a different version mid-session, re-source the
> file (or open a new shell) so the wrapper points at the new binary. The
> reaper is unaffected.

### Claude Code stop-hook (safety net after every turn)

See `assets/claude-stop-hook.json` for a snippet that runs
`reap-test-orphans.sh --quiet` when Claude finishes responding, so anything a
run leaked gets cleaned even if you forget. It uses the conservative
orphan+confirmed-runaway criteria, so it can't kill an active run. Install it
into `~/.claude/settings.json` (the `update-config` skill can do this).

## Operational gotchas (baked into the scripts — know them anyway)

- **Enumerate with `pgrep`, not `ps -ax`.** In some sandboxed shells `ps -ax`
  is silently throttled to a tiny subset of processes, but `pgrep -f` and
  `ps -p <pid>` still see everything. The reaper relies on this; don't "fix" it
  back to `ps -ax | grep`.
- **zsh doesn't word-split unquoted vars.** If you ever kill PIDs inline in zsh,
  `kill -TERM $pids` passes the whole list as one argument and fails with
  "illegal pid". Use `kill -TERM ${=pids}` (zsh) or an array. The scripts use
  bash arrays, so this only bites you in ad-hoc zsh.
- **Zombies (`STAT=Z`) can't be killed.** A real zombie is already dead and
  waiting for its parent to reap it; signalling it does nothing. You clear it by
  killing/replacing its *parent*. The leaked test processes here are **not**
  zombies — they're live, running (`STAT=R`) orphans. Don't conflate the two.
- **Process-group kill reaches orphans.** Orphaning changes `PPID`, not the
  process group — which is exactly why `guarded-test.sh`'s group-kill still
  catches children that outlived the runner.

## Quick reference

```bash
# prevention: always wrap test runs
scripts/guarded-test.sh node --test
scripts/guarded-test.sh npm test

# cure: inspect, then clean
scripts/reap-test-orphans.sh --dry-run
scripts/reap-test-orphans.sh

# tune sensitivity (e.g. catch hangs sooner)
RUNAWAY_AGE_SECONDS=120 CPU_THRESHOLD=15 scripts/reap-test-orphans.sh
```
