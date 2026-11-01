<!-- Part of /review-open-prs (commands/review-open-prs.md). Read this file in full when Phase B reaches this section. -->

### 3A. Bug-Fix Track
**[BLOCKING]**
1. `/diagnose` — reproduce defect.
2. `/root-cause-analysis` — identify true root cause. Compare against the PR. Compute blast radius with `mcp__memtrace__get_impact` and `/memtrace-skills:memtrace-change-impact-analysis`.
   - **Prove the fix site is actually on the failing path.** `mcp__memtrace__find_dependency_path` between the reported entry point and the symbol the PR modifies returns the shortest call/dependency path, or nothing. **No path is a Blocker**: it means the diff cannot reach the reported symptom, which is the graph-level signature of a fix aimed at the wrong layer. Where the symptom names a flow rather than a function, `mcp__memtrace__list_processes` + `mcp__memtrace__get_process_flow` trace the ordered call chain and show which step the diff sits on.
3. **Anti-paper-over gate:** Reject if the diff special-cases input, swallows errors, or touches presentation layers only. Fix must correct root cause.
   - **Check whether this is the same fix again.** Run `mcp__memtrace__get_timeline` on each changed symbol (`scope_path` + `file_path`) for its full version history across every episode, with an AST hash per point that separates structural change from whitespace. A symbol repeatedly patched in the same region — or patched, reverted, and patched again — is evidence the earlier fixes treated symptoms. Pair with `mcp__memtrace__find_hotspots` (complexity × recent churn): the PR landing on an existing hotspot means the fix has to hold in code that is already where the next bug lives, and "it passes CI" is a weaker signal there.
5. `/qa-test-architect` — evaluate boundary and architectural quality.
6. `/skills-from-the-artificer` — a real `Skill` call with `args` = one-sentence root cause + the changed files/symbols + `preset: bugfix-review`. Cite the returned `## Laws that apply` block in the review body; law names must come from the 24-law collection, not from recollection.
7. `/code-review` — then run **the Deterministic Review Pass** (defined once below, under §3D). It is not optional and not a summary of `/code-review`; it is the graph-backed half that a diff-only reviewer structurally cannot produce.
8. `/security-review`
9. **Isolated adversarial pass:** spawn a fresh reviewer subagent that did NOT author any change, with no prior context, to re-review independently. (This is the Claude Code equivalent of `/codex:adverserial-review` and satisfies the "≥1 review in an isolated reviewer context" rule.)
