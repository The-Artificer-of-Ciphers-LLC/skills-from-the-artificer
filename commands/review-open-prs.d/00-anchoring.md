<!-- Part of /review-open-prs (commands/review-open-prs.md). Read this file in full when the run reaches this section. -->

### 0. Context anchoring
**[BLOCKING]**
0. **Save the PR's diff and head sha** once: `gh pr diff $PR > <scratchpad>/pr-<PR>.diff` and keep `headRefOid` from §1.4. If the head sha changes during the run, end the run; the next run reviews the new head. The review-fidelity guard is no longer armed: the per-file Memtrace diff tools it policed are not called.
1. **Confirm the graph covers this PR.** Check CodeGraph is indexed for the repo (a `.codegraph/` at the git toplevel, or `codegraph status`). If `$PR`'s changed paths are not in the index, note it; graph-backed checks below degrade to diff-only for those files, and the review says so.
2. **A graph that returns nothing is not a clean verdict.** `codegraph impact` or `codegraph callers` that returns zero on a symbol the diff plainly calls, or an index with no edges, means the check did not run. Never approve on one; re-index or say in the review that blast radius could not be measured.
3. **Memtrace's silent-zero mode (full-tier PRs only).** When §1.11b sends a PR to `get_impact` or `recall_decision`, inspect the payload, not just the call status: on quota exhaustion a metered call **still returns a normal success result** whose payload is a quota-error object. That is not a finding-free `get_impact`. Treat it as "Memtrace unavailable" per **Memtrace budget** in the core file: fall back to `codegraph impact`, and write in the review that the recorded-decision check did not run.
4. *(Retired: worktree overlays and the `.memdb` binding checks were for the per-file Memtrace tools, which are no longer called.)*

5. **`repo_id` for the two Memtrace calls.** A shared `.memdb` can index several worktrees of this repo under different `repo_id`s. When §1.11b makes a Memtrace call, pass the `repo_id` whose `branch` matches the PR checkout explicitly; do not carry a prior PR's `repo_id` forward or let the call infer it.
