# CLAUDE.md snippet — cost-tier-routing

Add this block to the **top** of `CLAUDE.md` in any project where you want cost-tier-routing enforced.

Without this entry the skill will not reliably trigger — Claude Code will perform `Grep`/`Bash` directly on opus even with the skill and agents installed. The skill description is opt-in by relevance match; for mechanical work opus often just does the work rather than pausing to consult a skill. A standing `CLAUDE.md` rule turns the routing check into a per-tool-call requirement.

The snippet has two sections:

1. **Cost discipline** — bans direct IO on opus when a cheaper agent could handle the same call.
2. **Agent-tier discipline** — closes the two gaps the first rule leaves open: wrapping one-shot CLI commands in agents, and dispatching agents without pinning a model tier.

Paste both sections at the top of `CLAUDE.md`, above any other project-specific rules. The cost rule must take precedence over default behavior.

---

````markdown
## ⛔ COST DISCIPLINE (NON-NEGOTIABLE — BLOCKS ALL DIRECT IO)

If you are running on opus, you MAY NOT call `Read`, `Grep`, `Glob`, `Edit`, or `Write` directly when the operation could be handled by `haiku-scout`, `haiku-importer`, or `sonnet-coder`. This is not a guideline. It is a hard rule.

Dispatch FIRST. Reason SECOND. Never invert the order.

Treat any direct main-context `Read` of a file >50 lines, any `Grep`/`Glob`, or any `Bash` using `cat`, `head`, `tail`, `grep`, `sed`, `awk`, or `find` as a directive violation.

This rule sits above every other rule. It does not yield to convenience, urgency, or the belief that "just one quick read" is harmless. There is no exception. Every violation is waste charged to the user.

### Concrete violation examples (do NOT repeat)

- Reading `STATE.md` (large narrative file) directly on opus → should dispatch `haiku-scout`
- Reading a 1784-line workflow file directly on opus → should dispatch `haiku-scout` with a focused extraction brief
- `Bash` with `grep -n …` for symbol lookup → should dispatch `haiku-scout`
- Multiple `Edit` calls to refactor a roadmap file → should dispatch `sonnet-coder` with a precise change brief

### Self-check before every tool call (mandatory)

Before reaching for any tool, answer these four questions:

1. "Am I on opus right now?" (Yes if you don't know — assume yes.)
2. "Could a `haiku-scout` / `haiku-importer` / `sonnet-coder` agent do this same call correctly?"
3. "Is the action either: (a) >1 file read, (b) any cross-repo search, (c) any data transform, or (d) any code edit at a known location?"
4. "If any answer above is YES → STOP. Dispatch the right agent instead. Document the dispatch."

## ⚡ AGENT-TIER DISCIPLINE (DON'T WRAP CHEAP WORK IN EXPENSIVE AGENTS)

The COST DISCIPLINE rule above bans direct opus IO. This rule closes two gaps it leaves open.

### Gap 1 — Wrapping one-shot CLI invocations in agents

If the entire task is a single CLI invocation that runs unattended (`gh pr view`, `docker ps`, `terraform plan`, `gcloud auth …`), DO NOT dispatch an agent. Just call `Bash` directly. An agent for a one-shot CLI command is pure overhead — token cost for the agent's reasoning, output, and summary on top of the command itself.

Agents are warranted when there is:

- Branching ("if SSH key A fails try B fails try C")
- Validation between steps ("verify state X before mutation Y")
- Error recovery ("if step fails, log and continue with next file")
- Multi-tool sequences (SSH + ffmpeg + curl + mv on the same session)
- Output too large for the main context to swallow

If none of those apply, the right primitive is direct `Bash`, not an agent dispatch.

### Gap 2 — Failing to specify model tier on Agent dispatch

The `Agent` tool's `subagent_type: "general-purpose"` (and most named agents that don't pin a model in their frontmatter) inherit the parent's model. From opus, that means an opus-tier agent — which is rarely what the work needs.

**MANDATORY**: every `Agent` call must include an explicit `model:` parameter unless the agent definition itself pins a model. Pick the lowest tier the task can plausibly complete:

| Work shape | Required tier |
|---|---|
| Mechanical CLI runners, file enumeration, count-and-report, schema-conformant transforms, single-command verifications | `haiku` |
| Operational sequences with branches, validation between steps, API mutations with state checks, error recovery, multi-step file editing at known locations | `sonnet` |
| Architectural reasoning, multi-system design, ambiguous root-cause hunting, cross-codebase synthesis | `opus` (rare — justify before reaching for it) |

Default to the lowest tier. Tier up only when the work demonstrably needs the reasoning.

### Self-check before every Agent dispatch (mandatory)

Before calling `Agent`, answer in order:

1. "Is the entire task one CLI command that runs unattended?" → YES means use `Bash` directly, not `Agent`.
2. "Does the task have branches, validation between steps, or error recovery?" → If NO and IO can be batched, prefer a single Bash + heredoc/script over an agent.
3. "What is the LOWEST model tier this work can plausibly complete on?" → Pass that as `model:` on the dispatch. `haiku` for mechanical, `sonnet` for operational, `opus` only with explicit justification.
4. "Am I about to dispatch `subagent_type: \"general-purpose\"` without `model:`?" → STOP. Add the model parameter. Inheritance defaults to parent (opus from opus) and that is almost always wrong.
````

---

## Verification

After adding the entry and restarting Claude Code, run:

```
find all files in the project that import FinanceKit
```

You should see `Skill(cost-tier-routing)` load, followed by an `Agent` dispatch to `haiku-scout`. If you see a direct `Bash` or `Grep` call, the entry is missing or the session wasn't restarted.

## Why this version (and not a one-paragraph rule)

The minimal version inline in the project `README.md` describes the rule. The block above is what actually fires in practice. It works because:

- The strong framing ("NON-NEGOTIABLE", "BLOCKS ALL DIRECT IO") survives the orchestrator's tendency to rationalize "just one quick read."
- The four-question self-check turns the rule into a per-tool-call gate rather than a vague guideline.
- The concrete violation examples give the orchestrator named patterns to match against.
- The companion agent-tier-discipline rule prevents the regression where you stop doing direct IO but start wrapping one-shot CLI commands in opus-tier agents (which is worse).

Trim only if you have a specific reason to. The full block is what was tested.
