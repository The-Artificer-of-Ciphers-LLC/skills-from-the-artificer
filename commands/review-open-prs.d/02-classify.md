<!-- Part of /review-open-prs (commands/review-open-prs.md). Read this file in full when the run reaches this section. -->

### 2. Classify via linked-issue labels
**[BLOCKING]**
Cite verbatim:
- `RULESET.CONTRIB.CLASSIFY.fix=requires confirmed/confirmed-bug before implementation`
- `RULESET.CONTRIB.CLASSIFY.enhancement=requires approved-enhancement before implementation`
- `RULESET.CONTRIB.CLASSIFY.feature=requires approved-feature before implementation`

`confirmed-bug` → **Bug-Fix Track**. `approved-feature` / `approved-enhancement` → **Feature Track**. Missing label = gate violation. Ambiguous = put the question in the report under `QUESTIONS FOR @trek-e`, post no review that depends on the classification, and HALT.

**Recorded-decision check (both tracks):** grep `docs/adr/` and `CONTEXT.md` (`DEFECT.*`, `RULESET.*`) for decisions, bans and conventions that govern the changed files. On a **full-tier** PR (§1.11b) with `MEMTRACE` = `lean`, also run **one** `mcp__memtrace__recall_decision({query})` — free-text over recorded decisions; the param is **`query`**, never `question` — with a query naming the changed area and the linked issue. That is the one recorded-decision source with no free equivalent. If the change violates a recorded ban, convention, or prior decision, that is a **Blocker** finding regardless of label.

> **Read what came back, not the absence of an error.** An empty `recall_decision` result, a quota-error payload, or an unavailable Memtrace means the check found nothing *or did not run*, which is exactly what an undocumented violation also looks like. Never write "no recorded decision governs this change" on the strength of one; write what the call actually returned, or that it was skipped (light tier, `MEMTRACE` = `off`, or quota).

> `recall_decision` is no longer required by the §8 posting hook. It runs on full-tier PRs only; the Cortex verdict tools (`governing_rules`, `verify_intent`, `get_arc`, `why_is_this_here`, `governing_contracts`) are not called.
