---
name: wirths-law
description: Apply Wirth's Law when discussing software performance, application bloat, why software feels slower despite hardware improvements, resource usage in modern applications, or the relationship between software quality and hardware progress. Trigger on phrases like "why is this app so slow?", "software is getting bloat-ier", "we can just rely on hardware to compensate", "modern apps use too much RAM", or any discussion about the growing resource demands of software relative to hardware capability gains.
---

# Wirth's Law

> "Software gets slower faster than hardware gets faster."
> — Niklaus Wirth, 1995

## The core idea

Moore's Law gives hardware a doubling of capability roughly every two years. Wirth's Law observes a counteracting trend: software grows in size, complexity, and resource consumption at a rate that outpaces — or at least keeps pace with — hardware improvements. The result: users often don't experience the performance gains that Moore's Law would suggest they should.

A more colorful formulation is "Andy and Bill's Law" (from the industry): "What Andy giveth, Bill taketh away" — referring to Intel's Andy Grove and Microsoft's Bill Gates. Every gain in hardware capability gets absorbed by software demanding more.

## Why software grows slower

**Abstraction layers accumulate.** Modern applications run on layer after layer of abstraction: operating system, runtime, virtual machine, framework, library, application. Each layer has overhead. The early app that ran directly on hardware is now wrapped in multiple interpreters and runtimes.

**Developer time is expensive; compute is cheap.** As hardware got cheaper, the economic incentive shifted from "write efficient code" to "write code faster." Higher-level languages, garbage collection, dynamic typing, interpreted execution — all trade runtime performance for developer productivity. Rational choice, but the cumulative effect is significant resource consumption.

**Feature creep.** Software adds features over time. More features mean more code, more memory, more processing. An application from 2005 was much simpler than its 2025 descendant.

**"Hardware will compensate" thinking.** Developers (reasonably) assume users will have faster hardware than they currently do. This justifies shortcuts and inefficiencies that accumulate over generations of software.

**Electron and similar frameworks.** Shipping a full browser engine with every desktop application is a vivid example: a simple notes app now requires hundreds of megabytes and significant RAM because it's built on a web rendering engine.

## Why this matters

**User experience hasn't improved as much as it should.**
Given hardware improvements, software should feel dramatically faster decade over decade. Instead, many users feel like applications are roughly the same speed or slower — because software growth has consumed the gains.

**Battery and thermal costs.**
On mobile and laptops, inefficient software drains batteries and generates heat. The runtime cost of bloat is real and affects portability.

**Accessibility and inclusion.**
Not everyone can afford the latest hardware. Software that demands cutting-edge specs excludes users on older machines. Wirth's Law, unchecked, creates a tiered experience based on hardware wealth.

## What to do about it

**Be deliberate about performance budgets.**
Set explicit limits on startup time, memory usage, and CPU consumption. Measure them. Treat performance regressions as bugs.

**Choose lightweight dependencies.**
Every dependency has overhead. Libraries, frameworks, and runtimes come with cost. Choose based on need, not trend.

**Profile before attributing to hardware.**
If your application is slow, the problem is almost certainly in software before it's in hardware. Profile, find the bottleneck, fix it.

**Respect users on lower-end hardware.**
Design with real-world hardware in mind, not the development machine. Performance testing on older or lower-spec machines reveals what real users experience.

## Key questions to surface

1. How has the memory and CPU usage of this application changed across versions?
2. Are we relying on "users will have better hardware soon" as an excuse for performance problems?
3. What is the performance experience on hardware from three years ago?
4. Are we adding dependencies with significant runtime overhead for functionality we could build more lightly?

