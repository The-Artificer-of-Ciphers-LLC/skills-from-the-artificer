# Adapting to your repo — locating decisions & phases

The checker is convention-agnostic: it reads a small JSON trace you author, not your files directly.
The skill's work is extracting that trace from however *your* project records decisions and phases.
This guide maps the two inputs onto common conventions.

## Input 1 — the design (where decisions live)

You need the list of **decisions** the design makes, plus the **user-facing capabilities** it
promises. Across conventions:

| Convention | Where decisions are | How they're labeled |
|---|---|---|
| **Nygard ADR** | one decision per file; the "Decision" + "Consequences" sections | file title; consequences as bullets |
| **MADR** | "Decision Drivers", "Considered Options", "Decision Outcome", "Confirmation" | the "Confirmation" line is the acceptance criterion |
| **Multi-decision ADR** | one file, several decisions | headings like `## D1 — …`, `### Decision 3` |
| **RFC** | "Proposal" / "Detailed design" sections | numbered sub-sections or requirement IDs |
| **PRD / spec** | "Requirements" / user stories | `REQ-…` ids, "As a user I can …" stories |

Whatever the form, normalize each to a trace `decisions[]` row with a stable `id` (reuse the doc's
own `D1`/`REQ-…` ids when present; invent readable ones like `UX-install` otherwise) and a `title`.

**The user-facing pass (do not skip).** Re-read the design and its companion docs for anything a
*user* invokes or sees — commands, flags, routes/endpoints, screens, CLI/SDK calls. Add each as its
own `decisions[]` row with `user_facing: true`, even if the design never gave it a heading. These
implied capabilities are the ones that get orphaned. Treat published documentation as a source of
truth here: a doc that says `tool foo install` exists is asserting a user-facing capability that some
phase must own and wire.

## Input 2 — the decomposition (where phases live)

You need each phase's `owns` / `accepts` / `defers`. Across conventions:

| Convention | Where phases live | owns / accepts / defers come from |
|---|---|---|
| **Roadmap file** (`ROADMAP.md`, `PLAN.md`) | "Phase N: …" sections | "Requirements:" → `owns`; "Success criteria" → `accepts`; "Depends on / later" → `defers` |
| **Tracker epic** | epic + sub-issues / milestones | each sub-issue's scope → `owns`; its acceptance checklist → `accepts`; "follow-up" / "tracked in #X" → `defers` |
| **The ADR's own plan** | an "Implementation phases" / "Rollout" section | the numbered phase list → `owns`; prose "later" notes → `defers` |
| **Project boards** | columns / swimlanes per phase | card titles → `owns`; card acceptance → `accepts` |

Capture `defers` aggressively: every "see Phase N", "handled in the next milestone", "deferred to",
"tracked separately", or a parking-lot/"out of scope for now" note is a hand-off edge. Each must land
in a named phase that `owns` or `accepts` it, or it's a dangling deferral.

## Requirement IDs

If the project uses stable requirement IDs (`REQ-AUTH-01`, `FEED-03`, `D7`), use them as the trace
`id`s — it keeps the matrix legible and lets you cross-check against existing per-plan coverage tools.
If it doesn't, invent ids; the only rule is that the same id is used consistently in `decisions[]`,
`owns`, and any `defers.what` that points at it.

## If your process already has coverage checks

Many planning systems verify that every requirement reaches *a plan* and that implemented code is
*wired across phases*. Those run **downstream** — after the roadmap exists, or after code is written.
They trust the requirement set they're given. This skill runs **upstream**: on the design's decisions
themselves, before the plan is locked, catching the decision (or user-facing capability) that never
became a phase's responsibility in the first place — which downstream checks structurally cannot see,
because to them it simply doesn't exist. Run this first; keep the downstream checks too.

## Worked example (one convention)

In a repo that keeps multi-decision ADRs as `docs/adr/NNNN-*.md` with `### D1 — …` headings and a
roadmap of `### Phase N` sections with "Success Criteria" lists:

1. Grep the ADR for `^### D\d` → the `decisions[]` (internal).
2. Grep the ADR + the feature's reference docs for promised commands/routes/screens → add
   `user_facing: true` rows.
3. For each `### Phase N`: its requirement list → `owns`; its "Success Criteria" → `accepts`; any
   "deferred to Phase M" prose → a `defers` entry.
4. Write the trace, run `check_coverage.py`, fix every ERROR, re-run.

The same four steps apply to an RFC + tracker-epic, a PRD + project board, etc. — only the *where*
changes, never the *what*.
