---
name: test-first-bugfix
description: >
  Test-driven bug fixing — reproduce before you fix. Use this skill whenever the user reports a bug,
  describes unexpected behavior, says something is broken, mentions a regression, or asks you to fix
  an error. This includes phrases like "this is broken", "X doesn't work", "there's a bug in",
  "getting an error when", "it used to work but now", "failing on", or any variation. Even if the
  user says "just fix it" or "quick fix", use this skill — the reproduce-first discipline catches
  regressions and proves the fix actually works. Do NOT skip this skill just because the bug seems
  obvious or simple.
---

# Test-First Bug Fixing

When a user reports a bug, the instinct is to jump straight to reading code and patching it. Resist that. A fix without a reproduction test is a guess — you can't prove it works, and you can't prevent the bug from coming back. This skill enforces a disciplined sequence: **understand → reproduce → fix → prove**.

## Progress checklist

- [ ] 1. Bug understood: expected vs. actual stated, likely area identified
- [ ] 2. Test setup studied: framework, conventions, helpers found
- [ ] 3. Reproduction test written and **seen failing**, output shown to the user
- [ ] 4. Fix applied (subagents raced only when more than one credible strategy exists)
- [ ] 5. Winner picked: repro passes, nothing else broke, smallest root-cause fix
- [ ] 6. Final verification in the main tree: repro and broader suite green, shown to the user
- [ ] Regression patterns checked: incomplete enumeration, partial fix across call sites, silent fallthrough, stale test encoding the bug

## The Sequence

### 1. Understand the Bug

Before touching any code, make sure you understand what's actually broken:

- Ask clarifying questions if the report is ambiguous
- Identify the expected behavior vs. actual behavior
- Note any error messages, stack traces, or reproduction steps the user provided
- Identify which part of the codebase is likely involved (but don't start fixing yet)

### 2. Study the Test Setup

Before writing the reproduction test, understand how this project tests things:

- Find the existing test framework and configuration (look for `jest.config`, `vitest.config`, `pytest.ini`, `Package.swift` test targets, `.test.` / `.spec.` / `_test.` files, etc.)
- Study 2-3 existing tests near the area of the bug to understand patterns, conventions, and helpers
- Identify if you need mocks, fixtures, test databases, or other infrastructure
- Check for test utilities, custom matchers, or shared setup that you should reuse

This matters because a test that doesn't follow project conventions is a test the team won't maintain.

### 3. Write the Reproduction Test

Write a test that **fails right now** because of the bug. This is the most important step.

Guidelines:
- The test should be minimal — test exactly the broken behavior, nothing more
- Name it descriptively so the bug is obvious from the test name (e.g., `test_login_fails_when_email_has_plus_sign`, not `test_login_bug`)
- Place it in the appropriate test file following the project's conventions
- If a relevant test file exists, add the test there; don't create a new file unless necessary
- When writing tests, use `beforeEach`/`afterEach` (or `before`/`after`) for setup and cleanup instead of inline `try/finally` blocks. This keeps test bodies focused on assertions and ensures cleanup runs even if the test throws. For Node.js `node:test`, use `describe` with `before`/`after` or `beforeEach`/`afterEach` hooks.

After writing the test, **run it and confirm it fails**. Show the user the failing output. If the test passes, the reproduction is wrong — the test must fail before proceeding.

Do NOT move to the next step until you have a failing test that the user can see.

### 4. Fix It (race subagents only when the fix is genuinely open)

Decide how open the fix is before spending parallel attempts on it:

- **One obvious fix** (a missing case, a wrong constant, an off-by-one): apply it yourself, run the reproduction test, then go to step 6.
- **Two or more credible strategies**: spawn 2-3 subagents in parallel, one per strategy, with the `Agent` tool and `isolation: "worktree"` so they don't conflict. The reproduction test is their proof; a fix is only valid if it passes.

Each subagent gets this prompt structure:

```
You are fixing a bug. Here is the context:

**Bug description**: [what the user reported]
**Reproduction test**: [path to the test file, and the specific test name]
**Test command**: [exact command to run just this test]
**Fix strategy**: [the specific approach this subagent should try]

Your job:
1. Read the reproduction test to understand what's expected
2. Read the relevant source code
3. Apply your fix strategy
4. Run the reproduction test — it must pass
5. Run the full test suite in the affected area — nothing else should break
6. If your fix works, save your changes. If not, explain why this strategy didn't work.

IMPORTANT: Do not modify the reproduction test. The test defines the contract. Fix the code, not the test.
```

**Choosing fix strategies**: Think about 2-3 genuinely different approaches. For example:
- Strategy A: Fix the immediate cause (patch the specific function)
- Strategy B: Fix the root cause (refactor the underlying logic)
- Strategy C: Fix at a different layer (input validation, data transformation, etc.)


### 5. Pick the Winner

If you raced subagents, evaluate their results (for a direct fix, apply the same three checks to your own change):

1. **Did the reproduction test pass?** — This is the gate. If it doesn't pass, the fix failed.
2. **Did any other tests break?** — A fix that introduces regressions isn't a fix.
3. **Code quality** — Among passing fixes, prefer the one that:
   - Is the smallest change
   - Fixes the root cause rather than papering over it
   - Is easiest to understand
   - Doesn't add unnecessary complexity

Apply the winning fix to the main working tree. If multiple fixes passed, briefly tell the user which approaches worked and why you picked the one you did.

### 6. Final Verification

After applying the winning fix:

1. Run the reproduction test one more time in the main tree — confirm it passes
2. Run the broader test suite to catch any integration issues
3. Show the user the green test output

Only then report the bug as fixed. Show what changed and why.

## Regression Patterns to Watch For

When investigating a bug, check whether it falls into one of these known regression categories. If it does, the fix should address the pattern, not just the symptom.

### Incomplete Enumeration

A Set, enum, or array of recognized values is missing entries. Classic example: `INFRA_ERROR_CODES` had 6 errno codes but missed `EAGAIN` — the most common resource exhaustion error. The code *looked* complete because it had `ENOMEM`, `EMFILE`, `ENFILE`, but the author didn't systematically enumerate all POSIX resource exhaustion codes.

**How to detect**: When a bug report describes "X is not handled" or "Y is treated as Z instead of W", check if there's a hardcoded list that should include X. Then check what OTHER values are also missing — don't just add the one from the bug report.

**How to prevent**:
- Tests should check **membership of each known value individually**, not assert exact Set size (`assert.equal(set.size, 6)` breaks when you add an entry)
- Consider adding a static analysis guard test that enumerates the complete domain (e.g., scan POSIX errno names and verify all resource-related ones are in the set)
- When adding a value to a Set/enum, ask: "What is the complete taxonomy? What else is missing?"

### Partial Fix Across Call Sites

A fix is applied to 2 of 14 call sites. Classic example: `LC_ALL=C` was added to 2 git exec calls but 12 others still used the system locale. The bug reporter's specific reproduction was fixed, but the systemic issue persisted.

**How to detect**: When a prior fix exists for the same class of bug, search for ALL call sites that need the same treatment, not just the one in the bug report. Use `grep` to find every instance of the pattern.

**How to prevent**:
- After applying a fix, write a **static analysis guard test** that scans source files for unprotected call sites (e.g., "every `execFileSync` that references a git command must include `GIT_NO_PROMPT_ENV`")
- The guard test catches future regressions automatically — any new call site that lacks the protection will fail CI

### Silent Fallthrough

A function has branches for known cases but no handler for a new case, so it falls through to a default that produces wrong behavior silently. Classic example: `deriveState` had handlers for `complete`, `pre-planning`, and `executing` phases but not `needs-discussion`, which fell through to auto-mode dispatch and looped.

**How to detect**: When a bug describes "X gets stuck" or "Y loops forever", check if there's a switch/if-else chain that should handle the case but doesn't. Look for missing `else` branches, incomplete `switch` statements without `default`, or early returns that skip new code paths.

**How to prevent**:
- Prefer exhaustive pattern matching (TypeScript: `satisfies Record<Phase, Handler>`)
- Add `default: throw new Error("unhandled case")` to switch statements
- When adding a new enum value, search for every switch/if-else that matches on the enum

### Stale Test Encoding Buggy Behavior

An existing test asserts the *wrong* behavior because it was written to match the bug, not the spec. Classic example: a test asserting `getApiKey("unknown")` returns `undefined` when the correct behavior is to throw. The test passed because it encoded the bug.

**How to detect**: When investigating a bug, read existing tests for the area. If a test explicitly asserts the buggy behavior, the test itself is wrong — it was written (or updated) to match the code without questioning whether the code was correct.

**How to prevent**:
- Tests should be written from the spec/requirements, not from the code
- When a test assertion seems to validate surprising behavior, question it

## Pre-push and CI pitfalls (Node / TypeScript projects)

Project-specific material that used to live here (required local checks before pushing test changes,
`node:test` `t.after()` pitfalls, stale-base PR failures, template-literal indentation, top-level
`await` races) is in [`references/node-test-pitfalls.md`](references/node-test-pitfalls.md). Read it
before pushing test changes in a Node/TypeScript repo; skip it for other stacks.

## Edge Cases

**"The bug is in untested code"**: That's fine — you're adding the first test for this area. Follow the project's test patterns as closely as possible.

**"I can't reproduce it with a test"**: Some bugs (race conditions, environment-specific issues, UI rendering) are genuinely hard to capture in an automated test. If after a reasonable attempt you can't write a failing test, tell the user and ask how they'd like to proceed. Don't silently skip the test step.

**"The user says just fix it, skip the test"**: Acknowledge their preference, but explain briefly why the test matters ("the test will prevent this bug from coming back"). If they insist on skipping, respect that — they're the boss. But suggest adding the test after the fix at minimum.

**"Multiple bugs in one report"**: Treat each bug separately. Write a reproduction test for each, fix them one at a time. Don't try to fix everything in one pass — that's how things get missed.
