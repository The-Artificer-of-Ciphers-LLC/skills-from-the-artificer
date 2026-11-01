<!-- Part of /review-open-prs (commands/review-open-prs.md). Read this file in full when Phase B reaches this section. -->

### 9B. Merge on approval — immediate, unconditional, not deferred to Phase C
**[BLOCKING]** *Runs immediately after an `--approve` review is actually posted (which, per §8.3, only
happens once CI for this head SHA has already been confirmed green or provably pure base-drift).
This is not gated by `AUTONOMOUS` and is never batched — merge every Approved PR the moment it is
approved, one at a time, before touching the next queued PR.*

1. **Re-verify immediately before merging** — a few minutes may have passed since the CI check in
   §8.3: `gh pr view $PR --json mergeable,mergeStateStatus,headRefOid`. If `headRefOid` changed (the
   contributor pushed something new), the approval is stale — do NOT merge; re-run the affected part
   of the review against the new head instead (treat it like a fresh pass over just the delta), and
   only reach this step again once that's re-confirmed clean.

   If `mergeStateStatus == BEHIND` (branch is stale relative to `next` but NOT `CONFLICTING` — a
   currency problem, not a content problem): this is not a finding and not a reason to leave the PR
   unmerged. Bring it up to date with the **server-side** update-branch call — it does not touch your
   local worktree and does not route through this environment's local `git push` hooks (in
   particular the `gsd-test-clean-tree-guard` pre-push gate that would block a *local*
   force-push-based rebase):
   ```bash
   gh api --method PUT repos/open-gsd/gsd-core/pulls/$PR/update-branch
   ```
   This merges latest `next` into the PR branch and typically re-queues required checks (e.g.
   `changeset-lint`, `docs-lint`, `Tests`) as `pending` on the new merge commit — that is CI actually
   starting fresh, not a new blocker. Poll the rollup (§1.6a, deduped by name) until it settles and
   confirm green — same completion-before-approval discipline as §8.3, just applied to the refreshed
   SHA — then re-check `mergeable`/`mergeStateStatus` (expect `MERGEABLE`/`CLEAN`) before proceeding
   to step 2. If it's `CONFLICTING` instead of merely `BEHIND`, that IS a real finding — stop, revert
   the verdict to `changes-requested` describing the conflict, and do not force anything.
2. **Merge:**
   ```bash
   gh pr merge $PR --repo open-gsd/gsd-core --squash --delete-branch
   ```
   (Use whatever merge method `CONTRIBUTING.md` documents as this repo's convention if it differs
   from squash; do not guess — grep for it once per sweep, not per PR.)
3. **Confirm the merge landed and `origin/next` is green before moving on:**
   ```bash
   git fetch origin next
   gh pr view $PR --repo open-gsd/gsd-core --json state,mergedAt   # state == MERGED
   ```
   Then poll the resulting CI run on `next` for the new merge commit to actual completion. **Do not
   pick "the most recent run" via `gh run list --limit 1` — a single push fans out into many
   separate workflow runs (Docs Required, Validate Branch Name, Changeset Required, Default Flip
   Documentation, ...) and several finish in seconds, so `--limit 1` can hand you one of those
   instead of the real test matrix (this bit this exact sweep once, on PR #4529's post-update-branch
   check).** Resolve the merge SHA and specifically find the run named `Tests`:
   ```bash
   SHA=$(git rev-parse origin/next)
   gh api "repos/open-gsd/gsd-core/actions/runs?head_sha=$SHA&per_page=100" -q '.workflow_runs[] | "\(.id)\t\(.name)\t\(.status)"'
   # watch the row whose name == "Tests":
   gh run watch <that run's id> --repo open-gsd/gsd-core --exit-status
   ```
   **Do not advance to the next queued PR until this run's conclusion is known.**
4. **If the post-merge `next` run comes back green:** record the outcome, advance to the next PR.
5. **If the post-merge `next` run comes back red:** this is no longer a per-PR HALT — a red `next`
   blocks every other contributor and every other PR still in this queue that will be diffed/rebased
   against it. **Stop the entire sweep immediately** (do not start reviewing another PR), surface the
   failure to the user in full (failing job, logs, the merge that likely caused it), and wait for
   explicit direction before resuming. Do not attempt to revert the merge yourself unless
   specifically asked to.
