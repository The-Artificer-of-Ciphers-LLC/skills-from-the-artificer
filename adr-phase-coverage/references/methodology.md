# Methodology: why nothing should fall between phases

The checker is small; the ideas behind it are well-established. This file is the "why," with
sources, so the rules don't read as arbitrary.

## 1. Requirements traceability (the matrix)

A **Requirements Traceability Matrix (RTM)** is a table where each row is a requirement/decision and
each column is an artifact type (need → design → implementation → test → verification). It makes
coverage visible at a glance, and its empty cells are the gaps.

Three directions matter (ISO/IEC/IEEE 29148:2018 §5.2.6 calls out bidirectional traceability
explicitly):

- **Forward** (need → design → code → test): catches an **orphaned requirement** — a decision with
  no downstream owner. This is the checker's `orphan-decision`.
- **Backward** (test → code → need): catches an **orphaned artifact** — code/effort with no
  requirement behind it ("gold plating").
- **Bidirectional**: both at once; gaps in either direction become visible.

The checker implements the forward direction at the ADR→phase layer: for every decision, assert at
least one phase owns it. That single assertion is what was missing when ADR-1244 was decomposed.

Sources:
- ReqView — Requirements Traceability Matrix: https://www.reqview.com/blog/requirements-traceability-matrix/
- INCOSE — Traceability across the lifecycle (2024): https://www.incose.org/docs/default-source/working-groups/requirements-wg/monthlymeetings2024/traceability_110524.pdf

## 2. ADR decomposition → phase ownership

An ADR (Michael Nygard, 2011; formalized as MADR) records Context, Decision, Consequences. The
**Consequences** are the decomposition surface: every consequence that needs implementation must map
to exactly one owning phase. MADR adds a **Confirmation** field — "how we'll know this decision was
implemented correctly" — which is precisely an acceptance criterion. Phase-gate practice (Stage-Gate,
PMI) says a phase exits only when the acceptance criteria attached to *its* decisions are met — not
merely when tasks are checked off.

The rule "every decision maps to exactly one owner" is enforceable: fail if any decision is unowned
(orphan) or owned by 2+ phases without an explicit dependency (ambiguity). The checker does both.

Sources:
- Martin Fowler — Architecture Decision Record: https://martinfowler.com/bliki/ArchitectureDecisionRecord.html
- MADR: https://adr.github.io/madr/decisions/0000-use-markdown-architectural-decision-records.html
- Nygard ADR template: https://github.com/joelparkerhenderson/architecture-decision-record

## 3. The horizontal-layering trap (and the keystone check)

Decomposing **horizontally** — "build all of the library layer, then all of the dispatch layer, then
the UI" — produces complete lower layers that are never integrated until a final phase, where the
wiring is discovered to be missing or wrong. The top layer (the user-facing entry point) gets
stranded because every prior phase assumed it would "just connect."

The antidotes are about shape, not effort:

- **Walking skeleton** (Alistair Cockburn): "a tiny implementation of the system that performs a
  small end-to-end function … linking together the main architectural components." Build the
  thinnest possible *full-stack* path first; flesh it out incrementally; the system stays shippable.
- **Tracer bullet** (Hunt & Thomas, *The Pragmatic Programmer*, 1999): fire a real, minimal payload
  through the entire call stack — entry point to storage — to prove the path exists before filling
  it in.

Both share one axiom that the checker encodes as `keystone-unwired`: **"done" must include
"user-reachable."** A user-facing capability is not delivered when its library exists; it is
delivered when a command/route/UI calls that library. So a user-facing decision must be owned by a
phase whose acceptance criteria name the wired surface, not just the function.

Sources:
- Code Climate — Walking Skeleton (quotes Cockburn): https://codeclimate.com/blog/kickstart-your-next-project-with-a-walking-skeleton
- *The Pragmatic Programmer*, Hunt & Thomas (1999), "Tracer Bullets."

## 4. Reachability = coverage (the mechanical analog)

"Exported but never wired" is structurally identical to dead code: a symbol unreachable from any
entry point. Dead-code detectors build a dependency graph from known entry points (CLI arg parser,
HTTP router, event listener) and flag anything unreachable. The same technique flags a command that
was implemented but never registered.

This is the real-code counterpart to the keystone check. After the phase that owns a user-facing
capability ships, a reachability pass should confirm the new export is reachable from a registered
entry point. If your stack has such a tool, wire it as a CI gate:

- **Knip** (JS/TS) — unused files/exports/deps from configured entry points: https://knip.dev/ ·
  https://knip.dev/typescript/unused-exports
- **Go** `deadcode`, **ts-prune** (TS), **Vulture** (Python) — same idea per ecosystem.

The checker in this skill works at the *planning* layer (before code exists). A reachability tool
works at the *code* layer (after). Use both: the plan check prevents the gap; the code check proves
it stayed closed.

## The one-line summary

Forward traceability says *every decision needs an owner*; the keystone rule says *every user-facing
capability needs a phase that wires it*; the dangling-deferral rule says *"deferred to later" is not
ownership until "later" says "mine."* Those three together would have caught ADR-1244.
