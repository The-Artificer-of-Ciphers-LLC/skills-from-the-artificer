---
name: post-fix-trace
description: "Second-pass regression trace after a bug fix, to catch what the fix itself broke. Use after completing a fix from your debug workflow (trace-based debugging, systematic debugging) and before marking the session done, especially when the fix touched shared code, changed control flow, modified model relationships, altered sync or persistence behavior, or moved work between threads or actors. Maps the blast radius, checks adjacent user flows, and runs impacted tests. Triggers: 'verify the fix didn't break anything', 'regression check', 'second trace', 'check for side effects'."
---

# Post-Fix Regression Trace

After you fix a bug, you've changed the system. That change might fix the original problem and quietly break something else: a calculation that stops recomputing, a field that is no longer persisted, a query that now includes soft-deleted records, a new main-thread bottleneck. The first trace found the disease; this trace checks whether the surgery nicked an artery.

## When This Runs

This skill activates after a fix is applied: after the fix gate of your debug workflow, after the fix phase of systematic debugging, or after any bug-fix commit. It runs before the debug session is considered complete. A fix that hasn't been traced for side effects is not yet done.

### Precondition: is the debug session actually done?

Check whether the user is still providing diagnostic input. If they are pasting logs, sharing crash reports, describing new symptoms, or asking questions about the bug, the session is still active and your fix is a hypothesis. Don't run this yet. Wait for them to finish, or ask: "Are there more symptoms to look at before I verify this fix?"

Treating a single fix commit as final while the user is mid-paste on crash logs is a common failure: more fixes usually follow, and anything shipped in between is built on a provisional diagnosis.

## The Second Trace

### Step 1: Map the blast radius

Read the diff of the fix. For every changed line, answer:

1. **What else calls this code?** Trace callers up: which views, view models and services call the function you changed?
2. **What does this code feed into?** Trace callees down: if you changed how a value is calculated, where is it displayed, persisted, exported, aggregated?
3. **What shares state with this code?** Look for shared mutable state: the same context object, singleton, observable property, or stored record type.

Write the blast radius as a list of file:line references. Not "various views use this" - name them.

### Step 2: Check each blast radius path

For each path from Step 1, verify the fix didn't break it. Check:

**Data integrity:**
- Are derived or cached values still recalculated everywhere they should be?
- Are soft-delete or visibility filters still present on every query touching this model?
- Does every field that is persisted or synced still have its mapping or registry entry?
- Are sensitive fields still stored through the protected path?

**Threading:**
- Did the fix move work off the main thread or actor? Verify that data-store access didn't follow it.
- Did the fix add a task or async hop? Verify no non-sendable model objects cross the boundary.
- Did the fix add `await`? Verify callers handle the new asynchrony.

**Persistence and sync:**
- Did the fix change how a model is saved? Verify the designated save path is still used, not a direct write that bypasses it.
- Did the fix change a field? Verify the sync mapping exists and has the right protection.
- Did the fix change conflict resolution? Check the strategy is still appropriate.

**Control flow:**
- Did the fix add an early return? What code below it no longer runs, and was any of it important?
- Did the fix change a guard or condition? Which cases now take the other branch?
- Did the fix catch an error differently? What used to propagate that no longer does?

### Step 3: Identify adjacent user flows

Fixes cascade when only the original symptom is retested. A fix for one bug can create an infinite loop elsewhere, and the fix for that loop can leave stuck pending state that causes flicker. Each fix is shipped after checking just the thing it was meant to fix.

For the subsystem your fix touches, enumerate all user-facing flows that pass through it, not just the one that was broken. Use a table like this and fill in your own subsystems:

| If you touched... | Also verify these flows |
|---|---|
| Sync / replication | Import then sync, reset then sync, derived values after sync, sync status UI, no infinite loop (watch status for 30s) |
| Import pipeline | Totals correct after import, no duplicate records, sync triggers correctly, search works on imported data |
| Reset / wipe | Sync state clears, re-import works, no orphaned records, no crash on next launch |
| Financial or aggregate calculations | Every account/record type shows the right total, dependent summaries and exports match |
| Schema or model changes | Field mapping exists, round trip through the backend works, existing data migrates, sync doesn't drop the field |
| Dedup / merge | No sync loop, the discarded record's cached state is handled, derived values recalculated on the survivor, children re-parented |
| Sharing / multi-user | Owner and member both see data, permission changes propagate, invite flow completes |

For each adjacent flow, trace the code path and confirm it still works. "I didn't change that code" is not sufficient: a sync loop can be caused by code that was not changed (a framework's internal retry) reacting to state left behind by code that was.

Check specifically for state pollution: does your fix leave any state (flags, cached records, pending operations, session guards) that a later operation might misinterpret? Pending saves with no cached counterpart that a framework retries forever are the classic example.

### Step 3.5: Code deletion verification

If the fix or refactor deleted more than about 50 lines of view or feature code, this step is mandatory. Consolidations can leave the services working and the entry points present while the user-facing journey quietly changes, and the feature appears gone.

1. **What capability did the deleted code give users?** Not what it did internally, but what a user could do before that they can't now.
2. **Is it handled by a different path?** If so, trace the full user journey through the new path and confirm the task can still be completed.
3. **Does the new path need more steps?** One click turning into three clicks plus a sheet is a UX regression worth documenting.
4. **Are there tests for the surviving path?** If neither the deleted nor the surviving code had tests, you are shipping an unverified consolidation. At minimum add a smoke test that exercises the flow end to end.

If `git diff --stat` shows more than 50 deletions in view files, this step applies even if it felt like a small change.

### Step 4: Build with zero warnings and run impacted tests

First build every platform the project targets and read the compiler warnings. "We didn't touch that file" is not a reason to ignore one: deprecation warnings become crashes, conversion warnings become data corruption, concurrency warnings become hard errors in the next language mode.

```bash
# Example: build each target platform and list unique warnings
xcodebuild -project App.xcodeproj -scheme App -destination 'platform=iOS Simulator,name=iPhone 15' build 2>&1 | grep "warning:" | sort -u
xcodebuild -project App.xcodeproj -scheme App -destination 'platform=macOS' build 2>&1 | grep "warning:" | sort -u
```

If warnings exist, fix them and list each one under a "Compiler Warnings" section of the report.

Then run impacted tests. Don't run only the test for the original bug: run tests for every path in the blast radius and every adjacent flow from Step 3.

```
# Fix was in a service: run that service's tests
xcodebuild test ... -only-testing:AppTests/ServiceTests

# Fix touched sync: also run the sync tests
xcodebuild test ... -only-testing:AppTests/SyncTests

# Fix changed a model: run the model tests
xcodebuild test ... -only-testing:AppTests/ModelTests
```

If no suite exists for a blast radius path, note it as a gap and still verify the path by reading the code.

### Step 5: Report

```
## Post-Fix Regression Trace

### Fix applied
[one-line summary of the fix, with file:line]

### Blast radius
- [path 1]: [file:line] - [status: clean | concern | regression]
- [path 2]: [file:line] - [status]

### Adjacent flows checked
- [flow name]: [status: verified | concern | broken]
  - [what was checked and how]

### State pollution check
- Flags/guards introduced: [list any new flags, session guards, caches]
- Pending operations: [does the fix leave state that survives beyond the immediate operation?]
- Cleanup paths: [are flags reset on wipe, logout, relaunch?]

### Code deletion verification (if >50 lines deleted)
- Lines deleted: [count from git diff --stat]
- Capabilities removed from user perspective: [list or "None - internal refactor only"]
- Surviving path verified: [yes/no - did you trace the full user journey?]
- Test coverage for surviving path: [existing tests | new tests added | NO TESTS - gap]

### Tests run
- [test suite]: [pass/fail count]

### Secondary issues found
- [issue description, or "None"]

### Verdict
[CLEAN - fix is verified | BLOCKED - secondary issues must be fixed first]

### Release status (CLEAN verdicts only)
- Fix commits in this session: [count]
- Same-subsystem fixes in the last 24h: [count] - if 3 or more, stop and reconsider the approach
- A clean verdict means the fix is verified. It does not authorize a release or build; that needs the user's explicit go-ahead and your normal release checks.
```

### Step 6: If secondary issues are found

If the second trace finds a regression:

1. **Fix it now.** Deferring it or opening a ticket leaves a known break in place.
2. After fixing, run this trace again on the secondary fix, including Step 3 (adjacent flows).
3. Repeat until the trace comes back clean.

This isn't an infinite loop in practice, since each secondary fix has a smaller blast radius than the last. If you're on your third cycle, the original fix is probably wrong and you should reconsider the approach.

**Two-fix rule:** if a single debug session produces two or more secondary fixes, stop before committing. You are in cascade territory. Re-read the original fix and ask: "Am I treating the root cause or patching symptoms?" A chain of fixes where each patches the side effect of the previous one usually means a single root cause (such as a schema or configuration gap) was never addressed. Fix that once instead of patching downstream symptoms.

## Step 7: Capture as tests

After a clean verdict, run your debug-test-capture step (the `debug-test-capture` skill). The session produced a reproduction case, a root cause, and a verified fix, which are all the ingredients for a regression test. The session is fully complete only when that regression test exists and passes.

For secondary issues found in Step 3, also capture tests for the adjacent flow that would have broken. If a sync loop was the secondary issue, write a test that imports data, runs sync, and asserts that sync terminates. These adjacent-flow tests are what prevent the next fix cascade.

## What Not To Do

- Don't skip this because the fix "looks safe." Fixes that look safe are the ones that ship unexamined side effects.
- Don't just re-run the original reproduction case. That belongs to your debug workflow's verification gate. This trace checks the paths you did not originally test.
- Don't eyeball the diff and say "looks fine." Trace the callers and read the code.
- Don't run only the directly related test suite. Run adjacent ones too.
