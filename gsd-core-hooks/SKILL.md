---
name: gsd-core-hooks
description: A full PreToolUse/PostToolUse hook suite that machine-enforces a project's workflow rules instead of leaving them as prose — a passing test-runner verdict bound to the exact commit sha before push, no local `node --test`, Memtrace-first code discovery, no-defer artifact gating for long directives, and a family of guards against harness poll/timeout false-negatives (backgrounded dispatch, foreground poll-loop kills, self-matching pgrep waits, unpinned bench contention, double-dispatch). Use when an agent keeps skipping "ABSOLUTE"/"MANDATORY" rules in CLAUDE.md despite them being written down, when a CI/test gate needs to be unbypassable rather than self-attested, when local test runs are orphaning processes or leaving container relics, or when a long-running remote job's poll loop keeps dying against the harness's own timeout ceiling. Companion to `commands/` — those directives *describe* these rules in prose; this ships the mechanism that actually holds the line.
---

# gsd-core-hooks

> A rule an agent can read once and forget is not enforced — it's remembered, which is a different thing.

## What this is

The `.claude/hooks/` directory from one real project (gsd-core), lifted wholesale. Every file here
exists because a specific incident happened first and the hook was written afterward to close the
gap — the header comment on each script names the incident, the date, and the exact failure mode.
This is not a designed-in-advance framework; it is a project's actual scar tissue, in installable
form.

It backs the rules stated in [`../commands/`](../commands/) (`bug-fixer.md`, `feature-builder.md`,
`triage-review.md`, `test.md`) — those files say things like "gsd-test MUST exit 0 before any git
push" and "NEVER run `node --test` locally"; the hooks in this folder are what make those true
regardless of whether the agent remembers reading them.

## The three failure classes it guards against

1. **Self-attestation.** "I ran the tests" / "the review passed" is cheap to claim and expensive to
   check by hand. `pre-pr-gate.sh` + `record-gsd-verdict.sh` bind a push/PR action to a machine-read
   verdict line for the *exact commit sha being shipped* — not "tests passed at some point," but
   "tests passed for this sha, recorded by the one sanctioned writer, checked at the moment of push."
2. **Prose that goes stale mid-session.** A directive is read once, at the start, then hours of
   tool calls go by with nothing re-presenting it. `gsd-phase-gate.cjs` is the original,
   project-specific incident behind this project's separately-shipped [`../artifact-gates/`](../artifact-gates/)
   engine — see the note in this folder's `README.md` before installing both.
3. **Harness ceiling false-negatives.** A backgrounded or foregrounded long-running dispatch dies at
   the tool harness's own timeout (commonly 600000ms) with no distinguishing signal from a real
   failure — and a `pgrep -f "<cmd>"` waiter can match its *own* argv and spin forever even after the
   watched job finished. `gsd-async-poll-guard.sh`, `gsd-foreground-poll-guard.sh`,
   `gsd-pgrep-waiter-guard.sh`, `gsd-bench-pin-guard.sh`, and `gsd-test-single-flight-guard.sh` each
   close one verified instance of this.

## Read this before installing

**None of this is generic.** Every script assumes gsd-core's specific toolchain: a remote dockerized
test runner called `gsd-test` that emits a `{"type":"verdict","outcome":"passed"}` line, a per-sha
pass-marker file under `<git-common-dir>/gsd-passes/`, Memtrace as the code-discovery MCP server, and
(in `emitted-cjs-read-guard.cjs`) a `.cts` → `.cjs` build pipeline specific to that repo. Installing
these unedited against a different project will produce confident denials referencing tools you do
not have.

Full per-hook breakdown, what each one assumes, and what to repoint: [`README.md`](README.md).

## When to reach for this vs. `artifact-gates/`

- Want the *general* "blocking step needs a produced artifact" engine, config-driven, with tests and
  two example contracts? Use [`../artifact-gates/`](../artifact-gates/).
- Want to see the concrete, incident-driven version that engine was generalized from, or want the
  rest of this bundle (test-verdict gating, no-local-test, Memtrace-first, poll-loop guards) as a
  starting shape for your own project's hooks? Use this folder.

Installing both leaves two independent engines answering the same "was the artifact produced"
question for `Edit|Write|Bash` — pick one, or scope them to disjoint tool matchers.
