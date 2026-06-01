---
name: skills-from-the-artificer
description: Dispatcher for the Artificer laws-of-software collection. Given a proposed change, fix, diff, design, or decision, classify it and invoke the relevant law/principle skill(s) — instead of recalling all 24 individually. Use when the user says "cross-reference against the Artificer laws", "which laws apply here?", "run the artificer review", "apply the laws of software to this", or when a code/design review wants the relevant software-law lenses surfaced automatically. Also the entry point for Step 2 of the Bug Remediation workflow ("adheres to safety, optimization, and legacy software principles").
---

# Skills from the Artificer — Law Dispatcher

This is a **router**, not a law itself. The collection ships 24 laws-of-software reference skills. Rather than recall each one, invoke this skill with a change or decision in hand; it classifies the work and points you at the specific law skill(s) worth applying.

## How to use

1. **Gather the subject.** Identify what you're evaluating: a code diff, a proposed fix, an architecture decision, a plan/estimate, a metric, an API change. If a diff is in play, look at the actual changed lines (`git diff`), not just the description.
2. **Classify it** against the signal table below. A single change usually hits 1–4 laws — not all 24. Resist the urge to dump the whole catalogue.
3. **Invoke each matched law skill** by its name (e.g. run the `hyrums-law` skill, or read `<law>/SKILL.md`). Apply its "Key questions" section to the change.
4. **Report** which laws fired, what each surfaced, and any action items. If nothing matches, say so — a no-op is a valid result.

## Signal → law mapping

| If the change involves… | Apply |
|---|---|
| A public API, interface, or widely-used contract; backward compatibility; deprecation; "is this breaking?" | `hyrums-law` |
| Input validation, parsing, protocol/format handling, strict-vs-lenient acceptance | `postels-law` |
| Security, auth, encryption, or relying on a hidden algorithm/design for safety | `kerckhoffs-principle` |
| Performance work, optimization, "make it faster", complex structures for speed | `knuths-optimization-principle`, `wirths-law` |
| Compute/hardware-trend assumptions ("hardware will catch up") | `moores-law` |
| Clever/terse code, one-liners, hard-to-debug logic, readability tradeoffs | `kernighans-law` |
| A homegrown config language, rules engine, DSL, or templating/scripting layer | `greenspuns-tenth-rule` |
| An ORM/framework/library leaking its internals; an abstraction breaking down | `leaky-abstractions` |
| Adding a new framework/library/datastore, or proposing a rewrite | `choose-boring-technology` |
| Building a big new system from scratch / a big-bang rewrite | `galls-law` |
| Module boundaries, service splits, ownership, org-shaped architecture | `conways-law` |
| Code review process, how many reviewers, bug-finding via more eyes | `linuss-law` |
| Metrics, OKRs, KPIs, velocity, anything people are scored on | `goodharts-law` |
| Time estimates, schedules, "how long will this take", missed deadlines | `hofstadters-law`, `parkinsons-law` |
| Scope/feature creep, "let's also add…", a product expanding past its purpose | `zawinskis-law` |
| Promotions, career ladders, IC→manager moves, team competence/fit | `peter-principle` |
| Product-team culture, motivation, engagement, outsourcing decisions | `doerrs-law` |
| A legacy system that won't die / a tool prolonging the problem it solves | `shirky-principle` |
| Eliciting feedback, getting answers, drafting a question or PR description | `cunninghams-law` |
| UI layout, click/touch targets, button placement, menus | `fitts-law` |
| Claims about AI creativity / machines "originating" ideas | `lady-lovelaces-objection` |
| Growth/adoption claims, "exponential", "will double", market-size math | `norvigs-law` |

## Presets

Named bundles for common review contexts. Invoke the listed laws together.

- **`bugfix-review`** (safety · optimization · legacy) — the Bug Remediation workflow's Step 2 cross-reference:
  `kerckhoffs-principle`, `postels-law`, `hyrums-law`, `kernighans-law`, `knuths-optimization-principle`, `leaky-abstractions`
  → Does the fix preserve security? Stay lenient/strict at the right boundaries? Avoid breaking observable behavior others depend on? Stay debuggable? Avoid premature optimization? Respect the abstraction it touches?
- **`design-review`** (is this the right shape?) —
  `galls-law`, `choose-boring-technology`, `conways-law`, `greenspuns-tenth-rule`, `zawinskis-law`
- **`api-review`** (will this age well?) —
  `hyrums-law`, `postels-law`, `kernighans-law`
- **`planning-review`** (will this ship on time / measure the right thing?) —
  `hofstadters-law`, `parkinsons-law`, `goodharts-law`

## Notes

- This skill never overrides a law's own guidance — it only decides *which* laws are in scope. Read the matched skill before drawing conclusions.
- When several laws fire, apply them in the order listed (most change-specific first).
- Matching zero laws is fine. Don't force-fit a law to look thorough — that's its own anti-pattern.
