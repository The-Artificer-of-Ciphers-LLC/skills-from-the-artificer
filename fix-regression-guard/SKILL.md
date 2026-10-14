---
name: fix-regression-guard
description: Mandatory regression analysis before committing a bug fix. Use before any fix commit, after any change to a guard, condition, ownership check, or flow-control trigger, or after an agent proposes a fix. Prevents the fix-break-fix cycle by tracing every callsite, actor, and follow-up action that depends on the changed condition, and by escalating to a redesign after repeated review findings.
---

# Fix Regression Guard

Before committing ANY fix, complete this analysis. A common source of new bugs in any codebase is a fix that changes a condition or guard without tracing all code paths that depend on it.

## When to trigger

- Every `fix:` commit
- Every change to a guard, condition, or ownership/permission check
- Every change to flow control (retry triggers, scheduling, reconcile or refresh paths)
- After any agent proposes a fix

## The Analysis

### Step 1: List every condition you changed

For each changed `if`, `guard`, `where`, or boolean check, write (illustrative example from an order service):
- **Before**: `if order.ownerID == DEFAULT_OWNER`
- **After**: `if order.ownerID == resolvedOwnerID`
- **Intent**: Only match the actual owner, not the symbolic default

### Step 2: Find ALL callsites of the changed condition

```bash
# For each changed variable/function, find every reference (names are illustrative)
grep -rn "ownerID\|refreshOrders\|reconcileItems" src/ | grep -v "test"
```

For EACH callsite:
- Does it still work for the **positive** case (condition is true)?
- Does it still work for the **negative** case (condition is false)?
- Is there a code path that previously worked but now falls through?

### Step 3: Enumerate every actor that runs the changed code

List every actor, role, or client that executes the changed code (user roles, service instances, client platforms, background jobs, other tenants). For each one, does the condition still evaluate correctly?

### Step 4: Check for orphaned follow-up actions

If you changed a guard that previously allowed code to run:
- What code ran AFTER the guard in the old version?
- Does that code still run in the new version?
- If not, is there an alternative path?

Example: if `registerWorker()` previously triggered a polling cycle, and your fix changes that method, verify the polling cycle still happens.

### Step 5: Write a regression test for the OPPOSITE case

If the bug was seen by one actor, write a test for the other.
If the bug was on the producer side, write a test for the consumer, and vice versa.
If the bug was single-actor, write a test for the multi-actor interaction.

### Step 6: Escalate after three findings

Count the adversarial-review findings (automated reviewer, isolated human or agent reviewer, post-fix trace) on THIS feature. At 3, stop patching. Write one paragraph on why the findings keep coming (they usually share a design cause: placement, lifecycle, gate ownership) and propose a redesign to the user before writing more fix code.

## Common Patterns

Fix chains tend to follow the same shapes:

1. **Fix one side, break the other**: each fix is tested only against the broken actor, never the working one, so the working one regresses and the cycle repeats.
2. **Narrow a race, open an edge case**: each fix shrinks a race window or tightens a guard, but introduces a new uncovered state (for example a case the old, looser guard happened to handle).
