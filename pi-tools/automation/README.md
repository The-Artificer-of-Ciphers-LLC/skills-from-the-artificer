# Pi Tools — Automation

Automation directives for pi's local model. These are adapted from the Claude Code
`commands/` family but rewritten to work with pi's toolset (bash, codemode, read/write/edit)
and the local model for analysis and decision logic.

## Contents

| Directive | What it does |
|---|---|
| [`bug-fixer.md`](bug-fixer.md) | Sweeps confirmed-bug issues, runs each through diagnosis → TDD → review → PR → merge |

## Design Principles

1. **Local model first.** Analysis, diagnosis, and review run through `codemode` with the
   local model. Execution (git, tests, PRs) uses pi's native tools.

2. **Artifact gates as audit trail.** The original directives use hooks to enforce artifact
   files. In pi, these are convention-based — write the file before proceeding, and it
   becomes your proof of compliance.

3. **Graceful degradation.** If Memtrace/CodeGraph MCP servers are available, use them.
   Otherwise fall back to grep/read + local model analysis. Never silently substitute.

4. **One issue at a time.** The sweep processes issues sequentially, not in parallel. This
   avoids branch conflicts and keeps the queue state simple.

## Running a Directive

```bash
# From the repo root
/pi bug-fixer --repo owner/repo --base main

# Target a single issue
/pi bug-fixer --issue 123

# Dry run (preview only)
/pi bug-fixer --dry-run
```

## Adapting to Your Repo

Each directive encodes project-specific conventions (test runner, branch names, label
vocabulary). Before running:

1. Read the directive's "Runtime Parameters" section
2. Adjust defaults to match your repo
3. Replace any hardcoded commands with your project's equivalents

The defensive prose (incidents, "never" rules) is worth keeping — it traces to real
failures. The project-specific details are what you'll want to customize.
