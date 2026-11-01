<!-- Part of /review-open-prs (commands/review-open-prs.md). Read this file in full when Phase B reaches this section. -->

### 4A. Test-quality compliance (both tracks)
**[BLOCKING]**
Violations are findings:
- `RULESET.TESTS.no-source-grep=ESLint rule local/no-source-grep (eslint-rules/no-source-grep.cjs, wired in eslint.config.mjs, run by npm run lint and the CI "Lint — ESLint" step) rejects readFileSync of a source .cjs/.js/.ts path followed by .includes()/.match()/.startsWith()/.endsWith()/.indexOf()/.search(); CI hard-fail. Exemption: // allow-test-rule: <reason> with the #NNN on the SAME line` — **do not cite `scripts/lint-no-source-grep.cjs`; ADR-452 retired it and that path now fails `MODULE_NOT_FOUND`.**
- `RULESET.TESTS.boundary-coverage=tests MUST exercise inputs at and near the threshold/limit, not only trivial-fit and trivial-overflow; pick inputs where N ∈ {limit-1, limit, limit+1}`
- `RULESET.TESTS.no-timing-assertion=do not assert on wall-clock elapsed time; use clock-seam pattern with node:test mock.timers`
- `RULESET.TESTS.property-based-testing=modules implementing parsing / transformation / budget-limit / bijective contracts must include at least one fast-check (fc) property test`
- `RULESET.TESTS.delete-bad-tests=pass-always / vacuous-truth / source-grep / elapsed-time / real-race tests are DELETED and replaced with compliant tests in the same PR`
- `RULESET.TESTS.mutation-score=Stryker runs incremental (--since origin/next); default threshold 80% killed/total; surviving mutants block merge`

**Quality graph pass:** run `mcp__memtrace__find_dead_code` (zero-caller symbols the PR adds or leaves) and `mcp__memtrace__get_function_quality_metrics` / `mcp__memtrace__find_hotspots` on changed functions (complexity × churn). Zero-caller or critical-risk changed functions are findings.

> **Two calibration facts, so these numbers are cited correctly in §8.**
> - **`find_dead_code` is reachability, not grep.** Zero callers here accounts for every typed call edge Memtrace indexed — a far stronger claim than "no grep hits," and worth stating as such when you flag an addition as dead. It excludes exported symbols, process entry points, and test files by default; pass `include_tests: true` when the PR's dead-code risk is in the test surface itself.
> - **Two different risk scales exist and they disagree on the same function.** `calculate_cyclomatic_complexity` bands on complexity alone (low ≤10, medium 11–20, high 21–50, critical >50). `get_function_quality_metrics` and `find_most_complex_functions` also weigh direct callers (critical at complexity >50 **or** callers >40; high at >20 or >15; medium at >10 or >5). Name the producing tool whenever you quote a risk level — "critical" from one is not "critical" from the other, and a §8 Blocker resting on an unattributed band is not defensible. Cognitive complexity (via `get_function_quality_metrics`) follows the SonarSource definition and penalizes nesting over raw branch count — it is the better number when the finding is "this is unreadable," while cyclomatic is the better number when the finding is "this is undertested."

### 4B. CONTEXT.md standards conformance (both tracks)
**[BLOCKING]**
Grep `CONTEXT.md` for every predicate class the diff touches. Cite verbatim. Cross-check against recorded contracts with `mcp__memtrace__governing_rules({repo_id, file_path})` on the changed files — the path-keyed call, since `governing_contracts` requires a Cortex `symbol_id` that no tool returns. A convention violation the grep misses is still a finding (and per §2, a `CannotProve` means *unproven*, not *unconstrained*; an `unavailable` means the check never ran at all). No variable renames unless explicitly required by the linked issue.

**Unwritten house style:** `CONTEXT.md` encodes the rules someone wrote down. `mcp__memtrace__get_style_fingerprint` measures the ones nobody did — empirical histograms of competing idioms (ternary vs if-else, arrow vs function declaration, `const` vs `let`, `await` vs `.then`, early return vs nested), with `dominant_idioms` as the load-bearing output. Pass `file_path` for a changed file and read `delta_from_codebase_norm`: a file that suddenly diverges from the repo norm is a contributor importing their own house style, which is exactly the drift that no lint rule catches and every reviewer argues about from memory.

> **This tool is descriptive, not prescriptive** — it reports what the codebase does, not what it should. A style delta is a **Nit** you can now state with a number instead of a preference, and on its own it is never a Blocker. Ratios come back `null` below 20 observations on a dimension, which means the codebase has no norm there; do not manufacture a finding out of a `null`.

### 4C. Completeness / co-change gate (both tracks)
**[BLOCKING]** *Catches the missing half of a change.*
For each changed file, run `mcp__memtrace__get_cochange_context` — same-commit coupling from history, which is behavioral where `get_impact` is structural, and therefore catches the missing half of a change that has no call edge to the changed code at all. (§1.11's `preflight_check` already returned co-change partners per symbol; this is the file-level sweep, and the two should agree — where they don't, the discrepancy is worth a look before you dismiss it.) Any file that historically co-changes with a changed file but is **absent from this diff** is a flagged finding — a candidate missing update. Priority suspects for this repo: `docs/INVENTORY.md` + manifest regen when `src/`, `references/`, or `workflows/` change; `CONTEXT.md` glossary on module changes; `.changeset/*` on user-facing diffs; a parallel surface when a shared constant/parser is edited (the "generative fix divergence" class).
