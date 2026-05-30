---
name: conways-law
description: Apply Conway's Law when discussing system architecture, team structure, org design, microservices, API ownership, or any situation where communication patterns and software design intersect. Trigger on phrases like "who owns this service?", "our teams keep stepping on each other", "how should we split up this system?", "why does our architecture look like this?", or any question about the relationship between org structure and technical design. Conway's Law is one of the most important—and most underappreciated—forces shaping software systems.
---

# Conway's Law

> "Any organization that designs a system (defined broadly) will produce a design whose structure is a copy of the organization's communication structure."
> — Melvin Conway, 1968

## The core idea

Conway observed that the architecture of a software system will mirror the communication structure of the team that built it. If you have three teams, you'll probably end up with a three-tier system. If two teams don't talk much, the interface between their systems will be poorly defined and brittle. This isn't a choice — it's an emergent property of how organizations work.

This isn't a bug to fix. It's a force to work with.

## Why it matters

- **Org structure drives architecture** more than technical decisions do. The seams in your software tend to appear where the seams in your org appear.
- **Communication overhead is the bottleneck.** Dense, constant communication produces tightly integrated systems. Sparse communication produces loosely coupled systems. Neither is universally good — it depends on what you're building.
- **Migrations are org problems, not just tech problems.** If you want to decouple a monolith into microservices, you probably also need to change how your teams are structured.

## The Inverse Conway Maneuver

Once you accept Conway's Law, you can use it intentionally. The **Inverse Conway Maneuver** is: *design your team structure to match the architecture you want.*

If you want a clean boundary between billing and user management, put those on separate teams with limited shared meetings. If you want tight integration between two services, put those engineers on the same team. The communication structure will do a lot of the architectural work for you.

## How to apply it

**Diagnosing architectural problems:**
- When a system feels messy or tightly coupled in the wrong places, look at the org chart. Who talks to whom? The coupling often matches.
- When interfaces are poorly designed, ask: did the teams that own them ever really collaborate?

**Planning new systems:**
- Before designing the architecture, design the team structure that will build and own it.
- Ask: what communication do we want between these components? Then structure teams to match.

**Making the case for org changes:**
- Conway's Law gives technical leaders a principled argument for restructuring teams: "We can't get this architecture without changing how these teams are organized."

## Key questions to surface

1. What does our org chart look like, and how does our system architecture compare?
2. Where do our inter-team dependencies cause the most friction?
3. If we want a cleaner boundary here, what team changes would support that?
4. Are we trying to fight Conway's Law, or work with it?

## Team Topologies connection

The book *Team Topologies* (Skelton & Pais) operationalizes Conway's Law into team patterns:
- **Stream-aligned teams** own end-to-end delivery of a product/service
- **Platform teams** reduce cognitive load on stream-aligned teams
- **Enabling teams** help others upskill
- **Complicated subsystem teams** own things requiring deep specialization

These patterns are designed to produce good architectures via good communication structures.

