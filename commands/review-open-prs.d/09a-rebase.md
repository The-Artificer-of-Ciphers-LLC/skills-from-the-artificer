<!-- Part of /review-open-prs (commands/review-open-prs.md). Read this file in full when Phase B reaches this section. -->

### 9A. Push a rebase — only when the review found no blockers
**[BLOCKING]** *Runs after §8 has posted, using the behind-by / rebases-cleanly finding recorded in §1.1. Skip entirely when the branch is not behind.*

A rebase-push is **not** a neutral housekeeping act. It force-updates a contributor's branch, rewrites their history, and triggers their full CI matrix. It is therefore gated exactly like a CI release, on the same verdict, for the same reason.

1. **Gate.** Push a rebase only if §8's verdict carries **no findings above Nit** (no Blocker/Major/Minor — a rebase-push re-triggers the contributor's CI, the same double-spend §9.1 prevents). On any such finding, **do not push it** — the contributor is going to push again anyway to fix the blocker, and their rebase will pick the base up for free. Instead, put the rebase instruction in the review body (`git fetch origin next && git rebase origin/next`) and state what it fixes. Rebasing a known-wrong diff spends a fork CI matrix to prove nothing and rewrites someone's branch under them while they are mid-fix.
2. **Never present a rebase as progress toward merge.** It clears base-drift CI noise. It resolves no finding, retires no Blocker, and moves no PR closer to approval. Any summary that implies otherwise is wrong — see the forbidden sentences in §9.4.
3. **Prefer asking over pushing.** The default is to tell the contributor to rebase. Push it yourself only when the verdict is clean AND the branch is behind AND `maintainer_can_modify` is true. When you do push, use `--force-with-lease` pinned to the exact sha you fetched, and verify afterwards that the changed-file set and the added/removed line set are unchanged.
4. **A blocked push gate is a signal, not an obstacle.** If a machine gate refuses the push, stop and re-read your own §8 verdict before doing anything else. Do not request an override token, and never emit one on your own initiative — `CLAUDE.md` reserves it for an explicit human instruction **naming the token**, and general approval ("go ahead", "you have permission") is **not** that. A gate firing on a PR you have already called blocked is usually the system catching a mistake you are in the middle of making.

> **Do not release CI to "see if it passes" as a substitute for reviewing the diff.** The review stands on its own; CI confirms it. A PR whose tests never ran is still not approvable (§6d), and a green matrix does not retire any finding from §8.

Record the PR's outcome in its Phase-A task, then advance to the next queued PR.
