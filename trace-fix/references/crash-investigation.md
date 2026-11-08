# Crash investigation

Companion to the `trace-fix` skill for EXC_BREAKPOINT, EXC_BAD_ACCESS and SIGABRT crashes. The five
gates in `SKILL.md` still apply; this file holds the crash-specific material used inside them.


## Contents

- [Crash notes file](#crash-notes-file)
- [Crash type reference](#crash-type-reference)
- [Common crash classes](#common-crash-classes)
- [Evidence gathering](#evidence-gathering)
- [Fix comment pattern](#fix-comment-pattern)

## Crash notes file

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

## Crash type reference

| Exception | Meaning | Common causes |
|-----------|---------|---------------|
| `EXC_BREAKPOINT (SIGTRAP)` | Swift runtime trap or assertion | Force unwraps, failed preconditions, array out-of-bounds, persistence-framework predicate failures, continuation misuse |
| `EXC_BAD_ACCESS (SIGSEGV/SIGBUS)` | Invalid memory access | Data races, use-after-free, actor-isolation violations, unsafe pointers |
| `EXC_CRASH (SIGABRT)` | Deliberate abort | `fatalError()`, uncaught Objective-C exceptions, framework validation failures |

## Common crash classes

**Predicate / query crashes.** Symptom: `EXC_BREAKPOINT` inside a persistence framework while building a query. Typical cause: a predicate using constructs the framework cannot translate at runtime (for example, generic type parameters with protocol-declared key paths). Fix: simplify the predicate or filter in memory, then search for sibling uses of the same pattern.

**Threading / isolation crashes.** Symptom: non-deterministic `EXC_BAD_ACCESS` in a persistence or data stack. Typical cause: a context or model object used off its owning actor, or model objects passed across actors. Fix: restore the isolation, and pass identifiers instead of model objects.

**Launch crashes.** Symptom: crash before any UI. Typical cause: something synchronous in app initialization (schema setup, migration, config parsing, force-unwrapped resources). Check what runs synchronously at launch.

**Hangs during heavy work.** Symptom: freeze during import or processing. Typical cause: heavy synchronous work on the main thread or main actor, or an unhandled error path. Check whether the work is truly off the main actor, and whether errors are handled.

## Evidence gathering

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

## Fix comment pattern

Explain the trap so no one reintroduces it (illustrative):

```swift
/// NOTE: We intentionally avoid `#Predicate` on a generic `T` here. The framework cannot
/// resolve protocol-declared key paths on a generic type at runtime and traps.
/// Filter in memory instead. See your debug notes for the original crash.
```
