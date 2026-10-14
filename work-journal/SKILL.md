---
name: work-journal
description: Record and recall per-branch session decisions across sessions and agent worktrees using an append-only local markdown journal. Use at the end of each short work cycle, after a build or test result, before handing work to another agent, or when resuming a branch.
---

# work-journal

Convention: per-branch, append-only, local markdown at `$(git rev-parse --git-common-dir)/work-journal/<branch>.md`. Every worktree of the repository shares the same git common dir, so all agents read and write the same folder; nothing is committed. (Slashes in branch names are replaced with `-`.)

The bundled script `scripts/journal.sh` implements it. Optional wiring you can add yourself: a session-start hook that prints `journal.sh tail 2`, and a Stop hook that asks for an entry when HEAD has no journal entry. Neither is required.

Durable, curated lessons belong in your project's own notes; when a journal entry produces a lesson, copy the one-line lesson there.

## Entry shape (under 15 lines)

```markdown
**Change:** <what changed, one sentence>
**Decision:** <what was decided and why, if the code does not say it>
**Evidence:** <file:line, test names, telemetry, build number>
**Verified:** <build, tests run and result>
**Next:** <the next highest-leverage step, or blocker>
```

## Commands

```bash
J="<path-to-this-skill>/scripts/journal.sh"
"$J" add <<'MD'
**Change:** ...
MD
"$J" tail 5
```

The header (date, branch, short HEAD sha) is added for you. Journal after committing.
