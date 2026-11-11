<!-- Part of /review-open-prs (commands/review-open-prs.md). Read this file in full when the run reaches this section. -->

### 5. External-tool integration gate (both tracks)
**[BLOCKING]**
If the diff integrates any external tool/API:
1. Research the interface (use Context7 via `mcp__context7` for library/SDK docs; for an HTTP surface, the provider's own API reference, plus `codegraph callers` on the client wrapper to find every call site).
2. Verify the PR follows the documented interface.
3. Reject hacks.

### 6. PR-format compliance (both tracks)
**[BLOCKING]**
Check `CONTRIBUTING.md`. Branch format, Conventional Commits, Changeset format, Docs mapping, Template fields, Scope.

### 7. Competing PRs for the same issue
**[BLOCKING]**
`gh pr list --search "<issue-number> in:body" --state open`. Score each PR independently. Select the winner. Review only this run's PR; if it is the loser, recommend its close with the rationale in the report (close it only when `AUTONOMOUS` = `true`, with a comment that opens with `AI-assisted review by @trek-e.`).

Score on comparable evidence rather than on which diff reads better: for each candidate, the §1.11 `codegraph impact` affected-symbol and file count, the §3D finding counts by severity, the §4C co-change completeness gaps, and whether the fix site sits on the failing path (§3A.2). A narrower blast radius that still reaches the root cause beats a broader one that does not. State the compared numbers in the loser's close rationale — "we picked the other PR" is not a reviewable reason.
