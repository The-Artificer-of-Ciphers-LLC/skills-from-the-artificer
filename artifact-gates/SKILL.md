---
name: artifact-gates
description: Make workflow steps enforceable by giving each one a file it must produce. Use when an agent skips steps in a long directive, playbook, or slash command despite them being marked MANDATORY/ABSOLUTE/BLOCKING; when writing or reviewing a multi-step workflow that must not be short-circuited; when a review, design, or verification step is being self-reported rather than proven; or when a merge/label/publish action needs a machine-checked precondition instead of a promise. Triggers on "my agent keeps skipping", "it ignored the directive", "how do I enforce this step", "it said it ran the review but didn't", "self-attestation", "gate this action".
---

# Artifact Gates

> A step that produces no artifact cannot be enforced, and will be skipped.

## The observation this is built on

A long directive is read **once**, before any work exists. Then hours of
`tool-result → decide → tool-call` go by with nothing re-presenting it. It stops being *present*.

In one recorded failure, a single run of a workflow directive skipped **eight** steps marked
`[BLOCKING]` — rubber-ducking, adversarial design review, the QA matrix, TDD, code review,
security review, docs, CI preflight — while **every hook-enforced gate in the same session was
obeyed without exception.**

The difference was not severity. Both said ABSOLUTE. The difference was *when the instruction
arrives*: a hook fires at the instant of the action; prose fired hours ago.

And the skipped set was not random. It was exactly the set whose output was **unobservable**:

- TDD partly survived, because it leaves a failing test — a *thing* the next step needs.
- Rubber-ducking did not, because it produces only a better state of mind. **Doing it and claiming
  it were indistinguishable, so the free option won.**

That is the whole mechanism. Not defiance, not ambiguity: an unobservable step is a step where
compliance is optional and non-compliance is undetectable.

## The fix

Give every blocking step a **file it must produce**, and make the **next action require that file**.
Compliance stops depending on disposition and becomes a precondition.

Two things follow, and they are the ones people get wrong:

1. **Invoking the skill is not the point — producing its artifact is.** You already know what
   rubber-ducking *is*. That knowledge is precisely what lets you skip it. The value is that it
   forces a written artifact your in-head version never produces.
2. **The artifact must be expensive to fake and cheap to check.** "I ran the review" is neither.
   A findings list with a disposition per finding is both.

## Designing a contract: three questions

**1. What does this workflow actually skip?** Not what it *could* skip — what it *has* skipped. Go
look. Different workflows fail differently, and copying someone else's artifact set gets you gates
guarding things that were never at risk:

| Workflow shape | What it really skips | Where the gate goes |
|---|---|---|
| Build a feature | The design step — thinking leaves no trace | `src/**` edits require the design doc |
| Fix bugs unattended | Stopping at "PR opened"; dropping the rest of the queue | `gh pr merge` requires a CI record; the next `checkout -b` requires this issue's outcome |
| Triage a tracker | The outward writes — a label with no evidence behind it | the label write requires that issue's diagnosis |

**2. What is the highest-consequence action, and what would have to be true for it to be safe?**
Gate *that*, not the convenient thing. If a `confirmed-bug` label causes an unattended agent to
start writing code without re-verifying, then that label is the most dangerous write in the
workflow — and it should require the diagnosis that justifies it.

**3. Would a reasonable person switch this gate off within a week?** If yes, it is too broad. Scope
it with an **arm file**, so the gate exists only inside a directive run and ordinary work in the
same repo is untouched. **A disabled gate enforces nothing**, so a gate that annoys is strictly
worse than a gate that is narrow.

## What makes an artifact worth demanding

The schema is where the value is. A file whose only requirement is *existence* gets one line of
filler. Demand the shapes that cannot be produced without doing the work:

- **Enumerations.** "One row per input class" — the row *set* is the deliverable. A path nobody
  wrote down is a path nobody implements and nobody tests. This is what catches
  valid-JSON-that-is-not-an-object, the empty-but-present file, the CRLF variant, the *second*
  occurrence when a dedup guard exists.
- **Negative space.** "What legitimately looks like the condition you are detecting, and must NOT
  trigger it." Omitting this is how a truncated-frontmatter check shipped that fired on Markdown
  horizontal rules.
- **Rejected alternatives.** A design with no rejected alternative was not designed — it was the
  first thing that came to mind, written down confidently.
- **Dispositions with proof.** Every finding carries `fixed <sha>` or `not-a-defect: <why>`.
  `not-a-defect` requires the proof, not the assertion.
- **Observed values, not expected ones.** `checks.green` records what `gh pr checks` returned. An
  empty findings array on a non-trivial diff is a claim worth doubting.

**The hook checks existence; only you can make it honest.** Writing the file from your own head
without running the step satisfies the gate and defeats the point. That gap is unavoidable — the
gate's job is to make skipping *visible and deliberate* rather than free and silent.

## Contract format

`.artifact-gate.json` at the repo root. No file → the gate is not adopted → everything passes.

```json
{
  "exempt": ["^\\.claude/"],
  "families": [{
    "name": "feature",
    "dir": ".gsd/phase/{slug}",
    "arm": "00-run.json",
    "disarm": "90-summary.md",
    "gates": [
      { "on": "edit", "paths": ["src/**"], "requires": "40-design.md", "message": "..." },
      { "on": "bash", "match": "git\\s+push", "requires": "60-review.json", "message": "..." }
    ]
  }]
}
```

**Family fields**

| Field | Meaning |
|---|---|
| `dir` | Where artifacts live. `{slug}` = branch name sanitized to `[A-Za-z0-9._-]`; `{branch}` = raw. A `{slug}` in the path makes the family **branch-scoped** — it cannot arm on a detached HEAD. |
| `arm` | The file that turns this family on. Nothing is enforced until it exists. |
| `disarm` | Optional; when present, enforcement stops. **Repo-scoped families need one**, or a finished run keeps gating the repo forever. |
| `gates` | Evaluated in order; first unmet requirement denies. |

**Gate fields**

| Field | Meaning |
|---|---|
| `on` | `"edit"` (Edit/Write/NotebookEdit) or `"bash"`. |
| `paths` | For `on:edit` — globs (`**` spans `/`, `*` does not). |
| `match` | For `on:bash` — regex against the command. |
| `when` / `unless` | Extra regexes the command must / must not match. |
| `capture` | `{pattern, as, hint}` — pull a value out of the command for the artifact name, e.g. the issue number. |
| `requires` / `requiresAnyOf` | Path(s) relative to `dir`; a leading `/` means repo-root-relative. `{vars}` interpolate. |
| `assert` | Content checks — see below. Implies the artifact is JSON. |
| `message` | Shown on denial. **Write it as instructions.** This is the only text the agent sees at the moment it is blocked. |

**Assertions** — for when presence is not enough:

```json
{ "path": "checks.green",  "equals": true,           "else": "A red check is a defect..." }
{ "path": "checks.failing","empty": true,            "else": "..." }
{ "path": "mergeable",     "notEquals": "CONFLICTING","else": "..." }
{ "when": "--admin", "path": "merge.admin_reason",
  "equals": "missing-secondary-reviewer",            "else": "..." }
{ "path": "issues[issue={arm.issue}].state", "in": ["merged","parked"], "else": "..." }
{ "path": "findings_not_fixed",
  "every": { "path": "issue", "integer": true, "min": 1 },  "else": "..." }
```

Predicates: `equals`, `notEquals`, `in`, `notIn`, `empty`, `nonEmpty`, `exists`, `integer`, `min`,
and `every` (recurses one assertion over each element of an array). Paths are dotted with an
array-find form `list[key=value]`. Interpolation sources: `{slug}`, `{branch}`, any `capture`, and
`{arm.<field>}` read from the family's arm file.

`every` exists for a specific failure worth naming. An agent that finds a real problem it cannot fix
will, if you let it, **describe it in the PR body and merge** — the analysis is genuine, the scope
argument is often correct, and the information is destroyed anyway, because a merged PR body is
archive that nobody queries. Giving "I found something I could not fix" exactly one representable
form — a list entry carrying a tracked issue number — closes the gap, because *"too big to fold in"
is a reason to file, never a reason to merely mention.*

This is how a policy that was prose — *"admin-merge may bypass a missing reviewer, never a red CI
or a conflict"* — becomes something the tool enforces rather than something the agent remembers.

## Failure posture

| Situation | Behavior | Why |
|---|---|---|
| Not a git repo, or no contract file | **allow** | Not adopted here. |
| Malformed contract | **deny, loudly** | A silently ignored contract is the exact non-enforcement this exists to prevent, and you would not find out until an unreviewed change shipped. The contract file itself stays editable, so it is always fixable. |
| Armed family, artifact missing | **deny** | The job. |
| Detached HEAD | branch-scoped families skip; repo-scoped still apply | There is no branch to key on. |

Escape hatch: `ARTIFACT_GATE_OVERRIDE=1` as a command prefix or env var, logged to
`.artifact-gate-override.log`. **It is for a human to issue.** An agent that self-issues the
override has reinvented the problem.

## Anti-patterns

- **Gating everything.** A gate that fires on every edit in the repo gets switched off within a
  day. Arm it per-run.
- **Presence-only gates on high-stakes actions.** If merging on a red CI matters, assert
  `checks.green`. An empty file satisfies mere existence.
- **Writing the artifact after the work.** Then it is a summary, and the enumeration — the part
  that catches things — never happens. The design doc is the thing you design *into*.
- **Scolding messages.** The denial text is read by something that is mid-task and needs to know
  what to produce. Lead with the shape, not the disappointment.
- **Treating a denial as a request for human input.** It is not. Write the artifact and continue.
  In an unattended run this misreading is what kills the whole sweep.

## Install

Ships a hook, so it needs one line in `settings.json`. See `README.md` in this directory.
