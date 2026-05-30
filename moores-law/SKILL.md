---
name: moores-law
description: Apply Moore's Law when discussing hardware capacity planning, compute cost trends, the feasibility of computationally intensive features, why software that was impractical five years ago is now possible, or the historical arc of what computers can do. Trigger on phrases like "this requires too much compute", "hardware will catch up", "we couldn't do this ten years ago", "cloud compute is getting cheaper", "what can we expect hardware to look like in 5 years?", or any discussion where the trend in computing power is relevant. Also trigger when Moore's Law is cited — because its current status is contested.
---

# Moore's Law

> "The complexity for minimum component costs has increased at a rate of roughly a factor of two per year."
> — Gordon Moore, 1965

## The core idea

Gordon Moore, a co-founder of Intel, observed in 1965 that the number of transistors on an integrated circuit had been doubling roughly every year (later revised to every two years). He predicted this trend would continue.

For roughly five decades, he was right — with enormous consequences for everything in computing. Processing power roughly doubled every two years, while cost per transistor fell. The smartphone in your pocket is more powerful than the most powerful computer on earth from the early 1980s.

## What Moore's Law actually explains

Moore's Law isn't just a trivia fact — it's the engine behind most of what changed in computing since 1965:

- **Software became possible that previously wasn't.** 3D graphics, real-time voice recognition, video streaming, machine learning — all were theoretically understood long before hardware made them practical.
- **Cost curves shaped entire industries.** Cloud computing works because commodity server hardware became cheap enough that renting compute is economical. The economics of storage, bandwidth, and processing have all followed related curves.
- **Developer productivity improved.** Faster hardware meant more tolerant software: higher-level languages, interpreted code, virtual machines — all "wasted" compute that Moore's Law kept providing more of.
- **Planning horizons changed.** Companies could plan product roadmaps around hardware that didn't exist yet, because the trajectory was predictable.

## Is Moore's Law still active?

This is contested:

**The case that it's slowing:**
- Physical limits of silicon are being approached. Transistors are now a few atoms wide.
- The doubling cadence has stretched from 18 months to 2–3 years for leading-edge chips.
- Clock speed increases effectively stopped around 2004. Heat dissipation became the wall.

**The case that it's continuing in new forms:**
- Multi-core processors, GPUs, TPUs, and specialized AI chips provide performance gains that don't come from raw transistor density.
- Advanced packaging (chiplets, 3D stacking) continues to increase effective compute density.
- Cloud scale provides virtually unlimited compute — the relevant metric is price per FLOP, not transistors per chip.

The honest answer: the original formulation has slowed significantly, but the broader trend of expanding computing capability continues — just through different mechanisms.

## Practical implications

**When planning computationally intensive features:**
What's impractical today may be practical in 3–5 years. But don't count on the old doubling cadence. Plan conservatively, and assess which dimension of hardware is the bottleneck (CPU, GPU, memory bandwidth, storage I/O).

**When assessing AI feasibility:**
Modern AI capabilities were made possible not by algorithmic breakthroughs alone, but by decades of Moore's Law followed by GPU scale-out. The economics of training large models are changing rapidly; what required massive infrastructure two years ago may run on a laptop now.

**When arguing "hardware will catch up":**
Be specific. What hardware? On what timeline? The blanket assumption that "compute will keep getting cheaper" is increasingly situation-dependent.

## Key questions to surface

1. Is the performance bottleneck here one that will improve with next-generation hardware?
2. Are we assuming Moore's Law doubling in an area where it no longer applies (clock speed, single-core performance)?
3. What's the price-per-unit-of-compute trajectory for the kind of compute we need (CPU, GPU, memory)?
4. Could this be practical on commodity hardware in 2–3 years? Is it worth designing for that?

