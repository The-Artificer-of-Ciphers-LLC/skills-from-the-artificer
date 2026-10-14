---
name: trace-fix
description: "Evidence-gated debugging protocol for iOS/macOS and Swift apps: trace the execution path, locate the exact divergence, prove the root cause, and only then fix. Use for any bug where code compiles but behaves wrongly (hangs, freezes, wrong or missing data, silent failures, intermittent issues) and for crashes (EXC_BREAKPOINT, EXC_BAD_ACCESS, SIGABRT, launch crashes). Trigger on 'debug this', 'app is crashing', 'SIGTRAP', 'crash log', 'it hangs', 'it works sometimes', or /trace-fix. Guessing at fixes burns build cycles; the gates force proof first."
---

# /trace-fix: Trace Before You Fix

## Why this protocol exists

Guess-and-ship debugging is expensive: every wrong fix costs a build, a test pass, and
often a release. Worse, a wrong fix can look right (timing shifts, one manual test
passes) and ship with false confidence. Investigations that follow a structured trace
tend to find the cause in minutes; investigations that skip it tend to take many cycles.

**Do not write fix code until you have passed Gate 3.**

## The pattern that wastes cycles

Illustrative example (invented):

```
Attempt 1: "It hangs. I bet it's parsing." -> Fix parsing -> Ship
Attempt 2: "Still hangs sometimes. Maybe main-thread work?" -> Wrap in Task -> Ship
Attempt 3: "Worked in one manual test" -> Ship with false confidence
Attempt 4: "It's back." -> ...
```

In this kind of story the actual cause is usually something nobody measured: for example,
a loop of a few hundred iterations each doing a small synchronous call on the main actor,
which starves the run loop. Parsing was never the bottleneck, and `Task { @MainActor in }`
does not yield to the UI by itself. Nobody checked either assumption.

## The Gates

### GATE 1: TRACE the execution path

Answer these with evidence (file:line references), not guesses:

1. What user action triggers the bug?
2. What is the FULL execution path from that action to where things go wrong?
3. At which specific point does behavior diverge from expected?

How to trace:
- Start at the user action (button tap, view appear, notification, timer).
- Follow every call. For each function: what does it do, what does it call next, what does it return?
- Write the chain: `UserTaps -> ViewAction -> ViewModel.method -> Service.method -> ...`
- For crashes: find the first frame in your own code and trace backwards to the triggering action.

**CHECKPOINT:** a written trace with file:line for each step. If you cannot trace the full path, investigate that gap rather than guessing.

**Anti-pattern:** "I added logs to see what's happening." You must READ the output and state what it told you. If the logs show nothing, that is information: the path is not being hit, which changes your hypothesis.

### GATE 2: LOCATE the divergence point

Identify the EXACT line where behavior diverges. Not "somewhere in the import flow".

1. At line X the value/behavior is as expected.
2. At line Y it is wrong.
3. Therefore the bug is between X and Y.

For crashes, the divergence is the crash site: what value or state was unexpected, and why did the runtime trap?

**CHECKPOINT:** "At [file:line], [variable/state] is [actual] but should be [expected]."

**Anti-pattern:** "The import hangs, so I'll make the import async." That skips LOCATE. Where does it hang? Which line? What is blocking?

### GATE 3: VERIFY the root cause

Explain WHY the divergence happens, with proof:

1. The mechanism: "A calls B which calls C, and C blocks because [specific reason]".
2. The proof: a measurement, a code read that confirms the mechanism, or a minimal reproduction.
3. A prediction: "If this is the cause, then [specific observable] should be true", then check it.

**CHECKPOINT:** "The bug happens because [mechanism]. I confirmed this by [evidence]. If I'm right, then [prediction], and I verified it is [true/false]."

**Anti-pattern:** "I think it's a threading issue, let me try a Task." Which thread? What is contending? What is the evidence?

### GATE 4: FIX the root cause

Only now write fix code. The fix must:

1. Address the SPECIFIC root cause from Gate 3.
2. Be the minimal change (do not refactor while fixing).
3. Include a comment explaining WHY, so future readers do not undo it.
4. Be checked against the rest of the codebase: the same bug class may exist elsewhere.

### GATE 5: VERIFY with behavioral proof and adjacent flows

One manual test is NOT verification; a fix can pass once and regress later.

1. The specific reproduction case works.
2. You can explain WHY the fix prevents the bug, not just "it seems to work".
3. Where possible, a test would catch a regression.
4. For crashes: builds on every platform you ship, the app launches, and the original trigger no longer crashes.

**Adjacent flow check.** A fix shares state with other flows. Ask, using whichever apply to your change (illustrative):

- If you touched sync or persistence: do import, reset, and relaunch still behave? Does the sync/progress indicator settle, or loop?
- If you introduced a flag or guard: is it reset on logout, data wipe, and relaunch? Does it block the operation when that operation is legitimately needed?
- If you wrote records through a side path: does the layer that normally tracks them (caches, change tokens, pending queues) know about them?

**State pollution check.** Does the fix leave residual state (pending operations, dirty flags, session guards, cache entries) that a later operation could misinterpret? A common failure: a cleanup step removes data but leaves a queued operation that references it, and the queue retries forever.

**Anti-pattern:** "I ran it once and it works now." Did the fix work, or did timing change? If you cannot explain the mechanism, you have not verified.

## The Fix Cascade Anti-Pattern

Illustrative (invented):

```
Fix 1: "Duplicate records after reset" -> add post-sync dedup -> Ship
Fix 2: "Need a single sync path" -> large refactor that also runs dedup -> Ship
Fix 3: "Dedup causes an infinite sync loop" -> add session guard -> Ship
Fix 4: "Stuck pending changes make the UI flicker" -> clear orphaned queue entries -> Ship
```

Four cycles for one problem. Each fix was right for its symptom but created a secondary bug because nobody asked whether the fix left a state the next operation could handle, or whether it created a feedback loop (dedup triggers save, save triggers sync, sync triggers dedup).

After every fix ask: **"What state does this leave behind, and what will the NEXT operation do with it?"** If you cannot answer, Gate 5 is not finished.

## Attempt budget

You get 2 fix attempts per bug. If the second fails:

1. STOP. Do not attempt a third.
2. Return to Gate 1. Your trace is wrong or incomplete; re-read the code from scratch.
3. Consider whether this is an architecture problem rather than a code bug.
4. Check that you are solving the cause, not the symptom.

**Three-fix stop:** if 3 or more fix commits land on the same subsystem in one session, you are symptom-patching. Step back, understand the full lifecycle of the interacting flows, and fix the root interaction.

## Debug session boundary

The session is ACTIVE while the user is supplying diagnostic input. A fix commit made mid-session is a hypothesis, not a conclusion.

Signs it is still active (do not build, bump versions, or push):
- The user is pasting logs, crash reports, or console output, or describing new symptoms.
- The user says "also...", "and another thing...".
- Your regression trace (see `post-fix-trace`) has not come back clean.
- The user has not said they are done.

Even when it looks finished, report the verified fix and wait. Fixing and releasing are separate lifecycles: never bridge from one to the other on your own, and treat a push to any branch that triggers CI builds or deploys as a deploy. Releasing early risks shipping a build that misses a follow-up fix.

## The log verification rule

If you add logging or instrumentation:

1. Run the reproduction.
2. READ the output.
3. State what it showed: "Log at line X shows [value], which means [implication]."
4. If silent: "Log at line X produced NO OUTPUT, so the path is not hit. This eliminates [hypothesis]."

Never add logs and immediately propose a fix.

## Crash investigation

For crashes (EXC_BREAKPOINT, EXC_BAD_ACCESS, SIGABRT), apply these within the gates.

### Crash notes file

Create a short debug note immediately (in whatever location your project uses for debug notes):

```markdown
---
status: investigating
trigger: "[one-line description]"
created: [ISO timestamp]
---
## Symptoms
expected: [what should happen]
actual: [crash type + first frame in your code]
reproduction: [exact steps]
## Eliminated
[hypotheses ruled out, added as you go]
## Evidence
[timestamped entries]
```

### Crash type reference

| Exception | Meaning | Common causes |
|-----------|---------|---------------|
| `EXC_BREAKPOINT (SIGTRAP)` | Swift runtime trap or assertion | Force unwraps, failed preconditions, array out-of-bounds, persistence-framework predicate failures, continuation misuse |
| `EXC_BAD_ACCESS (SIGSEGV/SIGBUS)` | Invalid memory access | Data races, use-after-free, actor-isolation violations, unsafe pointers |
| `EXC_CRASH (SIGABRT)` | Deliberate abort | `fatalError()`, uncaught Objective-C exceptions, framework validation failures |

### Common crash classes

**Predicate / query crashes.** Symptom: `EXC_BREAKPOINT` inside a persistence framework while building a query. Typical cause: a predicate using constructs the framework cannot translate at runtime (for example, generic type parameters with protocol-declared key paths). Fix: simplify the predicate or filter in memory, then search for sibling uses of the same pattern.

**Threading / isolation crashes.** Symptom: non-deterministic `EXC_BAD_ACCESS` in a persistence or data stack. Typical cause: a context or model object used off its owning actor, or model objects passed across actors. Fix: restore the isolation, and pass identifiers instead of model objects.

**Launch crashes.** Symptom: crash before any UI. Typical cause: something synchronous in app initialization (schema setup, migration, config parsing, force-unwrapped resources). Check what runs synchronously at launch.

**Hangs during heavy work.** Symptom: freeze during import or processing. Typical cause: heavy synchronous work on the main thread or main actor, or an unhandled error path. Check whether the work is truly off the main actor, and whether errors are handled.

### Evidence gathering

- Read the code at the crash site: the function, its callers, and what it calls.
- Make sure the trace is symbolicated (dSYMs); unsymbolicated frames are not evidence.
- Check recent changes to the crashing file:
  ```bash
  git log --oneline -10 -- <crashing-file>
  git diff <last-known-good>..HEAD -- <crashing-file>
  ```
- Search the codebase for the same pattern; if one site crashes, siblings may too.
- For hangs and slow paths, profile (Instruments Time Profiler / Hangs, or signposts) instead of guessing.
- Pull crash and hang reports from your telemetry or MetricKit/Xcode Organizer, if available.

### Fix comment pattern

Explain the trap so no one reintroduces it (illustrative):

```swift
/// NOTE: We intentionally avoid `#Predicate` on a generic `T` here. The framework cannot
/// resolve protocol-declared key paths on a generic type at runtime and traps.
/// Filter in memory instead. See your debug notes for the original crash.
```

## Trace patterns by symptom

**UI hang or freeze.** Trace: user action -> view -> view model -> service -> *what runs on the main actor, and for how long?* Common causes:
- N iterations of a modest synchronous operation on the main actor with no yielding (death by a thousand calls).
- Unbounded fetches on large tables.
- Synchronous network, disk, or cloud calls on the main thread.
- Batch loops with no `Task.yield()` or chunking.

**Wrong or missing data.** Trace: data source -> service -> view model -> view -> *where does the value diverge?* Common causes:
- A field not included in a serialization or mapping layer.
- Soft-deleted or inactive records included (or excluded) by a missing filter.
- Derived values (totals, counts) not recalculated after a change.

**Silent failure.** Trace: expected path -> *add checkpoint logging at each step* -> which checkpoint is never hit? Common causes:
- A remote service or serializer silently dropping unknown fields (schema drift).
- An error swallowed by a helper that returns an empty result.
- A conditional taking the wrong branch.

## Quick reference

```
GATE 1 TRACE:   full path with file:line; every call followed; logs read and interpreted;
                crashes: first in-app frame identified, notes file created
GATE 2 LOCATE:  "At [file:line], [actual] but should be [expected]"
GATE 3 VERIFY:  mechanism explained; evidence (read, measurement, repro); prediction confirmed
GATE 4 FIX:     targets the Gate 3 cause; minimal; WHY comment; same pattern checked elsewhere
GATE 5 VERIFY:  repro passes; mechanism explained; adjacent flows and leftover state checked;
                crashes: builds, launches, trigger no longer crashes; regression test if possible
BUDGET:         2 attempts max. If fix #2 fails: STOP, re-trace from Gate 1.
```

## Lessons log

Before investigating, read your project's debug/lessons log (if it keeps one) and check whether the symptom matches a past root cause; test that first. After resolving, append: symptom, red herrings, root cause, fix, attempts used, and a one-sentence lesson for future pattern matching.

## When to use

Use for any bug where something compiles but behaves wrongly: hangs, wrong data, silent failures, logic bugs, slow paths, intermittent bugs, crashes, launch crashes, and crash reports from users or MetricKit.

Not for: plain compile errors (fix the compiler error) or missing features (that is a feature request).

## After the fix

After Gate 5, run a regression trace (see `post-fix-trace`) to map the blast radius of the change, then capture regression tests from the session (see `debug-test-capture`). The session is complete only when the regression trace comes back clean.

## Related skills

- `post-fix-trace`: second-pass regression trace after every fix
- `debug-test-capture`: turn the debug session into regression tests
