---
name: cost-tier-routing
description: Use BEFORE doing direct file search, bulk reads, data import/export, or routine coding edits in the main conversation. Routes work to the cheapest model that can do it correctly — haiku for search/IO, sonnet for coding, opus for orchestration/architecture. Triggers when about to call Read on >2 files, Grep/Glob across the repo, batch CSV/JSON transforms, or any "where is X / list all Y / count Z" question. Also triggers when the orchestrator (you, on opus) is about to write straightforward code that a sonnet subagent could handle.
---

# Cost-Tier Routing

Opus tokens cost ~5x sonnet and ~25x haiku. Doing `Read` and `Grep` on opus is lighting money on fire. This skill is the discipline for routing every action to the cheapest model that can do it correctly.

> **This skill requires three companion agents** — `haiku-scout`, `haiku-importer`, and `sonnet-coder` — installed in `~/.claude/agents/`. See this package's `README.md` for the two-step install. The skill is inert without the agents because the `model:` pin lives in the agent files, not here.

## The rule

Before any of these actions in the main (opus) context, **dispatch to a subagent instead**:

| Action | Route to | Why |
|---|---|---|
| `Read` more than 1–2 files in a row | `haiku-scout` | Bulk reads burn opus context |
| `Grep` / `Glob` across the repo | `haiku-scout` | Mechanical lookup |
| "Where is X defined?" / "What references Y?" | `haiku-scout` | Pure search |
| Count LOC, list files, read a config | `haiku-scout` | Trivial IO |
| Convert/parse/split/merge data files | `haiku-importer` | Mechanical transform |
| Download + parse a fixture or seed file | `haiku-importer` | Mechanical IO |
| Write code at a known location with a known design | `sonnet-coder` | Implementation, not design |
| Refactor a function with clear constraints | `sonnet-coder` | Bounded edit |
| Run tests / typecheck after an edit | `sonnet-coder` (bundle with the edit) | Don't bounce back to opus mid-task |

Keep on opus (the orchestrator):
- Architectural decisions, tradeoff analysis
- Reading subagent reports and deciding the next step
- Synthesis across multiple subagent outputs
- User-facing explanations and recommendations

## The dispatch pattern

When you (opus) recognize a routable task:

1. **Phrase the brief like a closed ticket**, not an open question. Include: exact files/dirs, exact output format, exact verification command.
2. **Call `Agent` with the right `subagent_type`** — `haiku-scout`, `haiku-importer`, or `sonnet-coder`. The model is pinned in the agent file; do not override unless you have a specific reason.
3. **Read the report, don't redo the work.** If the subagent missed something, dispatch again with a sharpened brief — don't bail out and do it yourself on opus.
4. **Parallel where independent.** If you need three unrelated searches, fire three `haiku-scout` calls in one message.

## When to NOT route

- A single one-line `Read` of a file you're about to edit yourself — just read it.
- A trivial `Grep` (one pattern, one directory) you're about to act on immediately — just grep.
- Tasks already inside a subagent — subagents do their own work, they don't recursively dispatch the same tier.
- When the user explicitly asked you to do it directly.

The threshold is roughly: **if the action will take >3 tool calls or >1000 tokens of file content, route it.**

## Red flags (you're about to waste money)

- "Let me read these 8 files to understand the structure" → STOP, dispatch `haiku-scout` with a structural-survey brief.
- "Let me grep for all usages, then read each one" → STOP, dispatch `haiku-scout` to return paths+excerpts in one shot.
- "I'll just write this small fix" while sitting on opus → consider `sonnet-coder` if it involves >1 file or any test run.
- "Let me convert this CSV real quick" → STOP, dispatch `haiku-importer`.

## Escalation back to opus

Subagents are instructed to escalate when they hit reasoning work. When you get a report ending in `ESCALATE: ...`, that's the signal that the next step is genuinely yours. Don't push it back down — handle it on opus and re-dispatch a sharpened mechanical task if needed.

## Self-check

Before every tool call in the main context, ask: *Could a cheaper model do this exact action with the same correctness?* If yes, dispatch. If no, proceed.
