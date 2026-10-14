---
name: debug-test-capture
description: "Turns a finished debug session into permanent regression tests. Use right after a bug fix is verified or committed: after a post-fix regression trace comes back clean, after a trace-based debug workflow passes its final gate, or when the user says 'write tests for that fix', 'capture that as a test', 'add a regression test', or 'make sure that doesn't happen again'. The reproduction, root cause and fix are all in context now and are lost once the session ends, so capture them while fresh. Covers regression, boundary and invariant tests."
---

# Debug to Test Capture

Every completed debug session contains exactly the information needed to write a good test: a reproduction case, a root cause, and a verified fix. This skill turns that into a permanent regression guard before the debug context evaporates. A bug that was worth debugging will recur without a test, because nothing else remembers why the code looks the way it does.

## When This Runs

After a debug session completes, specifically when:

- A post-fix regression trace returns a clean verdict
- Your debug workflow's final verification gate passes
- A debug workflow marks an issue resolved
- Any bug fix is committed

If you just finished debugging and haven't run this, the debug session is not complete.

## Step 1: Extract the test signal from the debug session

Read back through the debug work and pull out:

1. **The trigger**: what user action or system state caused the bug? This becomes the arrange phase.
2. **The root cause**: what was actually wrong? This tells you what the test should assert against.
3. **The divergence point**: where did actual behavior differ from expected? This becomes the assertion.
4. **The fix**: what changed? This tells you what condition the test should verify holds.
5. **The blast radius**: from the regression trace, which adjacent paths were checked? Any without existing tests are candidates.

## Step 2: Decide test type and location

Put the test next to the existing tests for that module, and follow the project's naming and layout conventions. If a test file for the module already exists, add to it. If not, create one that matches the neighbors. Look at two or three nearby test files first so the new one reads like it belongs.

### Test framework

Use the project's current framework. The shape below is Swift Testing; XCTest and other frameworks map the same way (suite maps to test class or describe block, `@Test` to a test method, `#expect` to an assertion).

```swift
import Testing
@testable import MyApp

@Suite("Description of what's being tested")
struct FeatureTests {
    @Test("Bug description - regression test for [root cause]")
    func specificBehavior() async throws {
        // arrange: reproduce the conditions that triggered the bug
        // act: perform the operation that was broken
        // assert: verify the fix holds
    }
}
```

Prefer the newer framework for new tests when the project already uses it; don't mix styles inside one file.

## Step 3: Write the tests

For each debug session, write at minimum these tests.

### A. The regression test (mandatory)

This test reproduces the exact bug and verifies it's fixed. It should fail if the fix is reverted.

Name it descriptively, so future developers understand what bug it prevents from the name alone:

```swift
// GOOD: tells you exactly what went wrong
@Test("Bulk import does not block the main thread with 500+ records")
@Test("Total recalculates after soft-deleting a child item")
@Test("Sync writes the notes field to the encrypted store, not plain fields")

// BAD: vague, doesn't explain the bug
@Test("Import works correctly")
@Test("Total is right")
@Test("Sync works")
```

The test body should:
- Set up the exact conditions that triggered the bug (not simplified)
- Execute the operation that was broken
- Assert the correct behavior, not just "doesn't crash"

### B. The boundary test (if applicable)

If the bug involved a threshold, count, or edge case, add tests for the boundaries:

- The value that triggered the bug
- One below the threshold
- One above the threshold
- Zero, empty and nil cases

### C. The invariant test (if a project rule was violated)

If the bug violated a standing project rule (a documented convention, an architectural constraint), write a test that encodes the invariant so the rule is enforced by the suite instead of by memory:

| Invariant violated | Example invariant test |
|---|---|
| Money uses a fixed-point type | Assert monetary fields are the decimal type, not floating point |
| Every persisted field is registered for sync | Assert every model field has a registry entry |
| Derived totals are kept in sync | Assert the stored total is updated after create/update/delete |
| Soft deletes | Assert deleted records are excluded from queries |
| Thread/actor isolation | Assert data access happens on the required actor |
| Single write path | Assert saves go through the designated coordinator |
| Sensitive fields are protected | Assert sensitive fields use the encrypted storage path |

These may already exist in an architecture or invariant test suite. Check first and only add what is missing.

## Step 4: Verify the tests

1. **Run the new tests.** They must pass against the current (fixed) code.
2. **Verify regression value.** Ask: "If someone reverts the fix, would this test fail?" If not, the test asserts the wrong thing. Rewrite it. Where practical, actually revert the fix temporarily and watch the test fail.
3. **Check for flakiness.** If the bug was timing-related, make the test deterministic: use expectations or explicit synchronization, not sleeps.

## Step 5: Report

```
## Debug Test Capture

### Bug: [one-line summary]
### Root cause: [from the debug session]

### Tests created:
- [TestFile] `testName` - [what it guards against]

### Tests updated:
- [TestFile] `testName` - [what changed and why]

### Coverage gaps noted:
- [any blast radius paths that still lack test coverage]
```

## What Makes a Good Debug-Derived Test

**Good debug tests encode the root cause, not the symptom.**

Bad: `#expect(account.total == 100)` checks one specific value and doesn't encode the rule.

Good: `#expect(account.total == items.filter(\.isActive).reduce(0) { $0 + $1.amount })` encodes the actual rule: the total equals the sum of active items.

**Good debug tests use realistic data volumes.**

If the bug only manifests with 500+ records, the test should use 500+ records. Simplifying to 3 records lets the same bug pass again, which is how a volume-dependent bug survives repeated manual testing.

**Good debug tests have comments linking back to the bug.**

```swift
@Test("Batch sync yields to the main actor - regression for the import freeze")
func batchSyncYields() async throws {
    // Bug: hundreds of synchronous encode + notification calls starved the
    // main actor, freezing the UI.
    // Fix: process in batches of 50 with Task.yield() between batches.
    // Root cause: the push loop never suspended.
}
```
