<!-- Part of /review-open-prs (commands/review-open-prs.md). Read this file in full when the run reaches this section. -->

### 1. Preconditions
**[BLOCKING]**
1. **Base state — detect only; never rebase-push.** Fetch `origin/next`. If the PR branch is behind, record how far,
   and whether it conflicts (`git merge-tree`). `next` uses a merge queue, so being BEHIND is never a finding, a blocker,
   or a reason to rebase. Only a true content conflict is reportable (§1.5). This command never pushes to a
   contributor's branch.

2. Read `CONTEXT.md` directly but **not linearly** — it is a machine-greppable predicate fact-store (`CLASS.subkey=value`, one fact per line) at ~300 KB, so a linear read is ~200 K tokens of mostly-irrelevant predicates. Per `CLAUDE.md` → CODE DISCOVERY, `CONTEXT.md` is `grep` territory: read its heading structure, then grep the predicates governing the surfaces this PR touches (`RULESET.TESTS.*`, `RULESET.CONTRIB.*`, `RULESET.PR-SCOPE.*`, and any `DEFECT.*` in the diff's area). Never delegate it — `META.RULE.brief-must-cite-doc` needs verbatim IDs you read yourself. Read `CONTRIBUTING.md` sections "Pull Request Guidelines" + "CHANGELOG Entries" fresh. Precedence: `META.RULE.canonical-source-precedence=CONTRIBUTING.md > docs/adr/* > CONTEXT.md > agent memory`.
3. Review related open issues to ensure alignment. Address overlaps.
4. `gh pr view $PR --json author,title,body,labels,headRefName,headRefOid,baseRefName,mergeable` — confirm author is NOT in `OWNER_LOGINS`/`OWNER_NAMES`. If it is, HALT. Keep `headRefName` + `headRefOid`; §1.6b needs both.
5. **Merge Conflict Gate:** **First apply the §1.8 stale clock:** a PR past `CLOSE_DAYS` is handled there and no new review is posted — a fresh review would restart the clock on an abandoned PR. Only then verify mergeable state (pre and post-rebase). If `CONFLICTING`, post a request-changes review (formal `--request-changes` with the §8.1 `### Graph Evidence` section — never a plain `--comment`) highlighting the exact conflicts for author resolution, then HALT. `BEHIND` with no conflict is NOT this gate (see the merge-queue rule under Phase B).
6. **CI Status Gate — TWO checks, both required.**
   **⚠️ `statusCheckRollup` / `gh pr checks` CANNOT see a run that never started.** GitHub gates fork and first-time-contributor `pull_request` workflows at `action_required` pending maintainer approval. Those runs are **absent from the rollup entirely** — not pending, not failing, just missing — so a PR whose whole test matrix is unapproved reports **all-green with exit 0**. (Verified on PR #2412: `gh pr checks` → 8 checks, all pass, exit 0, while `Tests`, `Security Scan`, `Docs Required`, `Changeset Required`, and `Validate Branch Name` all sat at `action_required` for that exact head SHA. This is what made a batch of PRs look green.)
   - **6a. Rollup check** — `gh pr view $PR --json statusCheckRollup,mergeable,mergeStateStatus`. Any `FAILURE`/`ERROR` → post failure logs, request changes, HALT.
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
   - **6c. Record the pending run IDs — do NOT release them here.** Releasing costs real CI minutes on a fork PR, and at precondition time you have no verdict to justify spending them: §1 runs *before* the substance review in §§3–7. Capture `pending`, the run IDs, and their names into the run's notes (they go in the ledger), then continue the review. The release decision belongs to **§9**, after findings are known.
     > This ordering is load-bearing. The earlier form of this step read "if the verdict is otherwise clean, approve the runs" — a verdict §1 cannot have. Following it literally means either releasing CI blind on every fork PR, or quietly deferring anyway with no step that owns the decision.
   - **6d.** A PR whose tests never executed is **not approvable** and **not mergeable** under §8's zero-tolerance policy. "Rollup was green" is not evidence tests ran. `pending > 0` does **not** by itself justify request-changes either — it is a maintainer-side gate, not a contributor defect. Judge the substance on the diff, then let §9 decide the release.
7. **Activity State:** read the conversation per *Follow-ups* in the core file. If the ledger's head matches and nothing
   from anyone else is newer than its `reviewedAt`, the run is "nothing new" (core step 2): apply §1.8 and end. Measure
   from your last real review or comment, not from a broadcast notice posted to every PR (e.g. the merge-queue
   heads-up). A follow-up that needs the maintainer's decision goes in the report under `QUESTIONS FOR @trek-e`; the
   review still covers everything that does not depend on it.
8. **Stale clock (Warden ADR 0002).** It runs only on a PR awaiting its author after the maintainer responded or a
   review was posted; a PR nobody answered is review work, never stale. Measure from that response or review to the
   author's latest commit, comment or reply.
   - Past each of `NUDGE_HOURS` with no author activity, and not yet nudged for that mark (ledger `nudges`): post one
     `--comment` that opens with `AI-assisted review by @trek-e.`, lists the open findings in one line each, and says
     the PR is closed after `CLOSE_DAYS` days without activity. Record the time in `nudges`.
   - Past `CLOSE_DAYS`: if `AUTONOMOUS` = `true`, close it with: *"AI-assisted review by @trek-e. Closing this PR as
     stale: there has been no activity for 5 days since the review. If the linked issue is still open, it goes back to
     the queue, and anyone can pick up from this branch with a Co-authored-by credit. Feel free to reopen when you can
     continue."* If `AUTONOMOUS` = `false`, put the recommended close in the report and post nothing. Then HALT.
9. Extract linked issue. Per `CI.GATE.issue-link-required` — if missing, post request-changes review and HALT.
10. `gh issue view <N> --json labels,title,body,state,stateReason,closedByPullRequestsReferences` for classification.
    - **10b. Closed-Issue Gate.** A PR whose linked issue is already `state: CLOSED` is reviewing work against a resolved target. The substantive review is wasted: the fix shipped, the labels reflect a decided outcome, and `Fixes #N`/`Closes #N` in the PR body is now an inert keyword that strands the PR open (nothing left to auto-close). Reject and close:
      ```bash
      STATE=$(gh issue view <N> --json state -q '.state')
      # if STATE == CLOSED:
      gh pr close $PR --comment "Closing: linked issue #<N> is already CLOSED (<stateReason>) — the work this PR targets has been resolved. A PR against a closed issue cannot be reviewed for fit or merged. If this is genuinely new coverage or a follow-up, please open a fresh issue describing the gap first, then re-open or file a new PR referencing it."
      ```
      Record the outcome as `closed-closed-issue` in the report and HALT. **Two narrow exceptions** where a closed linked issue is acceptable and the PR proceeds to review:
      1. **Test/docs-only PR** (`test(...)`, `docs(...)` conventional type) that adds regression coverage or documentation for the *already-shipped* fix, AND the PR body does **not** carry a closing keyword (`Fixes`/`Closes`/`Resolves #N`) against the closed issue. If it does carry the keyword, post a `--comment` (exempt from the §8.1 evidence gate) asking the author to drop it before proceeding — the misleading keyword is the finding, not a block — then HALT until corrected.
      2. **The PR explicitly supersedes/reopens** — body names the prior fix PR and states it was incomplete/incorrect, with evidence (e.g. the prior fix's test now fails). Verify the claim; if unfounded, close per above.
      Use `--comment` (not `--request-changes`) for the close rationale and the keyword-drop note: these are direction/mechanical actions where a full graph pass is not warranted, and §8.1's `### Graph Evidence` requirement would otherwise block the post.
11. Checkout latest `next`, then `gh pr checkout $PR` locally (re-index CodeGraph if its index is older than the checkout). Then, for every touched internal source file:
	- `codegraph callers <symbol>` / `codegraph callees <symbol>` (or `codegraph node <symbol>`) — callers, callees and role of each changed symbol. Cite the result in §8.1.
	- `codegraph impact <symbol>` — blast radius: affected symbols and files. Capture this for the review body; it is the line §8.1 requires.
	- When the diff changes an interface, base class, export surface or type, check every implementer and consumer moved with it (`codegraph callers` on the changed export, plus a grep for the name in tests and docs).
11b. **Risk-tier the PR before deciding how hard to review it, and before spending any Memtrace call.** Tier from this PR's own diff and the §1.11 CodeGraph results; there is no sweep baseline any more.
	- **Full tier** if any of these holds: `codegraph impact` reaches files outside the changed files' own directory; the diff changes an exported symbol, a shared constant or parser, a shipped `gsd-core/workflows/*` or `commands/*` file, CI config, or a security-sensitive path (auth, tokens, shell exec, file writes outside the repo); or the diff is over 300 changed lines of non-test source.
	- **Light tier** otherwise.
	- On a full-tier PR with `MEMTRACE` = `lean`, make the two Memtrace calls now, sequentially, with the pinned `repo_id`: `mcp__memtrace__get_impact` on the changed symbol with the widest `codegraph impact`, and §2's single `recall_decision`. A light-tier PR makes no Memtrace call. Record the tier and why in the review body: a one-line diff to a chokepoint and a 400-line diff to a leaf module are not the same review.
12. *(Retired for the Warden MVP: no fleet intent. The Warden's ledger and per-item lock claim the PR.)*
