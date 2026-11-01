<!-- Part of /review-open-prs (commands/review-open-prs.md). Read this file in full when Phase B reaches this section. -->

### 3B. Feature / Enhancement Track
**[BLOCKING]**
1. **ADR Gate:** Features require an ADR under `docs/adr/`. Enhancements require grep validation of existing ADRs. Verify the ADR actually governs the changed code with `mcp__memtrace__governing_rules({repo_id, file_path})` on the changed files — that call is keyed on a path, which is what you have — and `mcp__memtrace__get_arc({decision_id})` on an id `recall_decision` returned. (`governing_contracts` needs a Cortex `symbol_id` no tool returns; it is not usable here.)
2. **Documentation Gate:** Evaluate docs against Diátaxis style (`/writing-documentation-with-diataxis`). Hard blocker if missing.
3. **Functional validation:** Extract every promised feature into a checklist. Exercise each item on the PR branch. For any item described as a flow rather than a function, verify it structurally as well as behaviorally: `mcp__memtrace__list_processes` then `mcp__memtrace__get_process_flow` traces the named execution process from entry point through the full call chain, in order, with file/line and community per step. A feature that "works" in manual exercise but whose new code sits on no traced process — or that leaves the old path still wired as the reachable one — is a half-landed change, and the process trace is what makes that visible.
4. `/qa-test-architect` — analyze coverage strategy (assert property-based or boundary coverage).
5. `/security-review`
6. **Isolated adversarial pass** (fresh subagent, as in 3A.9).
7. `/code-review` — plus **the Deterministic Review Pass** (§3D), identical to the Bug-Fix track's §3A.7.
8. `/rubber-duck` & `/skills-from-the-artificer` — walk through the implementation. Invoke `/codebase-design`, `/memtrace-skills:memtrace-change-impact-analysis`, and the Artificer Laws via a real `/skills-from-the-artificer` `Skill` call (`args` = the PR's one-sentence design + changed files/symbols + `preset: design-review`); cite its `## Laws that apply` block in the review body.
