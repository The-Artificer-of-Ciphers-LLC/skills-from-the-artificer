---
name: ddd-tactical-review
description: Review or design domain-layer code using Eric Evans's Domain-Driven Design (2003) tactical building blocks: entities, value objects, aggregates, repositories, factories, and domain services. Use when asked "should this be an entity or a value object", "where does this invariant live", "what is the aggregate boundary", "is this model anemic", "review my domain model", or when domain code mixes identity, validation, and persistence in one class. Use it even if DDD is not mentioned. For where one model ends and another begins, use `ddd-strategic-audit` first.
---

# DDD Tactical Review

Tactical DDD is a set of decisions about how to shape the objects inside one bounded context. Settle the context first (`ddd-strategic-audit`); an aggregate drawn across two models is a symptom of a missing boundary. These are design heuristics from a 2003 book, not laws, so state the trade-off when you deviate.

## The decision, per concept

For each domain concept, ask in order:

1. **Does it have an identity that persists as its attributes change?** Two orders with identical contents are still different orders. Yes: **entity**. Compare by identity, give it a stable id, model its lifecycle.
2. **Is it defined entirely by its attributes, interchangeable when equal?** Money, a date range, an address. Yes: **value object**. Prefer immutability and compare by value; replace instead of mutate. Immutability is the standard default, not an absolute rule.
3. **Is it a cluster that must stay consistent as a unit?** Yes: an **aggregate**, with one **root** entity. Outside code holds references to the root only and changes the cluster through it.
4. **Is it an operation that belongs to no single entity or value?** A **domain service**, stateless, named in the ubiquitous language. Use sparingly: if most behavior lives in services, the model is anemic.

Supporting pieces: a **repository** gives collection-like access to aggregate roots (one per aggregate, not per table); a **factory** encapsulates complex creation so an object is never born invalid.

## Aggregate boundary checks

- **Invariant test**: the boundary is the set of objects that must satisfy a rule together within one transaction. Draw it around the invariant, not around the data relationships.
- **Small by default**: a large aggregate means contention and loading cost. Prefer small aggregates and reference others by identity.
- **One aggregate per transaction** is the usual guidance. Needing to change two aggregates atomically suggests the boundary is wrong, or that eventual consistency is acceptable here. Make that an explicit decision.
- **Root-only access**: flag code that reaches inside an aggregate and mutates a child directly.

## Smells to report

- **Anemic model**: entities are bags of getters and setters; the rules live in "manager" or "service" classes.
- **Primitive obsession**: strings and numbers where a value object would carry the validation (email, currency amount, quantity with a unit).
- **Identity confusion**: a value object given an id, or an entity compared by attributes.
- **Leaky persistence**: ORM concerns (lazy proxies, table shapes) dictating the domain shape.
- **Domain code using non-domain words**: names that differ from the ubiquitous language of the context.

Domain events (a fact that happened, published by an aggregate) were added to the vocabulary after the 2003 book. Suggest them when other parts of the system need to react to a change without being coupled to the aggregate, and say they are a later addition.

## Output

```
## Tactical review
Context: <bounded context reviewed>
Classification: <concept — entity / value object / aggregate root / service — reason>
Aggregate boundaries: <root — members — invariant it protects — concerns>
Smells: <smell — file:line — suggested direction>
Trade-offs accepted: <deviations judged reasonable, and why>
```
