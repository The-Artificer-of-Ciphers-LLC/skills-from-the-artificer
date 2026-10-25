---
name: aposd-red-flag-review
description: Review a diff, module, or design for complexity using the red flags from John Ousterhout's "A Philosophy of Software Design" (2018). Use when asked to review code or a design for maintainability, "is this too complex", "why is this hard to change", "design review", "check for shallow modules", "information leakage", or when a change touches module boundaries, interfaces, or splits one piece of logic into many small classes or steps. Use it even when the user never mentions the book. It audits an existing change and reports findings; use `codebase-design` when you are designing or deepening an interface from scratch.
---

# APOSD Red-Flag Review

Ousterhout's thesis: complexity is anything in a system's structure that makes it hard to understand or modify. It accumulates in small increments, so review is the cheapest place to stop it. This skill turns the book's diagnostics into a review pass. It is an **audit**: it reads a change and reports. It does not redesign. For redesign, hand off to `codebase-design` (deep-module vocabulary, seam placement, design-it-twice).

These are judgment heuristics, not metrics. Report evidence and a confidence, not a score.

## Step 1: Diagnose with the three symptoms

Ask of the change (or the area it touches) whether any symptom is present. A symptom with no red flag behind it is still worth reporting.

| Symptom | Test |
|---|---|
| Change amplification | Would a plausible small future change (a new field, a renamed concept) require edits in many places? |
| Cognitive load | How much must a reader hold in their head to modify this safely: hidden ordering rules, flags, shared state, special cases? |
| Unknown unknowns | Is it unclear what else must change, or what could break? This is the worst symptom because nothing in the code warns you. |

Trace each symptom to a cause. There are only two:

- **Dependencies**: code cannot be understood or changed in isolation.
- **Obscurity**: important information is not obvious (vague names, undocumented invariants, hidden coupling).

## Step 2: Scan for red flags

For each, cite `file:line` and say what the reader pays for it.

- **Shallow module**: the interface is nearly as complex as the implementation. Test: delete it. If the complexity just moves to callers, it was earning its keep; if nothing is lost, it was a pass-through.
- **Information leakage**: one design decision (a file format, a protocol, a table layout, an ordering) is encoded in more than one module, so changing it means editing several.
- **Temporal decomposition**: modules are split by when things happen (read, then parse, then write) instead of by what knowledge each hides. It is a common cause of leakage, because the same format knowledge ends up in both the reader and the writer.
- **Pass-through method**: a method that only forwards its arguments to a similar signature elsewhere, adding no abstraction of its own.
- **Pass-through variable**: a value threaded through layers that don't use it. Consider whether a shared object or a different owner removes the threading.
- **Overexposure**: a common-case use forces the caller to learn rarely needed features. Defaults should serve the common case.
- **Vague or hard-to-pick name**: if you cannot find a precise name, the thing probably does more than one job. A vague name is also a design smell, not only a style issue.
- **Special-general mixture**: a general-purpose module carries code specific to one caller or one use case.
- **Conjoined methods**: two pieces of code that cannot be understood without each other, though they live apart.

## Step 3: Weigh before you report

The book's own caveat: the goal is lower total complexity, not a count of flags. Before reporting a finding, check:

- Is the "shallow" module an intentional seam that something actually varies across (two real adapters)? Then it is justified.
- Is the duplication a leak, or two decisions that merely look alike today?
- Would fixing it add more interface than it removes?

Drop findings that fail these checks. A short list of real findings beats a long list of nits.

## Contested areas: present both sides

Do not enforce these as rules. If one comes up, state the default and the dissent.

- **Comments**: Ousterhout treats interface comments as a design tool (writing the comment first tests the abstraction) and wants them to capture intent, contracts, and non-obvious information. Robert Martin (Clean Code) distrusts comments and prefers descriptive names. Both accept comments for what code cannot express. Default: require a comment where intent or a contract is non-obvious; do not demand comments that restate the code.
- **Method length**: Ousterhout argues very short methods produce shallow interfaces and entangled pieces; Clean Code favors small functions. Flag over-decomposition only when the pieces cannot be understood independently, and say it is a trade-off.

## Output

```
## APOSD review
Scope: <what was reviewed>
Symptoms: <which of the three, with the cause: dependencies / obscurity>
Findings (most costly first):
1. <red flag> — file:line — what it costs a reader/maintainer — suggested direction (one line) — confidence high/med/low
Not flagged on purpose: <seams or short methods you judged justified>
Hand-off: <codebase-design if a finding needs a redesign, otherwise none>
```
