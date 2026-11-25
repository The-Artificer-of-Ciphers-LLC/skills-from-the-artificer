<!-- Part of /review-open-prs (commands/review-open-prs.md). Read this file in full when the run reaches this section. -->

### 8. Compose and post the GitHub review
**[BLOCKING]**
**ZERO-TOLERANCE APPROVAL POLICY:** Minor issues are NOT approvable. Every issue (including nits) MUST be fully resolved. Merge conflicts immediately block approval.

**REVIEW-PASSES LEDGER (BLOCKING — no row may be absent; hard rule 9 governs).** Before composing a verdict on a full review (the §1.5 conflict-only review has its own listed steps), build this ledger from tool results of THIS run for THIS head sha and put it in the review body as `### Review passes`, one line per row, each citing the evidence the row names. A row with no evidence is a missing step: do not post; run it now, or, if the call itself fails after being attempted, end the run with `OUTCOME: blocked` and the failed call verbatim.
   1. Every numbered step of the track (§3A for a bug fix, §3B for a feature or enhancement), each with its evidence (the `Skill` call made, the file written, the tool result).
   2. `/qa-test-architect` — the `Skill` call and its output.
   3. `/skills-from-the-artificer` — the `Skill` call and the returned `## Laws that apply` block.
   4. `/code-review` — the subagent run and the `FILE:` path it returned.
   5. `/security-review` — the subagent run and the `FILE:` path it returned.
   6. Isolated adversarial pass — the fresh-subagent run and the `FILE:` path it returned.
   7. Deterministic Review Pass (§3D) — the commands run and their results.
   8. Every other step the track names (`/diagnose`, `/root-cause-analysis` or the manual comparison it requires, `/rubber-duck`, `/codebase-design`, `/writing-documentation-with-diataxis`, the ADR and documentation gates).
   The ledger never contains a "not run", "skipped", "not needed" or "covered by" row, and the review body never carries an "Other passes" paragraph that explains an absent pass by diff size or by the agent's own reading. A review posted without the complete ledger is a violation; correct it per hard rule 9.

Structure: the line `AI-assisted review by @trek-e.` → Summary → Classification & gate compliance → Functional checklist / Root-cause verdict → Blast radius (from `codegraph impact`) + risk tier and why (§1.11b) → Co-change completeness (from 4C) → **`### Graph Evidence`** → Findings by severity (Blocker/Major/Minor/Nit) → Verdict.

Deterministic findings (§3D) and judgment findings (`/code-review`, `/security-review`, the isolated adversarial pass) both land in the severity list, but **attribute each one to its source**. A §3D.2 removed-symbol-still-referenced from `codegraph callers` is a fact about the graph and is not negotiable in review discussion; a style or design objection is a judgment the contributor may reasonably push back on. Merging the two into one undifferentiated list is how a hard finding gets argued away.

Assemble the body by reading the `FILE:` paths returned by each spawned agent (per the output contract in the core file, step 4) — not from agent reply text.

#### 8.1 `### Graph Evidence` is MACHINE-ENFORCED — the post is DENIED without it
`require-memtrace-evidence.sh` (gsd-core-hooks; the file keeps its old name so existing installs keep working) is a PreToolUse Bash hook. It intercepts any command matching `gh pr review … --approve` or `--request-changes` and **denies the call** unless the body has an evidence section — **`### Graph Evidence`** (the old `### Memtrace Evidence` and `### CodeGraph Evidence` headings are still accepted) — that names a blast-radius call: `codegraph impact` or `get_impact`.

Under that heading, document target and finding for:
- the blast radius (`codegraph impact`, and `get_impact` too on a full-tier PR);
- callers and callees of the changed symbols (`codegraph callers|callees|node`);
- the recorded-decision check: what the §2 `recall_decision` returned on a full-tier PR, or that it was skipped and why;
- each §3D deterministic check and its result, including any that could not run.

The hook only checks that a blast-radius call is named. Only you can check that it answered; never name a call that did not run.

`gh pr review --comment` is **exempt** from this gate — use the comment form for direction/mechanical-block notes (red CI, rebase-needed, pending-approval CI) where a full graph pass isn't warranted.

#### 8.2 Posting mechanics — `--body-file` must be a LITERAL, fully-expanded path
The hook reads the body by `sed`-extracting the path from the **raw command text** (`.tool_input.command`), never from shell-expanded argv. Anything requiring the shell to expand is invisible to it and denies with the misleading *"No body found"*:

- ✅ `--body-file /abs/path/review.md` — bare
- ✅ `--body-file "/abs/path/review.md"` and `'/abs/path/review.md'` — quoted forms are handled (the hook runs the quoted patterns first)
- ❌ `--body-file "$BODY"` · `--body-file $(mktemp)` · `--body-file <(...)` — **never expand; always denied**

Write the body to the scratchpad, then paste the resulting absolute path literally into the command text:

```bash
gh pr review 2412 --request-changes --body-file /abs/path/to/scratchpad/pr-2412-review.md
```

#### 8.3 Approve only on green CI for this head SHA — and never wait for it
An empty finding list is proof the *review* found nothing, not that the commit builds and passes (the #4599 incident:
a real defect existed that only the CI run caught). So an empty list is a **tentative** Approve, decided by core step 6:
post `--approve` only when CI for this exact head SHA is complete and green; when CI is queued, pending or running,
release it if §9 allows, record `waiting-on-ci` in the ledger, and end the run. The next run reads the finished CI and
posts the verdict. If CI fails for a reason in this PR's diff, the tentative Approve was wrong: add that failure as a
Blocker and post `changes-requested` instead.

If the verdict carries any finding, post `changes-requested` now. §9's CI release for that case happens only when every
finding is a Nit; with any Blocker/Major/Minor finding, CI stays queued (the fix push triggers it, and releasing now would
double the CI cost).

Post-review status updates:
1. Apply the appropriate GitHub label (`changes-requested` or `approved`).
2. Clear outdated review-status labels.
3. Apply the domain-area label.
