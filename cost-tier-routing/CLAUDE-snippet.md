# CLAUDE.md snippet — cost-tier-routing

Add this block to the top of `CLAUDE.md` in any project where you want cost-tier-routing enforced.
Without this entry the skill will not reliably trigger — Claude Code will perform Grep/Bash directly
on opus even with the skill and agents installed.

```markdown
## Cost discipline
Before any Grep, Glob, bulk Read, data transform, or routine code edit, consult the cost-tier-routing skill and dispatch to the appropriate subagent (haiku-scout, haiku-importer, or sonnet-coder). Do not perform these actions directly in the main context.
```

## Verification

After adding the entry and restarting Claude Code, run:

```
find all files in the project that import FinanceKit
```

You should see `Skill(cost-tier-routing)` load, followed by an Agent dispatch to `haiku-scout`.
If you see a direct Bash or Grep call, the entry is missing or the session wasn't restarted.
