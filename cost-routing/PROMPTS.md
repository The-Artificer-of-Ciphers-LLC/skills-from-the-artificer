# Dispatch Prompt Templates

Three canonical briefs — one per tier. Fill in the bracketed sections and dispatch via the `Agent` tool.

Every dispatch MUST set `model:` explicitly unless the chosen `subagent_type` pins a model in its frontmatter. Inheritance defaults to the parent (opus from opus) and that is almost never what you want.

---

## Scout brief (haiku-scout)

```
TASK: <one sentence — what fact / location / count to return>

CONTEXT (only if it changes what to report): <what the user is trying to accomplish>

WHERE TO LOOK: <directory, file glob, or "the whole repo">

WHAT TO RETURN:
- <field 1, e.g. file paths>
- <field 2, e.g. line numbers>
- <field 3, e.g. surrounding 3 lines>

FORMAT: <bullet list | JSON | one-line answer>

DO NOT: do not edit, do not synthesize, do not propose changes — just report.
```

Dispatch:

```
Agent(
  description: "<5-word summary>",
  subagent_type: "haiku-scout",                 // OR
  subagent_type: "general-purpose", model: "haiku",
  prompt: "<filled brief above>"
)
```

---

## Coder brief (sonnet-coder)

```
TASK: <verb + object — "Add a test for", "Refactor", "Extract">

TARGET:
- file: <absolute path>
- symbol: <function / class / module name>

CHANGE:
- <bullet 1>
- <bullet 2>

CONSTRAINTS:
- preserve: <existing patterns, public APIs, file structure>
- do not introduce: <new deps, new abstractions, surrounding cleanup>

VERIFICATION:
- run: <command — usually a test or typecheck>
- expect: <pass / specific output>

DO NOT:
- do not refactor surrounding code
- do not add error handling for impossible cases
- do not change public APIs
```

Dispatch:

```
Agent(
  description: "<5-word summary>",
  subagent_type: "sonnet-coder",                // OR
  subagent_type: "general-purpose", model: "sonnet",
  prompt: "<filled brief above>"
)
```

---

## Architect brief (stay in opus, or dispatch for second opinion)

Architect work usually **stays in the main context** — opus IS the right tier for ambiguous design, so dispatching just moves the work sideways and adds latency. Dispatch only when you want an isolated second opinion (review, ADR draft from a clean read of the code).

```
QUESTION: <the actual design question, phrased as a question>

WHAT IS DECIDED (not up for debate):
- <constraint 1>
- <constraint 2>

WHAT IS OPEN (axes the dispatch may vary):
- <option dimension 1>
- <option dimension 2>

EVIDENCE NEEDED:
- file paths: <where to read>
- prior decisions: <ADRs, commits, mempalace rooms>
- benchmarks: <if any>

DELIVERABLE: <ADR draft | tradeoff table | recommendation with rationale>
```

Dispatch (only if you want a second read):

```
Agent(
  description: "<5-word summary>",
  subagent_type: "architect",                   // OR
  subagent_type: "general-purpose", model: "opus",
  prompt: "<filled brief above>"
)
```

---

## Anti-templates (what NOT to write)

- ❌ "Look around the codebase and figure out what to do." → No target, no return shape. Scout will burn tokens exploring.
- ❌ "Fix the bug in auth." → No file, no symptom, no verification. Coder will guess.
- ❌ "Read these 12 files and summarize them." → If you already know the 12 files, just route each to scout with a focused question. Bulk reads on opus is the violation.
- ❌ Dispatching `general-purpose` with no `model:` parameter. Always pin.
