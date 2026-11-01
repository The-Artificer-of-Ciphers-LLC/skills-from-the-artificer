<!-- Part of /review-open-prs (commands/review-open-prs.md). Read this file in full when Phase B reaches this section. -->

### 9. Release queued fork CI
**[BLOCKING]** *Using the run IDs recorded in §1.6c. Skip entirely when `pending == 0`. Runs BEFORE
posting per §8.3 when the tentative verdict is Approve; runs AFTER posting only when a
`changes-requested` review carries Nit-only findings (any Blocker/Major/Minor withholds CI —
see the §9.1 gate). Either way, this step is where "released"
must become "confirmed complete" — never treat a release itself as a result.*

GitHub holds `pull_request` workflows from forks and first-time contributors at `action_required` until a maintainer releases them. Releasing is **routine authorized maintainer work, not a decision to surface** — but it spends real CI minutes on someone else's branch, so it is gated on the review outcome rather than fired on arrival.

1. **Gate.** Release only if §8's verdict carries **no findings above Nit** — i.e. no Blocker, no Major, no Minor. Nit-only findings do not block the release. **Any Blocker/Major/Minor finding withholds CI.** The contributor must push a fix for it regardless, and that push re-triggers the full matrix, so releasing now spends the CI cost twice (once on a diff already known to need changes, once on the fix). On any finding above Nit, say so plainly in the review ("CI runs left queued — release once the Blocker/Major/Minor findings are addressed") and stop here.
2. **Release** each recorded run:
   ```bash
   gh api --method POST repos/open-gsd/gsd-core/actions/runs/<run_id>/approve
   ```
   Confirm the queue drained — re-run the §1.6b query and expect `pending=0`.
3. **Poll to completion, then re-run §1.6a with the latest-per-name dedup.** A release is not a result. This is the step that converts "reported green because nothing ran" into an actual verdict, and it routinely changes the outcome.
   > **Fleet TTL note:** intents expire after **120s** of no fleet calls. A CI poll loop here, or a
   > long review/security pass elsewhere in Phase B, will outlast that — re-publish this PR's
   > intent (`mcp__memtrace__fleet_publish_intent`, same `branch` as item 12) after each poll cycle
   > rather than treating the expiry, or `fleet_status` reporting `0 active agents`, as evidence no
   > peer is active.
4. **Attribute whatever comes back red.** A failure surfaced by a release you triggered is frequently **not** the contributor's:
   - Compare the failing test's file against the PR's changed-file list. No overlap is a strong signal of base drift.
   - Check whether the base branch moved under the PR (a recent merge to `next` that deleted a fixture, changed a contract, or landed a new gate). **Do this with the graph, not by reading merge commits.** `mcp__memtrace__get_evolution` from the PR's branch point to now (`mode: "compound"` for the top changed files + rolled-up touched symbols) answers "what moved under this PR" directly, and Phase A.1b already computed the sweep-wide baseline to diff against. When one commit looks responsible, `mcp__memtrace__get_episode_replay` on it lists exactly which nodes and edges it added, modified, and **removed** — a deleted fixture or a removed symbol shows up as a removal, which is the fastest possible confirmation of a base defect. `mode: "graph_summary"` digests a chunky merge before you drill in.
   - Read the assertion text before assigning blame; it usually names the mechanism. If it names a symbol, `mcp__memtrace__get_timeline` on that symbol shows whether it changed on the base since the PR forked — and its per-episode AST hash distinguishes a real structural change from a whitespace-only one, so you do not blame a reformat.
   **When it is a base defect, the CI failure is not the contributor's — but that says NOTHING about whether their diff is sound. These are two independent verdicts and you must never let one stand in for the other.**

   Read §8's verdict before writing a single word about the CI result, then use the matching form:

   - **§8 found NO findings at all** → post a comment saying the diff is clean, quote the failure, name the cause, and state explicitly that no rebase or change is needed. Label `needs-review: ci/failing` rather than `review: changes requested`.
   - **§8 found ANY finding (Blocker, Major, Minor, or Nit)** → the review verdict stands unchanged and `review: changes requested` stays. Say only the narrow, true thing: *"the red CI is base drift and not caused by your diff"* — then **restate the open findings in the same breath**. You may add `needs-review: ci/failing` alongside, never instead of, the review label.

   **Three sentences you are FORBIDDEN to write, or to say to the maintainer, whenever §8 carries any finding:** "the diff is clean", "no change is needed", and "the remedy is a rebase" (or any paraphrase presenting a rebase, a CI re-run, or a release as *the* fix for the PR). A rebase can only ever be the remedy for **the CI failure**. Scope every such statement to the CI result explicitly — *"a rebase clears the red shard; the N findings below are separate and still stand"* — and never emit the CI attribution to the maintainer without the finding count attached to it. Reporting "#NNNN just needs a rebase" about a PR carrying Blockers is a **critical reporting failure**: it invites the maintainer to authorize a push and a CI spend on a diff you have already determined is wrong.

   Escalate the base defect separately — but first confirm it is still open: a red that is already fixed on `next` is **not** an escalation, it is a stale branch, and the finding is "this PR is N commits behind", not "the base is broken". (Verified on PR #2436: substance clean, released 4 queued runs, and the resulting red was `tests/emitted-attribution.test.cjs` failing because a commit on `next` had deleted the golden fixtures it reads — a one-file test PR that could not possibly have caused it.)
5. **Never leave a released PR unrecorded.** Update the Phase-A task with: released run IDs, final per-name CI state, and whether any red is attributable to the PR or the base.
