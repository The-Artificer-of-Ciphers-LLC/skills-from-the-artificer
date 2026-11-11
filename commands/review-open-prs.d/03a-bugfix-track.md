<!-- Part of /review-open-prs (commands/review-open-prs.md). Read this file in full when the run reaches this section. -->

### 3A. Bug-Fix Track
**[BLOCKING]**
1. `/diagnose` — reproduce defect.
2. `/root-cause-analysis` — identify true root cause. Compare against the PR. Compute blast radius with `codegraph impact` (§1.11); on a full-tier PR, the §1.11b `get_impact` result is the second opinion.
   - **Prove the fix site is actually on the failing path.** Walk `codegraph callers` up from the symbol the PR modifies until you reach the reported entry point. **No path is a Blocker**: it means the diff cannot reach the reported symptom, which is the signature of a fix aimed at the wrong layer. Where the symptom names a flow rather than a function, trace it with `codegraph callees` from the entry point and show which step the diff sits on.
3. **Anti-paper-over gate:** Reject if the diff special-cases input, swallows errors, or touches presentation layers only. Fix must correct root cause.
   - **Check whether this is the same fix again.** Run `git log -L :<function>:<file>` (or `git log -p --follow -- <file>` when `-L` cannot find the function) on `origin/next` for each changed symbol. A symbol repeatedly patched in the same region — or patched, reverted, and patched again — is evidence the earlier fixes treated symptoms; ignore whitespace-only commits (`git log -w`). Pair with churn: `git log --since=90.days --format= --name-only -- <file> | wc -l`. The PR landing on a high-churn file means the fix has to hold in code that is already where the next bug lives, and "it passes CI" is a weaker signal there.
5. `/qa-test-architect` — evaluate boundary and architectural quality.
6. `/skills-from-the-artificer` — a real `Skill` call with `args` = one-sentence root cause + the changed files/symbols + `preset: bugfix-review`. Cite the returned `## Laws that apply` block in the review body; law names must come from the 24-law collection, not from recollection.
7. `/code-review` — then run **the Deterministic Review Pass** (defined once below, under §3D). It is not optional and not a summary of `/code-review`; it is the graph-backed half that a diff-only reviewer structurally cannot produce.
8. `/security-review`
9. **Isolated adversarial pass:** spawn a fresh reviewer subagent that did NOT author any change, with no prior context, to re-review independently. (This is the Claude Code equivalent of `/codex:adverserial-review` and satisfies the "≥1 review in an isolated reviewer context" rule.)
