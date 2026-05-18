# cost-routing

A top-level dispatcher skill for Claude Code that classifies every incoming request into **scout**, **coder**, or **architect** tiers BEFORE any tool call — and routes the work to the cheapest model that can complete it correctly.

> **Companion to `cost-tier-routing` in this repo.** That skill is the *enforcement* form (a terse "don't do X" rule). This one is the *orchestrator* form: classifier + dispatch templates + PreToolUse warning hook. They share trigger keywords; pick one or install both (they don't conflict — only this one registers the hook).

## What you get

- **Classifier** (SKILL.md): a four-step decision tree that triggers on every Read / Grep / Glob / Edit / Write / "where is" / "list files" / "refactor" / "test for" request.
- **Dispatch templates** (PROMPTS.md): canonical briefs for haiku-scout, sonnet-coder, and architect dispatches. Fill in the bracketed fields and go.
- **Worked examples** (EXAMPLES.md): 15 request → tier mappings, including the boundary cases that get misclassified (multi-file search, ambiguous bug, "small" edit that hides a design question).
- **PreToolUse hook** (`hooks/pre-tool-use-cost-check.sh`): warns when Read / Grep / Glob fires in the main context. Soft warn by default; upgrade to hard deny with `COST_ROUTING_BLOCK=1`.

## Install

Three steps. Do all three.

### 1. Install the skill files

```bash
mkdir -p ~/.claude/skills/cost-routing
cp -r cost-routing/* ~/.claude/skills/cost-routing/
chmod +x ~/.claude/skills/cost-routing/hooks/pre-tool-use-cost-check.sh
```

The skill now appears in your active skill list and will route on the trigger keywords in its description.

### 2. Register the PreToolUse hook in `~/.claude/settings.json`

Merge this entry into your existing `hooks.PreToolUse` array. **Do not overwrite — append.**

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Read|Grep|Glob",
        "hooks": [
          {
            "type": "command",
            "command": "$HOME/.claude/skills/cost-routing/hooks/pre-tool-use-cost-check.sh"
          }
        ]
      }
    ]
  }
}
```

If a matcher with exactly `"Read|Grep|Glob"` already exists in your settings, append the new `command` object to its existing `hooks` array instead of creating a duplicate matcher entry.

### 3. Verify

Open a fresh Claude Code session and run any Read. You should see `cost-routing: Read invoked in main context...` on stderr. The call still proceeds — the hook is advisory by default.

## Routing table

| Tier          | Model  | Owns                                       |
| ------------- | ------ | ------------------------------------------ |
| **scout**     | haiku  | Read-only lookup, search, location         |
| **coder**     | sonnet | Bounded code changes at known locations    |
| **architect** | opus   | Ambiguous spec, tradeoff analysis, design  |

## Tuning the hook

| Goal                                           | How                                                         |
| ---------------------------------------------- | ----------------------------------------------------------- |
| Hard-block top-level Read / Grep / Glob        | `export COST_ROUTING_BLOCK=1` in your shell rc              |
| Silence the warning for one legit Read         | `export COST_ROUTING_BYPASS=1` for the session              |
| Disable entirely                               | Remove the matcher entry from `~/.claude/settings.json`     |

## Coexistence with `cost-tier-routing`

Both skills can be installed simultaneously. They share trigger keywords; whichever activates first, the rules are aligned. The differences:

- **`cost-tier-routing`** — rules-only, terse, built for repeated reinforcement. Tells you what NOT to do (don't Read on opus, dispatch instead).
- **`cost-routing`** — orchestration-first: classifier + dispatch templates + hook. More material to read, but it covers the full workflow including the "how do I phrase the dispatch" gap and the enforcement bit (the hook).

If you only want one: `cost-tier-routing` for minimal footprint, `cost-routing` for the full kit. If you want both: they don't conflict; the hook only registers from `cost-routing`.

## Uninstall

```bash
rm -rf ~/.claude/skills/cost-routing
```

Then remove the hook entry from `~/.claude/settings.json` — delete just the `command` object whose path ends in `cost-routing/hooks/pre-tool-use-cost-check.sh`. Leave any other hooks under the same `Read|Grep|Glob` matcher intact.

## License

MIT — see the repo root README.
