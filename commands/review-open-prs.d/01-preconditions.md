<!-- Part of /review-open-prs (commands/review-open-prs.md). Read this file in full when Phase B reaches this section. -->

### 1. Preconditions
**[BLOCKING]**
1. **Initialize & Rebase State — DETECT HERE, PUSH IN §9A. Never rebase-push at precondition time.**
   Fetch `origin/next`. Compare the PR branch base against `origin/next`. If the PR branch is
   behind, record **how far behind** and **whether it rebases cleanly** — prove the latter in a
   throwaway worktree (`git worktree add --detach`, rebase, inspect) or with `git merge-tree`.
   **Do NOT push the rebase here.**

   > A rebase-push force-updates a *contributor's* branch and triggers their full CI matrix. Both
   > are real costs spent on someone else's repo, and at precondition time you have **no verdict**
   > that justifies either — §1 runs before the substance review in §§3-7. This is the identical
   > ordering error §1.6c already corrects for CI release, and it is corrected here for the
   > identical reason. The earlier form of this step read "execute rebase onto `origin/next`"
   > inline, which means force-pushing every behind-branch in the queue before knowing whether the
   > diff is even sound. Record the finding, carry it into the review, and let **§9A** decide.

   - **If and when you do push a rebase in §9A** (the one write this directive makes to the contributor's
     branch), call `mcp__memtrace__fleet_record_episode` for the symbols the rebase touched
     (`branch: "<PR base branch>"`, same scope rule as everywhere else in this directive) and read
     the conflict class back: **A** (additive, no overlap) — proceed. **B** (touched-set overlap
     with a peer's recent episode) — re-read the peer's work before continuing this PR's review.
     **C** (destructive overlap) — do not push through; treat it as a HALT (this PR) per the
     definition above, submit `mcp__memtrace__fleet_submit_verdict`, and poll
     `mcp__memtrace__fleet_get_escalation({agent_id})` for `your_directive` (`wait` / `proceed` /
     `defer` / `review`) before resuming this PR.
2. Read `CONTEXT.md` directly but **not linearly** — it is a machine-greppable predicate fact-store (`CLASS.subkey=value`, one fact per line) at ~300 KB, so a linear read is ~200 K tokens of mostly-irrelevant predicates. Per `CLAUDE.md` → CODE DISCOVERY, `CONTEXT.md` is `grep` territory: read its heading structure, then grep the predicates governing the surfaces this PR touches (`RULESET.TESTS.*`, `RULESET.CONTRIB.*`, `RULESET.PR-SCOPE.*`, and any `DEFECT.*` in the diff's area). Never delegate it — `META.RULE.brief-must-cite-doc` needs verbatim IDs you read yourself. Read `CONTRIBUTING.md` sections "Pull Request Guidelines" + "CHANGELOG Entries" fresh. Precedence: `META.RULE.canonical-source-precedence=CONTRIBUTING.md > docs/adr/* > CONTEXT.md > agent memory`.
3. Review related open issues to ensure alignment. Address overlaps.
4. `gh pr view $PR --json author,title,body,labels,headRefName,headRefOid,baseRefName,mergeable` — confirm author is NOT in `OWNER_LOGINS`/`OWNER_NAMES`. If it is, HALT (this PR). Keep `headRefName` + `headRefOid`; §1.6b needs both.
5. **Merge Conflict Gate:** **First apply the §1.8 staleness test** (no author activity since your last review/comment for more than `STALE_DAYS`): a stale PR is queued for closure and no new review is posted — a fresh review would restart the clock on an abandoned PR. Only then verify mergeable state (pre and post-rebase). If `CONFLICTING`, post a request-changes review (formal `--request-changes` with the §8.1 `### Memtrace Evidence` section — never a plain `--comment`) highlighting the exact conflicts for author resolution, then HALT (this PR). `BEHIND` with no conflict is NOT this gate (see the merge-queue rule under Phase B).
6. **CI Status Gate — TWO checks, both required.**
   **⚠️ `statusCheckRollup` / `gh pr checks` CANNOT see a run that never started.** GitHub gates fork and first-time-contributor `pull_request` workflows at `action_required` pending maintainer approval. Those runs are **absent from the rollup entirely** — not pending, not failing, just missing — so a PR whose whole test matrix is unapproved reports **all-green with exit 0**. (Verified on PR #2412: `gh pr checks` → 8 checks, all pass, exit 0, while `Tests`, `Security Scan`, `Docs Required`, `Changeset Required`, and `Validate Branch Name` all sat at `action_required` for that exact head SHA. This is what made a batch of PRs look green.)
   - **6a. Rollup check** — `gh pr view $PR --json statusCheckRollup,mergeable,mergeStateStatus`. Any `FAILURE`/`ERROR` → post failure logs, request changes, HALT (this PR).
     **⚠️ Deduplicate to latest-per-name before believing a `FAILURE`.** The rollup returns *every* check run for the SHA, including superseded ones, so a check that failed and was later re-run green appears **twice** — once red, once green — and the red entry is indistinguishable from a live failure. (Verified on PR #2436: four runs named `Pull request template format`, the two older ones `failure`, the newest `success`. Taking the rollup at face value would have requested changes on an already-fixed check.) Always collapse by name, newest `started_at` wins:
     ```bash
     gh api "repos/open-gsd/gsd-core/commits/$SHA/check-runs?per_page=100" --paginate \
       --jq '.check_runs[]|[.name,(.conclusion//.status),.started_at]|@tsv' \
     | sort -t$'\t' -k1,1 -k3,3r \
     | awk -F'\t' '!seen[$1]++ && $2!="success" && $2!="skipped" {print $2"  "$1}'
     ```
     Empty output = genuinely green. Only a name whose *newest* run is non-success is a real failure.
   - **6b. Pending-approval queue check** — never skip, even when 6a is fully green:
     ```bash
     gh pr view $PR --json headRefName,headRefOid -q '.headRefName + " " + .headRefOid'
     # then, with BR=<headRefName> SHA=<headRefOid>:
     gh api "repos/open-gsd/gsd-core/actions/runs?status=action_required&branch=$BR&per_page=100" \
       | jq -r --arg sha "$SHA" '[.workflow_runs[] | select(.head_sha==$sha)] as $p
           | "pending=\($p|length)", ($p[] | "  \(.id)\t\(.name)")'
     ```
     Two mechanics that bite: **scope by `head_sha`** — the branch filter alone returns every historical push's runs (45 on #2412 vs the 5 that are live), and **pipe to real `jq`** — `gh api --jq` rejects `--arg` (`accepts 1 arg(s), received 4`).
   - **6c. Record the pending run IDs — do NOT release them here.** Releasing costs real CI minutes on a fork PR, and at precondition time you have no verdict to justify spending them: §1 runs *before* the substance review in §§3–7. Capture `pending`, the run IDs, and their names into the PR's Phase-A task, then continue the review. The release decision belongs to **§9**, after findings are known.
     > This ordering is load-bearing. The earlier form of this step read "if the verdict is otherwise clean, approve the runs" — a verdict §1 cannot have. Following it literally means either releasing CI blind on every fork PR, or quietly deferring anyway with no step that owns the decision.
   - **6d.** A PR whose tests never executed is **not approvable** and **not mergeable** under §8's zero-tolerance policy. "Rollup was green" is not evidence tests ran. `pending > 0` does **not** by itself justify request-changes either — it is a maintainer-side gate, not a contributor defect. Judge the substance on the diff, then let §9 decide the release.
7. **Activity State:** Run the full follow-up sweep from `<follow_ups_and_questions>` first. If the last comment/review was yours AND the sweep finds no new commits, comments, review-thread replies, or unresolved questions from anyone else, skip this PR and HALT (this PR) — **but only when your last action is less than `STALE_DAYS` old; once `STALE_DAYS` have passed since your last review/comment with no author activity (no commits, comments, replies, submissions), §1.8 applies and the PR is queued for closure, never skipped.** Measure from your last real review/comment, not from a broadcast notice posted to every PR (e.g. the merge-queue heads-up). Any follow-up found is surfaced to the user with `AskUserQuestion` (paused) before the PR is judged.
8. **Staleness Threshold:** If awaiting author action > `STALE_DAYS` (no author activity since your last review/comment), queue a close (per Batch write-action policy). Check §1.8 BEFORE deciding to skip under §1.7. Comment: *"Closing this PR as stale due to inactivity. We expect PRs to be followed up on within 5 days. Please feel free to reopen or submit a new PR when you have the bandwidth to continue this contribution."* Then HALT (this PR).
9. Extract linked issue. Per `CI.GATE.issue-link-required` — if missing, post request-changes review and HALT (this PR).
10. `gh issue view <N> --json labels,title,body,state,stateReason,closedByPullRequestsReferences` for classification.
    - **10b. Closed-Issue Gate.** A PR whose linked issue is already `state: CLOSED` is reviewing work against a resolved target. The substantive review is wasted: the fix shipped, the labels reflect a decided outcome, and `Fixes #N`/`Closes #N` in the PR body is now an inert keyword that strands the PR open (nothing left to auto-close). Reject and close:
      ```bash
      STATE=$(gh issue view <N> --json state -q '.state')
      # if STATE == CLOSED:
      gh pr close $PR --comment "Closing: linked issue #<N> is already CLOSED (<stateReason>) — the work this PR targets has been resolved. A PR against a closed issue cannot be reviewed for fit or merged. If this is genuinely new coverage or a follow-up, please open a fresh issue describing the gap first, then re-open or file a new PR referencing it."
      ```
      Record the outcome as `closed-closed-issue` in the PR's task and HALT (this PR). **Two narrow exceptions** where a closed linked issue is acceptable and the PR proceeds to review:
      1. **Test/docs-only PR** (`test(...)`, `docs(...)` conventional type) that adds regression coverage or documentation for the *already-shipped* fix, AND the PR body does **not** carry a closing keyword (`Fixes`/`Closes`/`Resolves #N`) against the closed issue. If it does carry the keyword, post a `--comment` (exempt from the §8.1 Memtrace gate) asking the author to drop it before proceeding — the misleading keyword is the finding, not a block — then HALT (this PR) until corrected.
      2. **The PR explicitly supersedes/reopens** — body names the prior fix PR and states it was incomplete/incorrect, with evidence (e.g. the prior fix's test now fails). Verify the claim; if unfounded, close per above.
      Use `--comment` (not `--request-changes`) for the close rationale and the keyword-drop note: these are direction/mechanical actions where a full graph pass is not warranted, and §8.1's `### Memtrace Evidence` requirement would otherwise block the post.
11. Checkout latest `next`, then `gh pr checkout $PR` locally. Invoke `/memtrace-skills:memtrace-continuous-memory` (or call `mcp__memtrace__detect_changes` with the PR diff) so the graph reflects the checked-out PR head. Then, for every touched internal source file:
	- `mcp__memtrace__preflight_check` — **call this first, per changed symbol.** One call returns blast radius, process-flow membership, co-change partners, complexity, 30-day churn, and a generated verification checklist, and surfaces governance/ADR/agent-rule guidance for the touched file when Cortex is active. It is the cheapest way to get most of what §1.11, §4A, and §4C each ask for separately, and the generated checklist is the thing to review the PR *against* — a contributor who did not do the listed verifications has an incomplete change, and that is a finding.
	- `mcp__memtrace__get_symbol_context` — role, callers, callees, type references, community and process membership, cross-repo API callers of each changed symbol. Required by name in §8.1; do not substitute `preflight_check` for it.
	- `mcp__memtrace__get_impact` — blast radius (affected symbols/files/processes, cross-repo callers, risk rating). Capture this for the review body. Required by name in §8.1.
	- `mcp__memtrace__analyze_relationships` — only when the diff changes an interface, base class, export surface, or type. `get_symbol_context` gives the neighborhood; this gives the specific traversal (`class_hierarchy`, `overrides`, `imports`, `exporters`, `type_usages`) that tells you whether every implementer/consumer moved with the change.
11b. **Risk-tier the PR before deciding how hard to review it.** The `mcp__memtrace__find_central_symbols` (PageRank — transitive dependents) and `mcp__memtrace__find_bridge_symbols` (betweenness — architectural chokepoints) results were computed once for the sweep in Phase A.1c: grep `<scratchpad>/risk-tier-<short sha of origin/next>.json` for this PR's changed symbols — do not call the two tools again (if no file exists for the current `origin/next`, run Phase A.1c now and write it). Intersect the results with the PR's changed symbols. A diff touching a top-ranked central or bridge symbol earns maximum scrutiny regardless of line count; a high bridge score with low PageRank is the signature of an undocumented hidden dependency, which is precisely the class of change a diff-only reviewer waves through. Record the intersection — a one-line diff to a chokepoint and a 400-line diff to a leaf module are not the same review.
12. **Publish this PR's fleet intent now that the touched set is known.** This is the step that
    lets an issue-side `/bug-fixer` sweep see this PR is claimed:
    `mcp__memtrace__fleet_publish_intent({ repo_id, agent_id: <you, from Phase A item 0>, branch:
    "<PR base branch>", intent: {"bug_fix":{"defect":"logic_error"}}, assignment: "Working PR #$PR
    (fixes #<N>): <PR title>", touched: [<symbols from item 11's preflight_check/get_impact>] })`.
    **The `assignment` string MUST name the linked issue number** (`#<N>` from item 9) — the
    issue-number string is the only thing an issue-side sweep can match against to know this issue
    is being handled from the PR side; an assignment that names only the PR number is invisible to
    it. **`branch` is the PR's base branch, never its head branch** — same scope rule as Phase A
    item 0: a fork head branch is a private, empty pool that no peer agent will ever query.
    Inspect the returned `active_conflicts`; a non-empty conflict on the touched set is itself a
    finding for §8.
