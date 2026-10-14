#!/usr/bin/env python3
"""
check_coverage.py — deterministic ADR-decomposition integrity checker.

Reads a "trace file" (JSON) that maps every decision / user-story the ADR makes to
the phase(s) that OWN it, and the explicit acceptance criteria + cross-phase
hand-offs ("deferrals") of each phase. It then runs the set-math that humans
reliably get wrong when an ADR is sliced into phases, and that caused the
ADR-1244 miss: a user-facing deliverable was deferred from one phase to a "later
phase" that never actually claimed it, so it belonged to nobody.

The LLM does the messy part (reading semi-structured ADR + roadmap markdown and
extracting the trace). This script does the part a model is bad at: exhaustive,
unforgiving cross-referencing. Same division of labor as a generated registry —
extraction is fuzzy, the coverage math must not be.

Usage:
    python3 check_coverage.py <trace.json>           # report + exit 1 on any ERROR
    python3 check_coverage.py <trace.json> --json     # machine-readable findings

Trace schema (see assets/trace.example.json for a filled example):
    {
      "adr": "ADR-1244",
      "decisions": [
        {"id": "D1", "title": "...", "user_facing": false},
        {"id": "UX-install", "title": "User can run `gsd capability install`", "user_facing": true}
      ],
      "phases": [
        {
          "id": "4",
          "name": "Trust gate + upgrade",
          "owns": ["D5", "D6"],
          "accepts": ["installCapability/upgradeCapability library functions exist + tested"],
          "defers": [{"to": "5", "what": "UX-install"}]
        }
      ]
    }

Exit code is 1 if any ERROR-level finding exists, else 0. Wire it as a gate.
"""

import json
import re
import sys

# Words in an acceptance criterion that signal a USER-REACHABLE surface was wired —
# not just a library/seam built. Deliberately broad: the cost of a missed keystone
# (ADR-1244) dwarfs the cost of the author rewording one acceptance line.
ENTRY_POINT_RE = re.compile(
    r"\b("
    r"command|sub-?command|cli|flag|route|endpoint|api|ui|screen|page|button|"
    r"slash[- ]?command|menu|wired|wire|invocab|user can (run|invoke|call|install|use)|"
    r"exposed|surfaced|reachable|entry[- ]?point|handler registered|registered in"
    r")\b",
    re.IGNORECASE,
)


class Finding:
    def __init__(self, level, code, message):
        self.level = level  # "ERROR" | "WARN"
        self.code = code
        self.message = message

    def as_dict(self):
        return {"level": self.level, "code": self.code, "message": self.message}


def _fail(msg):
    print(f"check_coverage: {msg}", file=sys.stderr)
    sys.exit(2)


def load_trace(path):
    try:
        with open(path, "r", encoding="utf-8") as fh:
            data = json.load(fh)
    except FileNotFoundError:
        _fail(f"trace file not found: {path}")
    except json.JSONDecodeError as e:
        _fail(f"trace file is not valid JSON: {e}")
    if not isinstance(data, dict):
        _fail("trace must be a JSON object")
    decisions = data.get("decisions")
    phases = data.get("phases")
    if not isinstance(decisions, list) or not decisions:
        _fail("trace.decisions must be a non-empty array")
    if not isinstance(phases, list) or not phases:
        _fail("trace.phases must be a non-empty array")
    return data


def index_decisions(decisions):
    by_id = {}
    for d in decisions:
        if not isinstance(d, dict) or "id" not in d:
            _fail(f"each decision needs an id: {d!r}")
        did = str(d["id"])
        if did in by_id:
            _fail(f"duplicate decision id: {did}")
        by_id[did] = {
            "id": did,
            "title": d.get("title", ""),
            "user_facing": bool(d.get("user_facing", False)),
        }
    return by_id


def index_phases(phases):
    out = []
    seen = set()
    for p in phases:
        if not isinstance(p, dict) or "id" not in p:
            _fail(f"each phase needs an id: {p!r}")
        pid = str(p["id"])
        if pid in seen:
            _fail(f"duplicate phase id: {pid}")
        seen.add(pid)
        out.append(
            {
                "id": pid,
                "name": p.get("name", ""),
                "owns": [str(x) for x in (p.get("owns") or [])],
                "accepts": [str(x) for x in (p.get("accepts") or [])],
                "defers": p.get("defers") or [],
            }
        )
    return out


def run_checks(trace):
    decisions = index_decisions(trace["decisions"])
    phases = index_phases(trace["phases"])
    findings = []

    phase_by_id = {p["id"]: p for p in phases}
    owners = {}  # decision id -> [phase id, ...]
    for p in phases:
        for did in p["owns"]:
            owners.setdefault(did, []).append(p["id"])

    # CHECK 1 — Orphaned decisions: a decision no phase owns belongs to nobody.
    for did, d in decisions.items():
        if not owners.get(did):
            findings.append(
                Finding(
                    "ERROR",
                    "orphan-decision",
                    f"Decision {did} ({d['title']!r}) is owned by NO phase. "
                    f"Every ADR decision must be the explicit responsibility of exactly one phase.",
                )
            )

    # CHECK 2 — Owns an unknown id: a phase claims a decision the ADR never made.
    for p in phases:
        for did in p["owns"]:
            if did not in decisions:
                findings.append(
                    Finding(
                        "ERROR",
                        "owns-unknown",
                        f"Phase {p['id']} ({p['name']!r}) claims to own {did}, "
                        f"which is not a decision in the trace. Typo, or the decision was dropped?",
                    )
                )

    # CHECK 3 — Multi-owner ambiguity: 2+ phases own the same decision. Allowed only
    # if intentional (split work); flag so a human confirms it isn't accidental double-claim.
    for did, owning in owners.items():
        if len(owning) > 1:
            findings.append(
                Finding(
                    "WARN",
                    "multi-owner",
                    f"Decision {did} is owned by phases {', '.join(owning)}. "
                    f"Confirm this split is intentional and the phases don't each assume the other does it.",
                )
            )

    # CHECK 4 — Dangling deferral (THE ADR-1244 bug): phase N defers work to phase M,
    # but phase M neither owns nor accepts it. The hand-off points into the void.
    for p in phases:
        for dref in p["defers"]:
            if not isinstance(dref, dict):
                _fail(f"phase {p['id']} defers entry must be an object {{to, what}}: {dref!r}")
            to = str(dref.get("to", ""))
            what = str(dref.get("what", ""))
            if not to or not what:
                _fail(f"phase {p['id']} defers entry needs 'to' and 'what': {dref!r}")
            target = phase_by_id.get(to)
            if target is None:
                findings.append(
                    Finding(
                        "ERROR",
                        "defer-to-missing-phase",
                        f"Phase {p['id']} defers {what!r} to phase {to}, which does not exist.",
                    )
                )
                continue
            owned = what in target["owns"]
            accepted = any(what in a or what.lower() in a.lower() for a in target["accepts"])
            if not (owned or accepted):
                findings.append(
                    Finding(
                        "ERROR",
                        "dangling-deferral",
                        f"Phase {p['id']} defers {what!r} to phase {to} ({target['name']!r}), "
                        f"but phase {to} neither owns nor lists it in its acceptance criteria. "
                        f"This is the seam a deliverable falls through — name it explicitly in phase {to}.",
                    )
                )

    # CHECK 5 — Uncovered user-facing keystone (lib-without-entry-point smell):
    # a user-facing capability must be owned by a phase whose acceptance criteria
    # name a user-reachable surface (a command/route/UI), not merely a library.
    for did, d in decisions.items():
        if not d["user_facing"]:
            continue
        owning = owners.get(did, [])
        if not owning:
            continue  # already reported as orphan
        wired = False
        for pid in owning:
            for a in phase_by_id[pid]["accepts"]:
                if ENTRY_POINT_RE.search(a):
                    wired = True
                    break
            if wired:
                break
        if not wired:
            findings.append(
                Finding(
                    "ERROR",
                    "keystone-unwired",
                    f"User-facing capability {did} ({d['title']!r}) is owned by phase(s) "
                    f"{', '.join(owning)}, but no owning phase has an acceptance criterion that "
                    f"wires a user-reachable surface (command / route / UI). A library can be built "
                    f"and still be unreachable — add an explicit 'user can invoke X' acceptance item.",
                )
            )

    return decisions, phases, owners, findings


def build_matrix(decisions, owners):
    lines = ["| decision | user-facing | owning phase(s) |", "|---|---|---|"]
    for did, d in decisions.items():
        owning = owners.get(did, [])
        owned = ", ".join(owning) if owning else "— **NONE**"
        uf = "yes" if d["user_facing"] else "no"
        lines.append(f"| `{did}` {d['title']} | {uf} | {owned} |")
    return "\n".join(lines)


def main(argv):
    args = [a for a in argv[1:] if not a.startswith("--")]
    as_json = "--json" in argv
    if len(args) != 1:
        _fail("usage: check_coverage.py <trace.json> [--json]")
    trace = load_trace(args[0])
    decisions, phases, owners, findings = run_checks(trace)

    errors = [f for f in findings if f.level == "ERROR"]
    warns = [f for f in findings if f.level == "WARN"]

    if as_json:
        print(json.dumps({
            "adr": trace.get("adr", ""),
            "decision_count": len(decisions),
            "phase_count": len(phases),
            "errors": [f.as_dict() for f in errors],
            "warnings": [f.as_dict() for f in warns],
            "ok": not errors,
        }, indent=2))
        return 1 if errors else 0

    adr = trace.get("adr", "(unnamed ADR)")
    print(f"# ADR decomposition coverage — {adr}\n")
    print(f"{len(decisions)} decisions across {len(phases)} phases.\n")
    print("## Traceability matrix\n")
    print(build_matrix(decisions, owners))
    print()
    if not findings:
        print("## Result\n\n✅ No gaps. Every decision is owned; every hand-off lands; "
              "every user-facing capability has a phase that wires its entry point.")
        return 0
    print("## Findings\n")
    for f in errors:
        print(f"- 🔴 **{f.code}** — {f.message}")
    for f in warns:
        print(f"- 🟡 **{f.code}** — {f.message}")
    print()
    print(f"## Result\n\n{'🔴 ' + str(len(errors)) + ' ERROR(s)' if errors else '✅ no errors'}"
          f", {len(warns)} warning(s). "
          f"{'Fix the errors before locking the roadmap.' if errors else ''}")
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
