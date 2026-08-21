# commands

Workflow directives as Claude Code **slash commands**. These replace the former `directives/`
folder — same procedures, but invocable (`/bug-fixer`) instead of pasted. All but
`review-open-prs.md` carry frontmatter declaring the tools they may touch; that one has never had
any, so it runs with whatever your session already grants.

| Command | Replaces | What it does |
|---|---|---|
| [`feature-builder.md`](feature-builder.md) | `Feature Implementation.md` | Implements a feature issue or epic. Graph-backed research, recorded-decision and known-defect gauntlets, epic decomposition with seam validation, then a per-deliverable loop: design → TDD → mutation gate → two orthogonal reviews → docs → rebase → PR. |
| [`bug-fixer.md`](bug-fixer.md) | `Bug Remediation and Diag.md` | Sweeps confirmed defects unattended and runs each **through merge** — diagnosis → failing-first TDD → two orthogonal reviews → PR → CI watch → merge. A blocked issue parks with a reason; the sweep continues. |
| [`triage-review.md`](triage-review.md) | `Feature Review Directive.md` | Batch-triages untriaged issues. Defects get a diagnosis + agent brief + `confirmed-bug`; enhancements and features get a maintainer decision recorded on the tracker. |
| [`review-open-prs.md`](review-open-prs.md) | `PR Review.md` | Reviews every open PR you did not author, with graph-backed impact and cross-module passes. |
| [`test.md`](test.md) | — | Runs the test suite on Mac, Linux Docker, and Windows Docker in parallel, then categorizes failures by which platforms they hit (all-fail = real bug; single-platform = environment-specific). |

## Install

Symlink them so this repo stays the single source of truth — edits here take effect without a
re-copy, and edits made while using a command land back in version control:

```bash
for f in "$PWD"/commands/*.md; do [ "$(basename "$f")" = README.md ] || ln -sfn "$f" ~/.claude/commands/; done
```

Or copy them, if you would rather fork and diverge:

```bash
cp commands/*.md ~/.claude/commands/
```

Restart Claude Code. They appear as `/feature-builder`, `/bug-fixer`, `/triage-review`,
`/review-open-prs`, `/test`.

## Read this before running them

**These are not generic.** They are written against one project's toolchain and encode its rules
verbatim. Treat them as a strong starting shape, not a drop-in — running them unedited against a
different repo will produce confident references to things you do not have. Adapt at minimum:

- **The test runner.** In `feature-builder.md` and `bug-fixer.md` — the two that write code — every
  gate keys on a remote dockerized runner (`gsd-test`) and its
  `{"type":"verdict","outcome":"passed"}` line, including the rule that a passing verdict is bound to
  an exact commit sha. Substitute your own runner *and* its equivalent "this pass belongs to this
  sha" evidence — that binding is the part that matters, not the tool. `triage-review.md` and
  `review-open-prs.md` never invoke it — they diagnose and report without editing, so there is
  nothing to substitute there.
- **The controlling files.** They defer to `CLAUDE.md` / `AGENTS.md` > `CONTRIBUTING.md` >
  `docs/adr/*` > `CONTEXT.md`. Repoint at yours.
- **The known-defect gauntlet** in `feature-builder.md` is a list of *that repo's* real recorded
  failures — Windows argv limits, config-key whitelists, path-separator normalization. Yours will be
  different. Keep the mechanism, replace the entries; a gauntlet of someone else's bugs is theater.
- **Memtrace.** The four directives are Memtrace-first for code discovery, impact, and decision recall. Without
  it, the graph-backed steps degrade to grep — which the directives explicitly forbid, so either
  install it or rewrite those steps honestly rather than leaving instructions you intend to ignore.
- **Label and branch vocabulary.** `confirmed-bug`, `needs-reproduction`, `.out-of-scope/`, and the
  `<prefix>/<n>-slug` branch convention are project-specific.

## The artifact gates

`feature-builder`, `bug-fixer`, and `triage-review` each open with an `<artifact_contract>` block:
every blocking step writes a file, and the next action is denied until it exists. That is not
decoration — it is the mechanism that keeps the rest of the file from being skipped.

The enforcing hook is **not** in these files. It ships separately as
[`../artifact-gates/`](../artifact-gates/), which generalizes the same engine behind a JSON contract.
`artifact-gates/contracts/full-example.json` reproduces all three families used here.

**Install these commands without that hook and the artifact contracts become prose** — which is
precisely the failure mode they were written to fix. The rationale is worth reading once:
[`../artifact-gates/SKILL.md`](../artifact-gates/SKILL.md).

## Why they read the way they do

Blunt, repetitive, and heavy on "never" — deliberately. Each absolute prohibition traces to a
specific incident: a directive run that skipped eight blocking steps, a dirty working tree that
produced a confident false-green test result, a stacked PR auto-closed by a branch deletion, an
admin merge that bypassed a red check. The prose is defensive because the failures were real.

Where a rule cost a day, the file says so. Keep those notes when you adapt — the reasoning is what
survives translation to another repo, not the specific commands.
