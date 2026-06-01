# skills-from-the-artificer

A collection of [Claude Code](https://docs.claude.com/en/docs/claude-code/overview) skills, distributed as drop-in directories. Each top-level folder is a self-contained skill — install it with the `skills` CLI, or copy it into `~/.claude/skills/` and restart Claude Code.

## Skills

| Skill | What it does |
|---|---|
| [`skills-from-the-artificer/`](skills-from-the-artificer/) | **Meta dispatcher.** Given a change, fix, diff, design, or decision, classifies it and points you at the relevant law/principle skill(s) from the 24-law collection below. The entry point for "which laws apply here?" and the Bug Remediation Step 2 cross-reference. |
| [`cost-tier-routing/`](cost-tier-routing/) | Routes work to the cheapest model that can do it correctly — haiku for search/IO, sonnet for coding, opus for orchestration. Ships a skill **and** three model-pinned subagents. |
| [`cost-routing/`](cost-routing/) | Top-level dispatcher that classifies requests into scout / coder / architect tiers and ships dispatch templates + a PreToolUse warning hook. Companion form to `cost-tier-routing`. |
| [`rubber-duck/`](rubber-duck/) | Interactive rubber-duck debugging session. Forces you to reconstruct your mental model of the bug from scratch, which is where the bug usually surfaces. |
| [`test-first-bugfix/`](test-first-bugfix/) | Test-driven bug fixing — reproduce the bug as a failing test before you touch the fix. Catches "fixes" that don't actually fix anything and prevents regressions. |
| [`trust-but-verify/`](trust-but-verify/) | Re-validates every claim a subagent hands back against a primary source — the code, docs/ADRs, the memory dir, context7, or a language spec — before you act on it. Treats a report as a lead, not a fact: nothing is verified until a source was opened and quoted. |
| [`ci-preflight/`](ci-preflight/) | Pre-push checklist that prevents CI whiplash — multiple red pushes that could have been caught locally. Guards against three anti-patterns: missing registration surfaces when adding new shipped files, skipping `npm test` before pushing, and guessing at cross-platform fixes instead of diagnosing the root cause. |

### Laws of software (24 reference skills)

A pack of software-engineering laws, each loaded as an on-demand reference skill. Every law is its own top-level directory:

[`choose-boring-technology/`](choose-boring-technology/) ·
[`conways-law/`](conways-law/) ·
[`cunninghams-law/`](cunninghams-law/) ·
[`doerrs-law/`](doerrs-law/) ·
[`fitts-law/`](fitts-law/) ·
[`galls-law/`](galls-law/) ·
[`goodharts-law/`](goodharts-law/) ·
[`greenspuns-tenth-rule/`](greenspuns-tenth-rule/) ·
[`hofstadters-law/`](hofstadters-law/) ·
[`hyrums-law/`](hyrums-law/) ·
[`kerckhoffs-principle/`](kerckhoffs-principle/) ·
[`kernighans-law/`](kernighans-law/) ·
[`knuths-optimization-principle/`](knuths-optimization-principle/) ·
[`lady-lovelaces-objection/`](lady-lovelaces-objection/) ·
[`leaky-abstractions/`](leaky-abstractions/) ·
[`linuss-law/`](linuss-law/) ·
[`moores-law/`](moores-law/) ·
[`norvigs-law/`](norvigs-law/) ·
[`parkinsons-law/`](parkinsons-law/) ·
[`peter-principle/`](peter-principle/) ·
[`postels-law/`](postels-law/) ·
[`shirky-principle/`](shirky-principle/) ·
[`wirths-law/`](wirths-law/) ·
[`zawinskis-law/`](zawinskis-law/)

## Install (recommended: the `skills` CLI)

The [`skills`](https://skills.sh/) CLI discovers each top-level skill and installs it for you. Add `-g` to install globally (user-level, into `~/.claude/skills/`) instead of into the current project.

```bash
# install everything
npx skills add The-Artificer-of-Ciphers-LLC/skills-from-the-artificer --all -g

# or choose interactively
npx skills add The-Artificer-of-Ciphers-LLC/skills-from-the-artificer -g

# or install specific skills
npx skills add The-Artificer-of-Ciphers-LLC/skills-from-the-artificer -g --skill conways-law,rubber-duck
```

## Install (manual)

Each skill is also a `cp -r` away:

```bash
# pick the ones you want
cp -r rubber-duck ~/.claude/skills/
cp -r test-first-bugfix ~/.claude/skills/
cp -r conways-law ~/.claude/skills/

# or grab every law at once
cp -r *-law *-principle *-rule *-objection *-technology *-abstractions ~/.claude/skills/
```

Restart Claude Code. The skill discovery scan runs at session start.

## Install (skills that ship agents too)

`cost-tier-routing/` is unusual — it includes companion subagents that have to land in `~/.claude/agents/`, not `~/.claude/skills/`. Its `README.md` documents the two-step install. The skill alone is inert without the agents because the `model:` pin lives in the agent files.

```bash
cd cost-tier-routing
mkdir -p ~/.claude/skills/cost-tier-routing ~/.claude/agents
cp SKILL.md ~/.claude/skills/cost-tier-routing/
cp agents/*.md ~/.claude/agents/
```

## How skills work

A skill is a directory containing a `SKILL.md` with YAML frontmatter — `name` and `description` — followed by the prose Claude Code reads when the skill triggers. The description is the trigger surface: Claude scans loaded skill descriptions against the current task and invokes a skill via the `Skill` tool when the description matches. Skills can ship supporting files (eval suites, reference scripts, sub-skills) alongside `SKILL.md`.

See the [Claude Code skills docs](https://docs.claude.com/en/docs/claude-code/skills) for the canonical reference.

## Evals

Some skills include an `evals/evals.json` file with prompts and expected behaviors. These are consumed by the `skill-creator` workflow to benchmark whether a skill triggers correctly and produces the expected routing decisions. The format is intentionally minimal:

```json
{
  "skill_name": "<name>",
  "evals": [
    {
      "id": 0,
      "prompt": "<user prompt that should trigger the skill>",
      "expected_output": "<what Claude should do, prose>",
      "files": []
    }
  ]
}
```

## Contributing a skill

1. Create a top-level directory named after the skill (kebab-case).
2. Drop in a `SKILL.md` with the frontmatter `name:` and `description:` fields, followed by the body Claude should read.
3. Optionally add `evals/evals.json` with trigger prompts and expected behaviors.
4. Optionally add a per-skill `README.md` documenting anything unusual about the install (e.g. companion agents).
5. PR.

## License

Skills in this repo are MIT-licensed unless a skill's own directory says otherwise.
