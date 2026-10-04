# Unmerged branch report: every branch with commits not in origin/main

Date: 2026-10-03. Repo state: origin/main at 8c7d31a (after `git fetch -p`). Read-only investigation: nothing was deleted, checked out, reset or modified.
Method per branch: `git rev-list --count origin/main..<ref>`, `git cherry origin/main <ref>`, `git log origin/main --grep '(#NN)'`, `gh pr list --state all --head <branch>`, `git worktree list`, then a hunk-by-hunk comparison: the branch's own change (`git diff origin/main...<ref>`) against the current main files, plus a two-dot check (`git diff origin/main <ref> -- <file>`) per changed file. A two-dot diff of zero lines means main's file is byte-identical to the branch tip.
Why "unmerged" counts are nonzero for fully landed work: this repo squash-merges PRs (#25-#29), so each branch's original commits are never ancestors of main. `git cherry` marks them `+` because the squash commit has a different patch-id when several commits were combined.

## Summary table (reply ok / not ok per branch)

| Branch | Where | Unique commits vs origin/main | PR | Verdict |
|---|---|---|---|---|
| feat/artificer-dispatcher-laws-gate | local only | 1 | #25 merged | SAFE TO DELETE |
| feat/codegraph-fallback-guards | local + origin (identical, 55a63d5) | 2 | #28 merged | SAFE TO DELETE (both copies) |
| fix/guard-breaker-interrupt-restart | local (8818be7, 3 commits) | 3 | #27 merged (and #26) | SAFE TO DELETE |
| origin/fix/guard-breaker-interrupt-restart | origin (b356c35) | 1 | #27 merged | SAFE TO DELETE |
| fix/guards-breaker-and-single-flight-bench | local + origin (identical, 98273bb) | 2 | #26 merged | SAFE TO DELETE (both copies) |
| fix/memtrace-guard-codegraph-node-read | local + origin (identical, 9053a50) | 1 | #29 merged | SAFE TO DELETE (both copies) |
| fix/single-flight-guard-live-bench-spec | local only | 1 | none | SAFE TO DELETE (content is in #26) |

Result: no UNIQUE WORK found. Every hunk on every unmerged branch is either present on main or superseded by a later main commit. No branch below is checked out in any worktree.

### Origin-only branches you named
After `git fetch -p` none of these exist on origin any more (deleted on merge; rev-parse returns nothing, so unmerged count is 0). Their PRs are merged and visible in main history: chore/globalize-guard-hooks (not found by subject in the last 30 main commits, deleted on origin, count 0), docs/fix-stale-counts (#15, 467724d), docs/update-for-hook-changes (merged, deleted), feat/memtrace-guard-mt-cli-hint (#16, 7f390b2), fix/gsd-core-hooks-scope-to-gsd-core (#19, 3065896), fix/triage-review-oos-ship-merge-cleanup (#18, 8922223).

### Safe to delete: fully merged (0 unique commits vs origin/main)

| Ref | Where | Note / worktree |
|---|---|---|
| claude/circuit-breaker-hooks-14720f | local | at 8c7d31a (== main); checked out in worktree skills-from-the-artificer-wt-breaker, remove worktree first |
| claude/git-worktree-conflict-7ab520 | local | no worktree |
| feat/dispatch-guard-opus-justification | local + origin | #22 |
| feat/triage-review-enhancement-questions | local + origin | #20; checked out in worktree skills-from-the-artificer-triage-questions |
| feat/worktree-reap-guard | local + origin | #17/#21 |
| fix/single-flight-guard-per-bench | local + origin | #24; local checked out in /private/tmp/artificer-guard-wt |
| fix/tier-guard-read-model-from-transcript | local + origin | #23; checked out in worktree skills-from-the-artificer-wt-tier |

Not branches but listed by `git worktree list`: a detached-HEAD worktree at .claude/worktrees/vigorous-noether-0e0dbc (8c7d31a). Note the uncommitted change to claude-guards/hooks/worktree-reap.sh in the main checkout is unrelated to these branches.

---

## 1. feat/artificer-dispatcher-laws-gate (local only)

- Commit: 154791a, 2026-09-30, Tom Boucher: "feat(artificer): dispatcher lens table, real-call requirement and laws honesty gate".
- Files (`git diff --stat origin/main...`): commands/bug-fixer.md (12), commands/review-open-prs.md (4), gsd-core-hooks/hooks/gsd-phase-gate-laws.test.sh (+67), gsd-core-hooks/hooks/gsd-phase-gate.cjs (+76), skills-from-the-artificer/SKILL.md (108 changed). 5 files, +212/-55.
- What it does: rewrites the Artificer dispatcher SKILL.md around a lens table, requires a real call to the dispatcher skill, and adds a "laws honesty gate" to gsd-phase-gate.cjs (with a test script) that refuses a phase advance whose laws step was self-reported. bug-fixer and review-open-prs command text updated to match.
- PR: #25 MERGED 2026-09-30, same title. Main commit 2be88c0 "(#25)" is the squash. `git cherry` shows `-` for nothing else; patch-id differs only because squash.
- Worktree: none.

### Compared with main
| File | Hunks | Status |
|---|---|---|
| commands/bug-fixer.md | all | present on main (two-dot diff 0 lines) |
| commands/review-open-prs.md | all | present on main (0) |
| gsd-core-hooks/hooks/gsd-phase-gate-laws.test.sh | new file | present on main (0) |
| gsd-core-hooks/hooks/gsd-phase-gate.cjs | all | present on main (0) |
| skills-from-the-artificer/SKILL.md | all | present on main (0) |

Verdict: SAFE TO DELETE. Main's five files are byte-identical to this branch tip (squash commit 2be88c0, PR #25). Recommendation: `git branch -D feat/artificer-dispatcher-laws-gate` (needs -D because squash-merged).

## 2. feat/codegraph-fallback-guards (local + origin, identical at 55a63d5)

- Commits: 2dfad06 "feat(guards): name the CodeGraph equivalent of each Memtrace tool" (2026-10-03) and 55a63d5 "fix(memtrace-first-guard): a codegraph_node file read counts as the read" (2026-10-03), both Tom Boucher.
- Files: claude-guards/hooks/memtrace-capable-dispatch-guard.cjs (10), memtrace-first-guard.cjs (122), memtrace-first-guard.test.sh (+50), gsd-core-hooks/hooks/require-memtrace-evidence.sh (25). 4 files, +194/-13.
- What it does: when Memtrace is unavailable or out of quota, the guards' denial text names the matching CodeGraph tool/CLI for each Memtrace tool, and a `codegraph_node` file-mode read counts as the span read the guard demands.
- PR: #28 MERGED 2026-10-03T23:03Z "feat(guards): name the CodeGraph equivalent of each Memtrace tool" (main d8810d0). The second commit's content landed through #29 (8c7d31a, below).
- Worktree: none. Local and origin copies are identical (0/0 divergence).

### Compared with main
| File | Hunks | Status |
|---|---|---|
| memtrace-capable-dispatch-guard.cjs | all | present (two-dot 0) |
| memtrace-first-guard.cjs | all | present (0) |
| memtrace-first-guard.test.sh | all | present (0) |
| gsd-core-hooks/hooks/require-memtrace-evidence.sh | all | present (0) |

Verdict: SAFE TO DELETE (local and origin). Main's four files are byte-identical to the tip; #28 plus #29 contain both commits. Recommendation: delete `origin/feat/codegraph-fallback-guards` and the local branch.

## 3. fix/guard-breaker-interrupt-restart: local (8818be7) vs origin (b356c35) differ

Local and origin copies are different histories: local is 3 ahead / 8 behind-and-diverged relative to origin (`rev-list --left-right` 3 8). Origin has one commit; local has three.

### 3a. Local fix/guard-breaker-interrupt-restart (3 commits)
- 2bcac44 2026-09-30 "fix(gsd-test-single-flight-guard): read each in-flight run's bench from its live process"; b81fa41 2026-09-30 "fix(claude-guards): the denial breaker interrupts and restarts the agent; memtrace guard names the absolute worktree path"; 8818be7 2026-10-01 "fix(claude-guards): a subagent hand-back never trips the denial breaker". All Tom Boucher.
- Files: guard-denial-breaker.cjs (112), guard-denial-breaker.test.sh (79), memtrace-first-guard.cjs (12), memtrace-first-guard.test.sh (+11), gsd-core-hooks/hooks/gsd-test-single-flight-guard.sh (110), gsd-test-single-flight-guard.test.sh (+52). 6 files, +325/-51.
- What it does: (1) single-flight guard reads each in-flight gsd-test run's bench from the live process; (2) the denial breaker interrupts and restarts the agent instead of hard-stopping, and memtrace guard text requires an absolute worktree path in get_source_window; (3) a subagent BLOCKED hand-back is never counted as a denial.
- PRs: #26 MERGED 2026-09-30 (f97efbc, contains commits 1 and 2) and #27 MERGED 2026-10-01 (fa75e37, contains commit 3). `git cherry`: 2bcac44 and b81fa41 `+` (squashed into #26), 8818be7 `-` (patch identical to a commit on main).
- Worktree: none.

### Compared with main
| Hunk | Status |
|---|---|
| guard-denial-breaker.cjs / .test.sh (all hunks) | present on main, byte-identical (two-dot 0) |
| gsd-test-single-flight-guard.sh / .test.sh (all) | present, identical (0) |
| memtrace-first-guard.cjs: version 1.6.2 header + "In a git worktree, pass get_source_window the ABSOLUTE path" denial text | present on main (text confirmed in current denial output) |
| memtrace-first-guard.test.sh: "1.6.2 denied Read ... absolute-path requirement" test | present on main |
| memtrace-first-guard.cjs/.test.sh remaining two-dot diff (119 / 48 lines) | NOT branch changes: main is newer. They are the CodeGraph fallback and codegraph_node read logic from #28/#29 that this branch predates. Superseded by a later main commit, nothing missing |

Verdict: SAFE TO DELETE. Recommendation: `git branch -D fix/guard-breaker-interrupt-restart`.

### 3b. origin/fix/guard-breaker-interrupt-restart (1 commit)
- b356c35, 2026-10-01, Tom Boucher: "fix(claude-guards): a subagent hand-back never trips the denial breaker". guard-denial-breaker.cjs (17), guard-denial-breaker.test.sh (6); +8/-15.
- What it does: removes the T2 "hand-back" trip logic from the breaker so research/review reports quoting "denied"/"hook" cannot interrupt a run.
- PR: #27 MERGED 2026-10-01 (fa75e37 is the squash, identical stat 8/-15, 2 files).
- Compared with main: both files byte-identical to main (two-dot 0). Present.
- Worktree: none.
Verdict: SAFE TO DELETE. Recommendation: delete the origin branch. It is the only copy that differs from local, and both are landed.

## 4. fix/guards-breaker-and-single-flight-bench (local + origin, identical at 98273bb)

- Commits: 0070bfb 2026-09-30 "fix(gsd-test-single-flight-guard): read each in-flight run's bench from its live process"; 98273bb 2026-09-30 "fix(claude-guards): the denial breaker interrupts and restarts the agent; memtrace guard names the absolute worktree path". Tom Boucher.
- Files: guard-denial-breaker.cjs (95), guard-denial-breaker.test.sh (75), memtrace-first-guard.cjs (12), memtrace-first-guard.test.sh (+11), gsd-test-single-flight-guard.sh (21), gsd-test-single-flight-guard.test.sh (+52). 6 files, +237/-29.
- What it does: single-flight reads the bench from the live process; breaker interrupts and restarts; memtrace denial names the absolute worktree path.
- PR: #26 MERGED 2026-09-30T22:19Z (f97efbc, same subject).
- Worktree: none. Local == origin.

### Compared with main
| Hunk | Status |
|---|---|
| gsd-test-single-flight-guard.sh / .test.sh | present, identical (two-dot 0) |
| memtrace-first-guard 1.6.2 header, absolute-path denial text, test | present on main |
| guard-denial-breaker.cjs (16 two-dot lines) and .test.sh (6) | the branch still has the old T2 hand-back trip that PR #27 (fa75e37) deliberately removed. Main differs because of the later commit: superseded by fa75e37, and restoring the branch's version would REGRESS main |
| memtrace-first-guard two-dot remainder | main newer (#28/#29), see 3a |

Verdict: SAFE TO DELETE (both copies). Recommendation: delete; note the branch's breaker hand-back behavior is intentionally reversed on main.

## 5. fix/memtrace-guard-codegraph-node-read (local + origin, identical at 9053a50)

- Commit: 9053a50, 2026-10-03, Tom Boucher: "fix(memtrace-first-guard): a codegraph_node file read counts as the read". memtrace-first-guard.cjs (77), memtrace-first-guard.test.sh (+43). +116/-4.
- What it does: a prior `codegraph_node` file-mode read (file + offset/limit) satisfies the guard's "read a span only after a graph read" requirement.
- PR: #29 MERGED 2026-10-03T23:14Z, main 8c7d31a (HEAD of main).
- Worktree: none. Local == origin.

### Compared with main
Both files present and byte-identical to main (two-dot 0 lines).
Verdict: SAFE TO DELETE (both copies). Recommendation: delete both.

## 6. fix/single-flight-guard-live-bench-spec (local only)

- Commit: 2bcac44, 2026-09-30, Tom Boucher: "fix(gsd-test-single-flight-guard): read each in-flight run's bench from its live process". gsd-test-single-flight-guard.sh (110), .test.sh (+52). +153/-9.
- What it does: the single-flight guard derives each running gsd-test's bench from the live process rather than a recorded value.
- PR: none for this branch name (`gh pr list --head` empty). The identical commit (as 0070bfb in the combined branch) shipped inside PR #26.
- Worktree: none.

### Compared with main
Both files byte-identical to main (two-dot 0). Present. Note the guard on main also carries the earlier #24 per-bench scoping (41bae29) underneath.
Verdict: SAFE TO DELETE. Local-only, so no origin copy; nothing is lost. Recommendation: `git branch -D fix/single-flight-guard-live-bench-spec`.
