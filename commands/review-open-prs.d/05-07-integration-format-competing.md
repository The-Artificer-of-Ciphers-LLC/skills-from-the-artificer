<!-- Part of /review-open-prs (commands/review-open-prs.md). Read this file in full when Phase B reaches this section. -->

### 5. External-tool integration gate (both tracks)
**[BLOCKING]**
If the diff integrates any external tool/API:
1. Research the interface (use Context7 via `mcp__context7` for library/SDK docs; for HTTP surface, `mcp__memtrace__get_api_topology` / `mcp__memtrace__find_api_calls` / `mcp__memtrace__find_api_endpoints`).
2. Verify the PR follows the documented interface.
3. Reject hacks.

### 6. PR-format compliance (both tracks)
**[BLOCKING]**
Check `CONTRIBUTING.md`. Branch format, Conventional Commits, Changeset format, Docs mapping, Template fields, Scope.

### 7. Competing PRs for the same issue
**[BLOCKING]**
`gh pr list --search "<issue-number> in:body" --state open`. Score each PR independently. Select the winner; queue the loser's close with rationale (per Batch write-action policy).

Score on comparable evidence rather than on which diff reads better: for each candidate, the §1.11 `get_impact` risk rating and affected-symbol count, the §3D `find_code_review_issues` / `find_cross_module_issues` finding counts by severity, the §4C co-change completeness gaps, and whether the fix site sits on the failing path (§3A.2 `find_dependency_path`). A narrower blast radius that still reaches the root cause beats a broader one that does not. State the compared numbers in the loser's close rationale — "we picked the other PR" is not a reviewable reason.
