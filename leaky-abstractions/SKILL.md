---
name: leaky-abstractions
description: Apply the Law of Leaky Abstractions when someone is frustrated that a library, framework, or ORM isn't hiding complexity the way it promised, when debugging requires diving into implementation details that "shouldn't matter", or when deciding how much abstraction to build on top of something. Trigger on phrases like "the ORM is doing something weird", "I have to understand how X works even though I'm using library Y", "why do I need to know the underlying SQL?", "this abstraction is breaking down", or any situation where a layer of abstraction has forced someone to understand what it was supposed to hide.
---

# Law of Leaky Abstractions

> "All non-trivial abstractions, to some degree, are leaky."
> — Joel Spolsky, 2002

## The core idea

An abstraction is a simplification: it hides complexity and lets you work at a higher level. TCP hides the complexity of packet routing. An ORM hides the complexity of SQL. A garbage collector hides the complexity of memory management.

But all non-trivial abstractions eventually fail to hide everything. The underlying complexity leaks through — and when it does, you need to understand both the abstraction *and* the thing it was supposed to abstract.

This is not a solvable problem. It is a fundamental property of abstraction.

## Classic examples

**TCP over lossy networks:** TCP presents a "reliable pipe" abstraction. But if the network is slow or lossy, TCP's retry behavior becomes visible through degraded performance. To reason about the slowdown, you need to understand TCP internals.

**ORMs:** SQL ORMs promise you don't need to write SQL. But an ORM that generates a SELECT N+1 query pattern will be slow, and diagnosing it requires understanding the SQL being generated — which the ORM was meant to hide.

**Iterating over a large file in a high-level language:** The abstraction promises "just loop over lines." But if the file is huge and you run out of memory, you need to understand buffering, paging, and how the OS reads files.

**Remote procedure calls (RPCs):** RPC frameworks promise "call a remote function like a local one." But network failures, latency, and partial failure modes mean you can't treat remote calls like local ones.

## What to do about it

**Know your abstractions well enough to debug them.**
When an abstraction fails, you will need to descend. Learn enough about the layer below your abstraction to reason about its behavior when it bleeds through.

**Don't assume abstractions protect you from the underlying complexity.**
A developer using an ORM still benefits from understanding SQL. A developer using a cloud storage service still benefits from understanding object storage semantics. The abstraction is a productivity tool, not a knowledge substitute.

**Build abstractions that fail gracefully and visibly.**
When building your own abstractions, prefer failing loudly with clear error messages over silently misbehaving. Leaks that produce clear errors are much easier to diagnose than leaks that produce subtle corruption.

**Choose your abstraction level deliberately.**
Some contexts call for thin abstractions (close to the metal). Some call for thick ones (far from it). Know why you're at the level you're at, and be ready to drop down when needed.

**Don't be surprised when abstractions break down.**
This is the core teaching: expect leaks. Plan for them. When something "shouldn't be happening" at your level of abstraction, check the level below.

## Key questions to surface

1. What is this abstraction hiding, and what would I need to understand if that thing leaked through?
2. Is the problem I'm debugging at the abstraction level or at the implementation level?
3. Do I understand enough about the layer below this abstraction to diagnose it when it misbehaves?
4. Am I building an abstraction that promises too much, setting up future developers for confusion when it leaks?

