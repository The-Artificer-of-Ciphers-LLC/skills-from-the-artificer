<!-- Part of /review-open-prs (commands/review-open-prs.md). Read this file in full when Phase B reaches this section. -->

### 2. Classify via linked-issue labels
**[BLOCKING]**
Cite verbatim:
- `RULESET.CONTRIB.CLASSIFY.fix=requires confirmed/confirmed-bug before implementation`
- `RULESET.CONTRIB.CLASSIFY.enhancement=requires approved-enhancement before implementation`
- `RULESET.CONTRIB.CLASSIFY.feature=requires approved-feature before implementation`

`confirmed-bug` → **Bug-Fix Track**. `approved-feature` / `approved-enhancement` → **Feature Track**. Missing label = gate violation. Ambiguous = halt and query user.

**Recorded-decision check (both tracks):** run `mcp__memtrace__recall_decision({query})` (free-text over the Decision/Conversation lanes — the param is **`query`**, never `question`), then `mcp__memtrace__governing_rules({repo_id, file_path})` on each changed file (this is the reachable "what governs this code?" call), and `mcp__memtrace__verify_intent({decision_id})` / `mcp__memtrace__get_arc({decision_id})` on an id `recall_decision` actually returned. **`mcp__memtrace__why_is_this_here` and `mcp__memtrace__governing_contracts` take a Cortex `symbol_id` that no tool returns** — `find_symbol` / `find_code` / `get_symbol_context` yield `file_path` plus line spans, not a `symbol_id` — so do not aim them "at the changed symbols"; use `governing_rules` on the file instead, and reach for the pair only if a real numeric id is already in hand. If the change violates a recorded ban, convention, or prior decision (Cortex), that is a **Blocker** finding regardless of label.

> **Read the verdict, not the absence of an error.** These five Cortex tools return a *deterministically-defended* verdict: `verify_intent` answers `Held`, `ViolatedAt`, or `CannotProve`; the rest answer `DeterministicallyDerived` or `CannotProve`. **`CannotProve` is a refusal, not a clean bill of health** — it means the decision is invisible to Cortex or has no implementing episode, which is exactly what an *undocumented* violation also looks like. Never write "no recorded decision governs this change" into the §8 evidence section on the strength of a `CannotProve`; write what the tool actually returned.
>
> Cortex runs as a local sidecar. When it is missing, the five schemas **remain in `tools/list`** and calls return an explicit unavailable result — the core server keeps working, so nothing else in this directive breaks and the failure is easy to miss. An unavailable Cortex means the recorded-decision gate did not run; say so in the review rather than reporting it as passed.

> `recall_decision` is **not optional** — it is one of the four tool names the §8 posting hook requires by name in the review body. Skipping it here means §8 cannot post. Note the hook only greps for the literal tool name (`require-memtrace-evidence.sh:67`), so a `CannotProve` or an unavailable-Cortex result will still satisfy the gate mechanically. The gate checks that you *named* the tool; only you can check that it *answered*.
