---
name: kernighans-law
description: Apply Kernighan's Law when reviewing code, discussing code complexity, advising on coding style, or coaching developers on how to write maintainable code. Trigger on phrases like "this clever solution", "I wrote a really elegant piece of code", "look at this one-liner", "why is this code hard to debug?", or any situation involving the trade-off between cleverness and clarity. Also trigger when someone is struggling to debug complex code or asking whether a clever approach is worth the cost.
---

# Kernighan's Law

> "Everyone knows that debugging is twice as hard as writing a program in the first place. So if you're as clever as you can be when you write it, how will you ever debug it?"
> — Brian Kernighan, 1974 (The Elements of Programming Style)

## The core idea

Writing clever code feels good. It demonstrates mastery and intelligence. But if you write code at the absolute limit of your ability to understand, you have no margin left to debug it when something goes wrong — and something will always go wrong.

The smarter move is to write code that is simpler than you're capable of. Leave yourself headroom.

## What "clever" code actually costs

**Time to understand:** Code that is dense, abstract, or uses advanced tricks is hard to read — for you, six months later, and especially for colleagues.

**Debugging difficulty:** When clever code breaks, the same cleverness that makes it compact also makes the failure mode opaque. You have to fully reconstruct the intent before you can find the bug.

**Review friction:** Code reviewers who don't immediately understand code are slower and less thorough. Bugs slip through.

**Maintenance burden:** Anyone who modifies the code must first understand it. Clever code has a high "understanding tax" that gets paid over and over.

**Onboarding cost:** New team members struggle with overly sophisticated patterns. Institutional knowledge doesn't transfer.

## What to prefer instead

**Explicit over implicit.** If the reader has to mentally execute the code to understand what it does, it's too implicit. Prefer code that says what it means.

**Verbose over terse when it aids clarity.** A 10-line version that you can read in 30 seconds is faster to work with than a 2-line version that takes 5 minutes to parse.

**Boring over brilliant.** Use standard patterns that readers recognize instantly. Reserve unusual approaches for cases where they provide genuine, substantial benefits.

**Comments that explain why, not what.** When cleverness is unavoidable, comment the *reasoning* — not a restatement of the code. "We use XOR swap here to avoid an allocation in the hot path" is useful. "This swaps a and b using XOR" is not.

## When cleverness is worth it

Kernighan's Law is not a blanket prohibition on sophisticated code. It's a warning to be honest about the costs. Cleverness is justified when:
- It provides substantial, measurable performance gains in a proven bottleneck
- The clever pattern is well-known in your domain (bit manipulation in C, generator expressions in Python — context matters)
- It is isolated, well-commented, and unit-tested
- The team has agreed it's worth the complexity budget

## The debugging corollary

When you're debugging code you wrote: **if you can barely follow your own logic, that's the bug.** The fix often isn't to trace the execution more carefully — it's to rewrite the code more simply, at which point the bug becomes obvious.

## Key questions to surface

1. If you were looking at this code for the first time with no context, how long would it take to understand?
2. When this breaks at 2am, will you be able to debug it quickly?
3. Can you explain this code to a teammate in under two minutes?
4. Is the cleverness here buying something concrete (performance, correctness), or is it just satisfying?

