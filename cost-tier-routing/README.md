# cost-tier-routing

A Claude Code skill + three companion subagents that route work to the cheapest model that can do it correctly. Stop paying opus prices to grep a directory.

## The idea

Opus tokens cost roughly **5x** sonnet and **25x** haiku. Most "do work" in a coding session is actually mechanical: locate a file, count lines, convert a CSV, write a known edit. Doing those on opus is lighting money on fire.

This package gives you:

| Piece | Role | Model |
|---|---|---|
| `cost-tier-routing` skill | Teaches the orchestrator *when* to delegate | n/a (skill) |
| `haiku-scout` agent | File search, grep/glob, bounded reads | `haiku` (pinned) |
| `haiku-importer` agent | CSV/JSON/YAML transforms, bulk file IO | `haiku` (pinned) |
| `sonnet-coder` agent | Implement a decided design, run tests | `sonnet` (pinned) |

The model is pinned in each agent's frontmatter, so once an agent is dispatched it physically cannot escalate itself to a more expensive tier. Cheap workers refuse reasoning work via a one-line `ESCALATE:` response rather than fake their way through it.

## Install

Unlike the other skills in this repo, this package ships **both a skill and agents**, which live in different directories under `~/.claude/`. Two `cp` commands:

```bash
# 1. The skill (teaches the orchestrator when to delegate)
mkdir -p ~/.claude/skills/cost-tier-routing
cp SKILL.md ~/.claude/skills/cost-tier-routing/

# 2. The three agents (the actual model pins)
mkdir -p ~/.claude/agents
cp agents/*.md ~/.claude/agents/
```

Or in one go from the package root:

```bash
mkdir -p ~/.claude/skills/cost-tier-routing ~/.claude/agents
cp SKILL.md ~/.claude/skills/cost-tier-routing/
cp agents/*.md ~/.claude/agents/
```

**Restart Claude Code.** The agent registry is loaded at session start, so newly-installed agents won't be available until you start a fresh session.

## ⚠️ Required: CLAUDE.md entry

**The skill description alone is not sufficient to trigger routing.** Testing confirmed that Claude Code will perform Grep/Bash directly on opus even with the skill installed, unless routing is also declared as a standing instruction in the project's `CLAUDE.md`.

Add the following to the top of `CLAUDE.md` in every project where you want cost-tier-routing enforced:

```markdown
## Cost discipline
Before any Grep, Glob, bulk Read, data transform, or routine code edit, consult the cost-tier-routing skill and dispatch to the appropriate subagent (haiku-scout, haiku-importer, or sonnet-coder). Do not perform these actions directly in the main context.
```

A ready-to-copy snippet is also provided in [`CLAUDE-snippet.md`](./CLAUDE-snippet.md) in this package.

### Why is this required?

The skill system works by Claude deciding to consult a skill based on its description. For tasks Claude can handle directly (grep, bash), it will often just do so rather than pausing to check whether a skill applies. Declaring cost discipline in `CLAUDE.md` makes it a standing rule that fires before every tool call, not an optional self-check.

## Verify install

In a new Claude Code session in a project with the CLAUDE.md entry, run:

```
find all files in the project that import FinanceKit
```

You should see:
1. `Skill(cost-tier-routing)` — the skill is consulted
2. An `Agent` call with `subagent_type: "haiku-scout"` — the work is dispatched

If you see a direct `Bash` or `Grep` call instead, check that the `CLAUDE.md` entry is present and restart the session.

## When it routes

| Action | Routes to |
|---|---|
| `Read` more than 1–2 files in a row | `haiku-scout` |
| `Grep` / `Glob` across the repo | `haiku-scout` |
| "Where is X?" / "List all Y" / "Count Z" | `haiku-scout` |
| Convert / parse / split / merge data files | `haiku-importer` |
| Write code at a known location with a known design | `sonnet-coder` |
| Refactor with clear constraints, run tests | `sonnet-coder` |

Stays on opus:
- Architectural decisions, tradeoff analysis
- Synthesis across multiple subagent reports
- User-facing explanations and recommendations

Full routing table and dispatch pattern: see `SKILL.md`.

## The escalation valve

Each haiku agent will refuse work that requires reasoning with a one-line response:

```
ESCALATE: this requires a reasoning model (sonnet/opus), not haiku-scout.
```

When the orchestrator sees that line, it knows to handle the task itself rather than re-dispatching. This is the safety net against haiku confidently producing wrong design decisions.

## Why a skill *and* agents?

A skill alone can only *guide* the orchestrator; it can't force a model downgrade. The `model:` field in agent frontmatter is the only physically-enforcing mechanism in Claude Code — once an agent is dispatched, that subagent runs on the pinned model regardless of what the orchestrator wanted.

So: the skill is the *trigger* (teaches opus when to delegate), and the agents are the *enforcement* (the actual model pin). Both are required. And the `CLAUDE.md` entry is what makes the trigger reliable.

## Uninstall

```bash
rm -rf ~/.claude/skills/cost-tier-routing
rm ~/.claude/agents/haiku-scout.md
rm ~/.claude/agents/haiku-importer.md
rm ~/.claude/agents/sonnet-coder.md
```

Remove the `## Cost discipline` block from any `CLAUDE.md` files where you added it.

Restart Claude Code.
