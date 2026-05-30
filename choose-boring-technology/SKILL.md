---
name: choose-boring-technology
description: Apply the "Choose Boring Technology" principle when evaluating tech stack decisions, adding new tools or frameworks, proposing a rewrite, or debating between a familiar vs. cutting-edge approach. Use this skill whenever someone is considering adopting a new library, language, database, or service—even if they frame it as "should we use X?", "what tech should we pick?", or "is it worth trying Y?". This skill helps teams resist shiny-object syndrome and make grounded technology choices.
---

# Choose Boring Technology

> "Consider how you would solve your immediate problem without adding anything new."
> — Dan McKinley, 2015

## The core idea

McKinley's essay argues that every new technology you adopt is a "complexity token" you spend — and you only have a limited budget. Novel technologies bring unknown failure modes, thin internal expertise, and higher cognitive load. **Boring** technologies (well-understood, widely deployed, battle-tested) have predictable failure modes, rich documentation, broad community knowledge, and don't surprise you at 2am.

The law doesn't say "never adopt new tech." It says: be deliberate about when you do, and have a high bar.

## How to apply it

**Step 1 — Solve the problem with what you have first.**
Before evaluating any new option, ask: can you solve this with something already in your stack? A Postgres table instead of a new cache? A cron job instead of a message queue? The answer is often yes, and the boring solution is usually good enough longer than you expect.

**Step 2 — Budget your complexity tokens.**
Assess how many unfamiliar technologies are already in flight on the team. If you're already running Kubernetes, a new microservices framework, and a new language, adding another unknown is risky. Teams have limited capacity to learn and operate things reliably.

**Step 3 — Score the tradeoff honestly.**
Ask these questions about the proposed tech:
- Does anyone on the team have real production experience with it?
- What does failure look like, and do we know how to recover?
- Is there a boring alternative that covers 80% of the use case?
- What's the operational cost (monitoring, on-call, upgrades)?
- Are we adopting this because it actually solves our problem, or because it's interesting?

**Step 4 — Prefer addition over replacement.**
If you do adopt something new, keep the old thing running where it already works. Don't rip and replace — introduce incrementally and let the new thing earn its footprint.

## When boring is the right call (almost always)

- Startups and small teams: operational complexity kills small teams. Default to managed services and proven stacks.
- Under time pressure: debugging unknown tech under deadline is brutal.
- Core infrastructure: databases, queues, auth — these need to be boring.

## When new tech is worth it

- The boring alternative genuinely can't do the job (not just "does it less elegantly").
- You have team members with real production experience in it.
- The expected lifespan of this system justifies the learning investment.
- You've prototyped it and it behaved predictably under realistic conditions.

## Key questions to surface

When helping someone with a tech decision, work through:
1. What's the actual problem we're solving?
2. What's the simplest thing that could possibly work?
3. What do we already have that we could stretch?
4. If we adopt this, who will be on call when it breaks at midnight?
5. Are we choosing this for us, or for the engineers who come after us?

