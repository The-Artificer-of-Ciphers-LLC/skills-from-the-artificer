---
name: qa-test-architect
description: Risk-first test planning and authoring for any codebase. Runs a 3-step pipeline — risk assessment, test-case design (happy / boundary / negative / independence), then implementation in the project's own stack with a verified run. Use when the user asks to "generate tests", "write a test", "what should I test", "review code for testability", or wants a risk-based test strategy. A project may ship its own override of this skill with stack-specific detail.
---

# QA Test Architect

Build tests that prevent defects, target high-risk areas, and balance automation cost
against payoff.

**Never skip the pipeline.** On any "generate tests / write a test / review for
testability" request, run Steps 1→4 before writing code.

## Step 1 — Risk & strategy assessment
Output a short summary first:
- **80/20 risk zone** — the ~20% of the code handling the most critical data or
  highest-traffic logic (money, auth, state mutations, persistence, concurrency,
  external I/O). Concentrate effort there.
- **Automation suitability** — unit (pure logic, small surface), integration (modules
  plus real I/O seams), or manual/exploratory (UX edges, multi-system, hard to automate).
  Pick the cheapest level that proves the behavior.

## Step 2 — Test-case design (enforce all four)
1. **Happy path** — the ideal functional flow.
2. **Boundary value analysis** — min, max, just-inside, just-outside; empty/zero,
   overflow, off-by-one, time/window edges.
3. **Negative path** — bad input, thrown errors, timeouts, dependency/network failure,
   malformed or absent data.
4. **Independence** — no shared global state, no execution-order dependence; each test
   sets up and tears down its own world.

## Step 3 — Implement & document
- Use the project's **existing** framework and conventions — match the surrounding tests;
  don't introduce a new runner.
- **Descriptive names** stating *what* is tested + *expected outcome*
  (e.g. `rejectsTransferWhenBalanceBelowAmount`).
- **Isolated fixtures, not a persistent/shared database** — in-memory or per-test data.
  Isolate only the I/O seams (network, clock, filesystem, external services); exercise the
  **real unit under test** rather than stubbing its own logic.
- Tests are authoritative — when a test fails, fix the code, never weaken the test.

## Step 4 — Verify the run (do not trust a green checkmark)
A passing-looking run is not proof. Always confirm:
- A runner can **exit 0 even when tests fail**, or when a bad filter selected nothing.
  Read the actual result — require **executed-count > 0** and failures = 0, and check the
  count matches what you intended to run.
- **Filters/selectors silently match zero tests** when the path, name, or pattern is wrong
  — confirm your selection actually ran the target.
- **Red before green** — for a new behavior or regression, see the test fail before the
  fix and pass after.
- **IDE/editor diagnostics after edits can be stale index**, not ground truth — confirm
  with a real build/compile and the actual test run.

## Adapt to the stack
Before writing, detect the project's test framework, fixture/mock helpers, and run command
(read existing tests and CI config). If the project ships its own QA skill, its
stack-specific guidance takes precedence over this generic version.
