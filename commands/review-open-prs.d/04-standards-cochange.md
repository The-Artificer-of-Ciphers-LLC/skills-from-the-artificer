<!-- Part of /review-open-prs (commands/review-open-prs.md). Read this file in full when the run reaches this section. -->

### 4A. Test-quality compliance (both tracks)
**[BLOCKING]**
Violations are findings:
- `RULESET.TESTS.no-source-grep=ESLint rule local/no-source-grep (eslint-rules/no-source-grep.cjs, wired in eslint.config.mjs, run by npm run lint and the CI "Lint — ESLint" step) rejects readFileSync of a source .cjs/.js/.ts path followed by .includes()/.match()/.startsWith()/.endsWith()/.indexOf()/.search(); CI hard-fail. Exemption: // allow-test-rule: <reason> with the #NNN on the SAME line` — **do not cite `scripts/lint-no-source-grep.cjs`; ADR-452 retired it and that path now fails `MODULE_NOT_FOUND`.**
- `RULESET.TESTS.boundary-coverage=tests MUST exercise inputs at and near the threshold/limit, not only trivial-fit and trivial-overflow; pick inputs where N ∈ {limit-1, limit, limit+1}`
- `RULESET.TESTS.no-timing-assertion=do not assert on wall-clock elapsed time; use clock-seam pattern with node:test mock.timers`
- `RULESET.TESTS.property-based-testing=modules implementing parsing / transformation / budget-limit / bijective contracts must include at least one fast-check (fc) property test`
- `RULESET.TESTS.delete-bad-tests=pass-always / vacuous-truth / source-grep / elapsed-time / real-race tests are DELETED and replaced with compliant tests in the same PR`
- `RULESET.TESTS.mutation-score=Stryker runs incremental (--since origin/next); default threshold 80% killed/total; surviving mutants block merge`

**Quality pass:** a symbol the PR adds with zero callers in `codegraph callers` (excluding exports, entry points and tests) is a dead-code finding; say it is reachability from CodeGraph's index, not a grep. Flag changed functions whose complexity the repo's lint config already limits, and cite the lint rule rather than a band you computed.

### 4B. CONTEXT.md standards conformance (both tracks)
**[BLOCKING]**
Grep `CONTEXT.md` for every predicate class the diff touches. Cite verbatim. Cross-check against `docs/adr/` and, on a full-tier PR, the §2 `recall_decision` result. A convention violation the grep misses is still a finding (and per §2, an empty or unavailable result means the check found nothing or never ran, not that nothing governs the code). No variable renames unless explicitly required by the linked issue.

**Unwritten house style:** a file that departs from the idioms of its neighbours (arrow vs function declaration, `await` vs `.then`, early return vs nested) is at most a **Nit**, stated by pointing at the neighbouring code. It is never a Blocker on its own.

### 4C. Completeness / co-change gate (both tracks)
**[BLOCKING]** *Catches the missing half of a change.*
For each changed file, list the files that changed in the same commits over the last year: `git log origin/next --since=1.year --format=%H -- <file> | xargs -n1 git show --format= --name-only | sort | uniq -c | sort -rn | head`. That is same-commit coupling from history, which is behavioral where `codegraph impact` is structural, and therefore catches the missing half of a change that has no call edge to the changed code at all. Any file that historically co-changes with a changed file but is **absent from this diff** is a flagged finding — a candidate missing update. Priority suspects for this repo: `docs/INVENTORY.md` + manifest regen when `src/`, `references/`, or `workflows/` change; `CONTEXT.md` glossary on module changes; `.changeset/*` on user-facing diffs; a parallel surface when a shared constant/parser is edited (the "generative fix divergence" class).
