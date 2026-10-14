---
name: adr-phase-coverage
description: >-
  Use when a user needs to turn a design doc, ADR, RFC, or spec into a phased implementation plan
  — or verify that an existing phase breakdown actually covers everything the design promised. The
  failure mode this catches: Phase N defers a deliverable to Phase N+1, Phase N+1 never claims it,
  and it ships as promised-but-not-built. Trigger when users say: 'break this into phases', 'turn
  this ADR/RFC into a roadmap', 'is my phase plan complete', 'what slips between phases', 'sanity
  check my phase breakdown', 'audit this epic for coverage gaps', or ask to sequence any architectural
  work into milestones. Also trigger on `/adr-phase-coverage`. Do NOT trigger for: authoring a new
  ADR, updating ADR rationale, writing a PRD, debugging a stuck deploy, or dependency analysis.
---

# ADR phase coverage: nothing falls between phases

## Why this exists

When a design document is sliced into implementation phases, the failure mode is rarely a phase
doing its job badly — it is a deliverable that is **nobody's job**. Each phase has locally-coherent
acceptance criteria, so each can honestly call itself "done," while a cross-cutting deliverable falls
into the seam between two phase boundaries. The classic shape: Phase 4 builds the *library* and says
"the user-facing command lands in Phase 5"; Phase 5's actual scope is something else; the command is
now owned by no one — and the docs cheerfully describe it as shipping. (A real case study is in
`references/anti-patterns.md`.)

This skill makes that gap **mechanically visible** before the plan is locked. You extract a small
trace of decisions↔phases; a deterministic checker does the exhaustive cross-referencing humans get
wrong. It is language-, framework-, and process-agnostic — it reads *your* decisions and *your*
phases, whatever form they take.

The deep "why" — requirements traceability, walking skeletons, vertical slicing, the horizontal-
layering trap — is in `references/methodology.md` (with citations). You don't need it to run the check.

## The four gaps it catches

1. **Orphaned decision** — an ADR decision owned by no phase.
2. **Dangling deferral** — Phase N says "handled in Phase M," but Phase M neither owns nor accepts
   it. The hand-off points into the void.
3. **Multi-owner ambiguity** — two phases both claim a decision; confirm it's a deliberate split, not
   two phases each assuming the other does it.
4. **Keystone unwired** — a *user-facing* capability (a command/route/UI the user invokes) is owned,
   but no owning phase's acceptance criteria wire a user-reachable surface. A library can be fully
   built and still be unreachable; this forces an explicit "user can invoke X" acceptance.

## Workflow

Do this when decomposing a design into phases, or to audit an existing decomposition.

### 1. Gather the two inputs

- **The design**: the ADR / RFC / spec / design doc.
- **The decomposition**: the phase breakdown / roadmap / epic — proposed or existing.

These live wherever your project keeps them (a `docs/adr/*.md`, an RFC in the wiki, a roadmap file, a
tracker epic with sub-issues). See `references/adapting-to-your-repo.md` for how to locate decisions
and phases across common conventions.

### 2. Extract decisions — and separate internal from user-facing

List every decision the design makes (numbered decisions, "Decision"/"Consequences" bullets, or
requirements). Then do the step that prevents the keystone miss: **add a row for every user-facing
capability the design promises** — every "user can …" story, every command/route/screen the design
(or the docs describing it) says will exist. These are often *not* their own decision heading; they
are implied by the decisions, which is exactly why they get orphaned. Mark them `user_facing: true`.

A reliable source is any documentation that describes the feature as shipping: if a doc says a
command/endpoint exists, that is a user-facing capability some phase must own **and wire**.

### 3. Extract each phase's owns / accepts / defers

For each phase capture:
- `owns`: the decision/capability ids this phase is responsible for delivering.
- `accepts`: its acceptance criteria — what is observably TRUE when the phase is done. For a
  user-facing capability, at least one accept must name the **wired surface** ("user can run the
  `foo` command", "route `/x` returns …"), not just "the library exists."
- `defers`: explicit hand-offs `{to: <phaseId>, what: <id or text>}` for anything this phase
  consciously pushes to a later phase. Capture every "see Phase N", "handled later", "deferred to" —
  those are the seams.

### 4. Write the trace file and run the checker

Write a JSON trace mirroring `assets/trace.example.json` (a passing example you can copy). Then:

```bash
python3 scripts/check_coverage.py <your-trace>.json
```

It prints the traceability matrix + findings and **exits 1 if any ERROR exists** (`--json` for a
machine-readable result you can gate in CI). The matrix alone is valuable — a decision row showing
`owning phase(s): — NONE` is the gap, at a glance. (Pure Python 3 stdlib; no dependencies.)

### 5. Fix every ERROR before locking the plan

- **orphan-decision** → assign the decision to a phase's `owns` (with a real acceptance criterion).
- **dangling-deferral** → go to the target phase and add the deferred item to its `owns`/`accepts`,
  by the same id/name. "Deferred to Phase M" is not coverage until Phase M says "I own this."
- **keystone-unwired** → add an acceptance criterion to an owning phase that names the user-reachable
  surface and its wiring ("user can run `X`, dispatched to the Phase-K library"). If no phase wires
  it, you have found the next stranded keystone — schedule the owning work now.
- **multi-owner** (warning) → confirm the split is intentional; otherwise consolidate ownership.

Re-run until the result is ✅. Then the decomposition is safe to lock.

### 6. After the owning phase ships (optional, code-layer)

The checker works at the *planning* layer (before code exists). Its real-code counterpart is a
reachability / dead-code pass: confirm each new exported symbol is reachable from a registered entry
point (CLI parser, HTTP router, event handler). If an export has no such path, the phase built a
layer without wiring it. See `references/methodology.md` §4 for tools per ecosystem (Knip, ts-prune,
Go `deadcode`, Vulture). Use both: the plan check prevents the gap; the code check proves it stayed
closed.

## Authoring the trace from messy docs

The script is deliberately dumb — it does exhaustive set-math, not reading comprehension. *You* do
the reading: pull decisions and user-facing capabilities out of prose, infer the implied commands,
and be honest about `defers`. The leverage is entirely in step 2 (naming the user-facing capabilities
the design never gave their own heading) and step 3 (recording every "handled later" as a real
`defers` edge). Skip those and the checker has nothing to catch.

When unsure whether something is `user_facing`, ask: "is there a sentence anywhere — in the design,
the PRD, or the docs — that a *user* would read as 'I can do X'?" If yes, it's user-facing and needs
a phase that wires it.

## Files

- `scripts/check_coverage.py` — the deterministic checker (Python 3 stdlib; no dependencies).
- `assets/trace.example.json` — a passing trace to copy.
- `assets/trace.adr1244-broken.json` — a real-world gap; run the checker on it to see a live catch.
- `references/methodology.md` — RTM, walking skeleton / tracer bullet, vertical slicing, with sources.
- `references/adapting-to-your-repo.md` — locating decisions & phases across ADR/RFC/roadmap/tracker
  conventions (with one worked example).
- `references/anti-patterns.md` — the catalog, with a full case study end-to-end.
