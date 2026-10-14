# Anti-pattern catalog

The decomposition failures this skill exists to catch, each with the smell, the check that catches
it, and the fix.

## 1. The orphaned decision

**Smell.** A decision in the ADR has no phase that claims it. Often invisible because the ADR's own
"implementation phases" list looks complete — but a decision *implies* a deliverable that nobody
scheduled.

**Catch.** `orphan-decision` — decision id appears in `decisions[]` but in no phase's `owns[]`.

**Fix.** Assign it to a phase and give that phase a concrete acceptance criterion for it.

## 2. The dangling deferral ("see Phase N+1") — the ADR-1244 bug

**Smell.** Phase N's notes say "the X piece lands in Phase M." Phase M's real scope turns out to be
something else; it never lists X. X is now owned by no one, but *everyone believes it's covered*
because Phase N "handed it off." Each phase passes its own review.

**Catch.** `dangling-deferral` — a phase's `defers: [{to: M, what: X}]` where phase M neither owns X
nor lists it in `accepts`.

**Fix.** Go to phase M and add X to its `owns`/`accepts` by the same id. A hand-off is only real when
the receiver acknowledges it.

### Case study: a real "capability ecosystem" ADR

A real project's ADR (a plugin/"capability" ecosystem: versioned manifests, a runtime registry, a
URL importer, a trust gate, and a user-facing `… capability install/update/remove/list` management
command) was decomposed into 6 phases. The specifics below are from that project, but the shape is
universal — substitute your own layers.

The ADR was decomposed into 6 phases:

| Phase | Scope |
|---|---|
| 1 | Versioned manifest (D1) |
| 2 | Registry overlay (D2) |
| 3 | Source resolver + ledger (D3, D4) |
| 4 | Trust gate + upgrade — **`installCapability`/`upgradeCapability`/`removeCapability` library** (D5, D6) |
| 5 | Registry-driven dispatch (D7) |
| 6 | Capability matrix + docs (D9) |

Phase 4 built the lifecycle **library** and its acceptance pointed downstream: "the user-facing
`gsd capability install/update/remove/list` command lands in Phase 5." But Phase 5's actual scope
(D7) was registry-driven dispatch of *capability-declared* command families — a different thing. So
the management command — the keystone the whole ecosystem exists to provide — was **nobody's
acceptance criterion across all six phases**, while the docs (`gsd-capability-command.md`, the
how-tos) described it as shipping.

It surfaced only during Phase 6 diátaxis verification (the first step whose job is to check a doc
claim against a real invocable command) — by luck, not design.

Run the checker on the as-shipped trace to see it caught deterministically:

```
$ python3 scripts/check_coverage.py assets/trace.adr1244-broken.json
🔴 orphan-decision  — UX-manage is owned by NO phase.
🔴 dangling-deferral — Phase 4 defers 'UX-manage' to phase 5, but phase 5 neither owns nor accepts it.
```

The corrected decomposition (`assets/trace.example.json`) moves `UX-manage` into Phase 6's `owns`
with an acceptance criterion that names the wired command — and passes.

## 3. The unwired keystone (lib-without-entry-point)

**Smell.** A user-facing capability is technically "owned" — but the owning phase's acceptance is
"the library function exists and is tested." The function ships; no command/route/UI calls it; users
can't reach it. This is the horizontal-layering trap: the bottom layer is complete, the top is
stranded (see `methodology.md` §3).

**Catch.** `keystone-unwired` — a `user_facing: true` decision is owned, but no owning phase's
`accepts` names a user-reachable surface (the checker scans for command/route/UI/wired/"user can
invoke" language).

**Fix.** Add an acceptance criterion that names the surface and the wiring: "user can run `foo`,
dispatched to the Phase-K library." If you can't name a phase that wires it, you've found the gap —
schedule the owning work now. Follow up after that phase ships with a code-layer reachability check
(dead-code / unused-export tool) to prove the entry point stayed wired.

## 4. Multi-owner ambiguity

**Smell.** Two phases both list the same decision. Sometimes intentional (genuinely split work);
sometimes each phase quietly assumes the *other* one does the hard part.

**Catch.** `multi-owner` (warning) — a decision in 2+ phases' `owns[]`.

**Fix.** Confirm the split is deliberate and the phases' acceptance criteria carve the decision into
non-overlapping halves; otherwise consolidate to a single owner.

## 5. Docs describe what no phase builds

**Smell.** The reference docs / how-tos describe a command or behavior as shipping, but no phase owns
delivering it. Docs are written from the ADR's *intent*, so they race ahead of what the phases
actually schedule — and a confident doc masks a missing deliverable.

**Catch (process, not script).** During trace extraction (workflow step 2), treat the documentation
as a source of `user_facing` capabilities: if a doc says `gsd foo` exists, add `foo` as a
`user_facing` decision. It will then surface as `orphan-decision` or `keystone-unwired` if no phase
wires it. This is how a doc-vs-acceptance mismatch becomes a hard finding instead of a surprise.
