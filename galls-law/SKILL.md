---
name: galls-law
description: Apply Gall's Law when someone proposes building a complex system from scratch, planning a big-bang rewrite, designing a greenfield platform, or debating whether to "just rebuild it the right way." Trigger on phrases like "let's rewrite this properly", "we need to start fresh", "the architecture is too complex to fix", "let's build the perfect system", or any situation where someone wants to leap directly to a sophisticated, full-featured solution. Gall's Law is a powerful antidote to over-engineering and big-bang thinking.
---

# Gall's Law

> "A complex system that works has evolved from a simple system that worked. A complex system built from scratch won't work."
> — John Gall, 1975

## The core idea

You cannot design a working complex system directly. Complex systems that actually work all share the same history: they started as simple systems that worked, and grew from there. Every attempt to build the final, complete, sophisticated system from the start will fail — or produce something that doesn't actually work in production.

This isn't a counsel of despair. It's a guide to how to succeed: **start simple, ship, learn, and evolve.**

## Why complex systems fail when built from scratch

- **Unknown unknowns**: You don't know all the requirements until you've operated a simpler version.
- **Emergent complexity**: Real-world usage surfaces edge cases, failure modes, and interaction effects that no design can anticipate in advance.
- **Integration risk**: Each new component multiplies integration complexity. Building many components at once means many things to go wrong before you have any working baseline.
- **Feedback starvation**: Complex systems take longer to build, so you go longer without the real-world feedback that shapes good design.

## The rewrite trap

This law is most important when teams want to do a "big rewrite." The existing system feels painful, messy, and unmaintainable. The natural impulse is: throw it away and build the right thing.

But the existing system, however ugly, encodes years of learned behavior — edge cases handled, failure modes understood, user expectations embedded. Throwing it away means throwing away that knowledge and rebuilding it from scratch while also building new features.

The result: the rewrite takes 3-5x longer than expected, the new system reproduces all the old bugs plus new ones, and the organization is worse off than if they had incrementally improved the original.

## How to apply it

**For new systems:**
- Identify the simplest version that provides real value and can be used in production.
- Ship that. Get feedback. Learn.
- Grow the system based on what you learn from real usage.

**For rewrites:**
- Ask: can we achieve our goals by evolving the existing system incrementally?
- If rewrite is truly necessary: do it alongside the old system. Run them in parallel. Migrate piece by piece. Never cut over all at once.
- Preserve existing behavior — even the weird bits — until you've understood why they exist.

**For platform/API design:**
- Release a minimal API that covers the core use case.
- Observe how people actually use it.
- Expand from there, adding complexity only where real demand exists.

## The strangler fig pattern

In software, the Strangler Fig Pattern (from Martin Fowler) operationalizes Gall's Law for rewrites: incrementally replace pieces of the old system with the new system, routing traffic progressively until the old system is "strangled" and can be removed. No big bang. Always a working system.

## Key questions to surface

1. Is there a simpler version of this that we could ship and learn from first?
2. If we're doing a rewrite, are we planning to run old and new in parallel?
3. What assumptions are baked into this design that we haven't yet validated with real users?
4. What's the smallest complete thing we could build that gives us real feedback?

