---
name: skills-from-the-artificer
description: Dispatcher for the Artificer laws-of-software collection (24 laws). Given ANY proposed change, fix, diff, PR, design, ADR, refactor, or architecture decision, classify it and apply only the laws that fire — instead of recalling all 24. Invoke whenever the user or a workflow says "which laws apply", "Artificer laws", "cross-reference against the laws of software", "run the artificer review", "apply the laws of software", "classify and list applicable laws", "safety, optimization, and legacy principles" (bug-fixer Step 2), or asks whether a design, fix, PR, API/CLI-output change, parser, metric/ratchet, rewrite, or new dependency has any software-law problems — even if no law is named. Also invoke during design reviews, PR reviews, triage architecture forks, and feature-builder design steps. Prefer this over loading individual law skills for a change that could touch several laws; use a single law skill directly only when the user asks about that one law by name.
---

# Skills from the Artificer — Law Dispatcher

A **router plus a fast lens table**. The collection has 24 law skills; a change usually trips 1–4 of them. Classify the change, apply the matching lenses, report. Speed matters: this runs inside unattended workflows (bug-fixer Step 2, feature-builder design, review-open-prs, triage architecture fork), so answer from the lens table below and load a full law skill only when a lens fires and you need its depth. Loading every matched law as a separate step is what made past runs slow, and the loaded text mostly restates the lens.

## Procedure

1. **Gather the subject.** For a diff, read the changed lines (`git diff <base>...HEAD`), not only the description. For a design, read the design text. State the subject in one sentence.
2. **Classify** against the signal table. Pick the 1–4 laws whose signal is actually present. Matching none is a valid result — force-fitting a law is its own failure.
3. **Apply each lens** using the question in the table, answered against this specific change (name the file/symbol/contract). Load `<law>/SKILL.md` only if the lens fires and you need its remedies.
4. **Report** in the output format below. Do not ask the user anything; produce the report and let the caller decide.

## Signal → law → lens

| Signal in the change | Law | Lens: the question to answer |
|---|---|---|
| Public API, CLI output/exit codes, file formats, JSON shapes, error text, ordering; "is this breaking?"; migrating call sites; fixing a long-lived bug | `hyrums-law` | Who could depend on the old observable behavior (scripts parsing output, tests pinning text, ordering)? Is there a version/deprecation path? |
| Parsers, validators, loaders, protocol/format handling, regex over text output, strict-vs-lenient input | `postels-law` | Is each boundary deliberately strict or lenient, and is lenient input normalized once at the edge rather than propagated? |
| Auth, secrets, guards, hooks, sandboxing, anything whose safety rests on being unknown | `kerckhoffs-principle` | Would this still be safe if the mechanism were public? Is the secret only the key? |
| Optimization, caching, "make it faster", clever data structures | `knuths-optimization-principle`, `wirths-law` | Was the bottleneck measured? Does the complexity buy a proven gain, or add a maintenance/perf cost of its own? |
| Hardware/CI-capacity assumptions ("runners will catch up") | `moores-law` | Does the plan rely on capacity growth that isn't guaranteed? |
| Dense/clever code, hard-to-debug logic, long regexes, nested conditionals | `kernighans-law` | Could the author debug this at 2 a.m.? Is cleverness spent that debugging will need? |
| Homegrown config language, rules engine, DSL, template/include/conditional layer | `greenspuns-tenth-rule` | Is this an ad-hoc, bug-ridden reimplementation of an existing language/tool? |
| ORM/framework/library internals leaking; abstraction breaking down; platform quirks (Windows paths, argv limits) | `leaky-abstractions` | What does the abstraction hide that this change now depends on? Is the leak handled at one seam? |
| New framework, library, datastore, runtime, or a rewrite | `choose-boring-technology` | Is this spending an innovation token where boring tech would do? |
| Big new system or big-bang rewrite from scratch | `galls-law` | Does a working simple system exist to evolve instead? Can it ship in increments? |
| Module/service/ownership boundaries; org-shaped architecture; core vs plugin split | `conways-law` | Does the boundary match who owns and changes each side? |
| Review process, reviewer count, bug-finding via more eyes | `linuss-law` | Does the process actually put independent eyes on the risky part? |
| Metrics, thresholds, ratchets, coverage/mutation scores, velocity, anything scored | `goodharts-law` | Once this number is a target, how will it be gamed or stop measuring the real thing? |
| Estimates, schedules, sharding/timing tables, deadlines | `hofstadters-law`, `parkinsons-law` | Is the estimate padded for the known unknowns? Will the work expand to fill the slot? |
| Scope creep, "let's also add…", a tool growing past its purpose | `zawinskis-law` | Is this change absorbing an unrelated responsibility? |
| Promotions, career ladders, team-role fit | `peter-principle` | Is competence in the current role being rewarded with a role it doesn't predict? |
| Product-team culture, motivation, outsourcing | `doerrs-law` | Missionary or mercenary ownership? |
| Legacy system that won't die; a tool sustaining the problem it solves | `shirky-principle` | Does the institution/tool depend on the problem persisting? |
| Eliciting feedback; drafting a question or PR description | `cunninghams-law` | Would a confident, checkable claim draw better correction than an open question? |
| UI layout, click/touch targets | `fitts-law` | Are frequent targets large and near? |
| Claims about AI/machine creativity | `lady-lovelaces-objection` | Is "originating" being claimed for recombination? |
| Growth/adoption/"exponential" claims | `norvigs-law` | At the current adoption level, is another doubling still mathematically possible? |

## Presets

Named bundles; apply all listed lenses.

- **`bugfix-review`** (safety · optimization · legacy) — `kerckhoffs-principle`, `postels-law`, `hyrums-law`, `kernighans-law`, `knuths-optimization-principle`, `leaky-abstractions`. Does the fix keep security intact, hold the right strict/lenient boundaries, avoid breaking behavior others rely on, stay debuggable, avoid premature optimization, and respect the abstraction it touches?
- **`design-review`** — `galls-law`, `choose-boring-technology`, `conways-law`, `greenspuns-tenth-rule`, `zawinskis-law`
- **`api-review`** — `hyrums-law`, `postels-law`, `kernighans-law`
- **`consolidation-review`** (dedupe/single-owner refactors, drift guards, ratchets) — `hyrums-law`, `postels-law`, `goodharts-law`, `leaky-abstractions`
- **`planning-review`** — `hofstadters-law`, `parkinsons-law`, `goodharts-law`

## Output format

Workflows paste this into PR bodies and design docs under "Laws that apply", so keep this shape:

```
## Laws that apply
Subject: <one sentence>
- **<law>** — fired: <what it surfaced for this change, naming the file/symbol>. Action: <change to make, or "none — already honored because …">.
Considered and cleared: <law>, <law> (one clause why each does not apply)
Action items: <numbered list, or "none">
```

If nothing fires: `## Laws that apply` / `None fire — <one-sentence reason>.`

## Notes

- This skill never overrides a law's own guidance; it only decides which laws are in scope.
- Order findings most change-specific first.
- The lens questions are prompts for thinking, not verdicts. A lens that "fires" needs a concrete consequence for this change; otherwise it is cleared.
