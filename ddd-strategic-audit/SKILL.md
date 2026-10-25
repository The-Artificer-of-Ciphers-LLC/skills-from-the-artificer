---
name: ddd-strategic-audit
description: Audit a codebase or design with Domain-Driven Design strategic concepts from Eric Evans (2003): bounded contexts, context maps, and ubiquitous language. Use when asked to find or check module/service boundaries, "what are our bounded contexts", "draw a context map", "why does Customer mean three things", when the same term means different things in different parts of the code, when teams or services step on each other's models, or when extracting a glossary from code and docs. Use it even if DDD is never named. It diagnoses and maps; use `domain-modeling` to then write the GLOSSARY.md and ADRs it recommends.
---

# DDD Strategic Audit

Strategic DDD asks where one consistent model ends and another begins, and how the models relate. This skill finds those edges in an existing codebase and reports them. It extends `domain-modeling`: this skill **discovers and diagnoses**, `domain-modeling` **records** the outcome in `GLOSSARY.md` / `GLOSSARY-MAP.md` and ADRs.

## Core ideas

- **Bounded context**: a boundary inside which each term has exactly one meaning and the model is internally consistent. It bounds both the model and the language.
- **Ubiquitous language**: the vocabulary shared by domain experts and code within one context. The same words appear in conversation, tests, and identifiers.
- **Context map**: how contexts relate and who must adapt to whom. Common relationships: shared kernel, customer/supplier, conformist, anti-corruption layer (ACL), open host service / published language, separate ways.

## Step 1: Extract the language

Gather candidate terms from identifiers, table and column names, API fields, test names, docs, and issue titles. For each frequently used noun, record every distinct meaning found and where (`file:line` or path). A term with two or more meanings is a **context signal**: either an undeclared boundary or a naming accident.

## Step 2: Find the candidate contexts

Evidence that a boundary exists (or should):

- The same term carries different fields, invariants, or lifecycle in different places (`Customer` in billing vs support).
- Translation code already exists: mappers, DTO conversions, adapters between two models.
- Different teams or release cadences own the two sides (see `conways-law`).
- A single model is being stretched with flags and nullable fields to serve several uses.

Evidence against splitting: one meaning throughout, changes always land together, one owner. Do not invent contexts to look thorough.

## Step 3: Map the relationships

For each pair of neighboring contexts, state the direction of dependency, the relationship type above, and where translation happens. Flag:

- **Model leakage**: one context's types used directly inside another, so a change in one forces changes in the other. Suggest an ACL at the receiving edge.
- **Unclear ownership**: two contexts both write the same concept with no declared owner.
- **Missing translation**: the same word crossing a boundary with different meaning and no conversion.

## Boundaries versus deployment

A bounded context is a model boundary, not a deployment unit. A microservice is a natural candidate for one, but the mapping is not one-to-one in either direction, and research did not support any rule that a context must never span services. Do not report "context X is split across services" as a defect by itself. Report it only when the language or invariants genuinely diverge across the split, or when ownership is unclear.

## Output

```
## Strategic audit
Scope: <repo / area>
Terms with multiple meanings: <term — meaning A (where) vs meaning B (where)>
Candidate contexts: <name — evidence — owner if known>
Context map: <A -> B : relationship, translation point>
Problems: <leakage / unclear ownership / missing translation, with file:line>
Confidence: <high/med/low, and what was not examined>
Next: <glossary entries and ADRs to write with `domain-modeling`>
```
