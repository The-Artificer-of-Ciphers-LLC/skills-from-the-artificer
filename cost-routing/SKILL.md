---
name: cost-routing
description: Top-level dispatcher that classifies every incoming request into scout / coder / architect tiers BEFORE any tool call. Routes Read, Grep, Glob, file-search, symbol-lookup, "where is X", and "list files matching Y" to haiku-scout. Routes known-location Edit, Write, multi-file refactor, test authoring, and bounded code changes to sonnet-coder. Reserves the main opus context for ambiguous design questions, ADRs, and tradeoff analysis. Use whenever a request lands in the main context and might involve file IO, code search, code edits, or design reasoning — which is almost every turn.
---

# Cost-Tier Routing

The main context runs on opus. Every Read, Grep, Glob, and Edit invoked at this tier bills at opus rates. Most operations don't need opus reasoning — they need a model that can run a command and report a result. This skill is the dispatch gate that stops opus from doing work haiku or sonnet would complete just as correctly for a fraction of the cost.

## The three tiers

| Tier          | Model  | Owns                                       | Example requests                                                                                       |
| ------------- | ------ | ------------------------------------------ | ------------------------------------------------------------------------------------------------------ |
| **scout**     | haiku  | Read-only lookup, search, location         | "Where is `Foo` defined?", "List files matching `*.test.ts`", "Count LOC in `src/`", "Read X and report Y" |
| **coder**     | sonnet | Bounded code changes at known locations    | "Add a test for `parseDate`", "Refactor `auth.ts` to use the new client", "Rename `A` → `B` repo-wide"  |
| **architect** | opus   | Ambiguous spec, tradeoff analysis, design  | "Should we use Redux or Zustand?", "Draft an ADR for the auth rewrite", "Why is this architecture failing?" |

## The dispatch decision (run this first, every turn)

Before reaching for any tool, run this classifier against the incoming request:

1. **Is the work entirely read / search / location?** → **scout**. Dispatch `haiku-scout`. Never call Read / Grep / Glob in the main context.
2. **Is the change scope AND the design already decided?** → **coder**. Dispatch `sonnet-coder` with a precise brief.
3. **Is the user asking "should we", "why", "what are the tradeoffs", "design X"?** → **architect**. Stay in-context (you ARE opus) or dispatch with `model: "opus"`.
4. **Mixed?** → split. Scout first to gather facts, then re-classify the next step. Never bundle scout work into an architect dispatch.

If the answer to #1 is yes and you find yourself reaching for Read / Grep / Glob in the main context anyway — STOP. That is the violation this skill exists to prevent.

## Dispatch templates

See [PROMPTS.md](PROMPTS.md) for the canonical brief for each tier. Use them verbatim — every field is load-bearing.

## Worked examples

See [EXAMPLES.md](EXAMPLES.md) for ~15 classifications across the boundary cases (multi-file search, bug fixes with unknown root cause, "small" edits that hide design questions).

## Enforcement

The companion PreToolUse hook (`hooks/pre-tool-use-cost-check.sh`) warns when Read / Grep / Glob fires in the main context. Register it in `~/.claude/settings.json` (see EXAMPLES.md § Installing the hook).

- Default mode: **warn** (writes to stderr, the call proceeds).
- `COST_ROUTING_BLOCK=1` upgrades the warning to a hard `deny` — useful for sessions where you want zero tolerance.
- `COST_ROUTING_BYPASS=1` silences the hook for legitimate one-shot inspection (a single Read of a file the user pasted a path to).

The hook cannot perfectly distinguish "top level opus" from "inside a subagent" — Claude Code does not currently expose that bit to hooks. It warns on every Read / Grep / Glob; you teach yourself to recognize the warning as "I'm probably in opus, should I have dispatched?"

## When NOT to dispatch

- The entire task is one unattended CLI command (`gh pr view`, `docker ps`). Use `Bash` directly — wrapping a one-shot command in an agent is pure overhead.
- The user pasted a single file path and asked for a single fact. Read it directly; dispatch overhead exceeds the saved tokens.
- The work is genuinely ambiguous design that needs opus reasoning. Don't dispatch yourself to yourself.

## Common failure modes

- **Tier creep** — classifying a multi-file *search* as "design work" because it touches many files. Multi-file search is still scout.
- **Dispatch without `model:`** — calling `Agent` with `subagent_type: "general-purpose"` and no `model:` parameter inherits the parent tier (opus → opus). Always pin the model.
- **Skipping the classifier** — jumping to Read on instinct. The classifier IS the skill; running it costs two seconds and saves the budget every time.
- **Bundling tiers** — handing scout work to a coder dispatch ("find the file, then edit it"). The coder agent will burn sonnet tokens doing scout work. Split: scout reports the path; coder edits at that path.
