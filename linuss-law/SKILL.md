---
name: linuss-law
description: Apply Linus's Law when discussing code review practices, open source contributions, bug finding strategies, security auditing, or the value of having more people look at code. Trigger on phrases like "should we do code reviews?", "we don't have time for reviews", "how do we find bugs faster?", "open source is more secure", "how many reviewers do we need?", or any discussion about the relationship between the number of people examining code and the quality of that code.
---

# Linus's Law

> "Given enough eyeballs, all bugs are shallow."
> — Attributed to Linus Torvalds; popularized by Eric Raymond in *The Cathedral and the Bazaar*, 1999

## The core idea

When enough people examine a codebase, bugs that might seem deeply hidden to any individual reviewer will be found. What's opaque to one person is obvious to another. Different reviewers bring different mental models, experiences, and areas of focus.

This is the argument for both code review and open source development as quality mechanisms.

## Why more eyeballs help

**Cognitive diversity.** Different reviewers think differently. One person might miss an off-by-one error; another will spot it immediately. One reviewer notices the security implication that the author never considered.

**Assumption blindness.** Authors are blind to their own assumptions. You can't see what you took for granted. A reviewer who doesn't share those assumptions sees the gap.

**Familiarity blindness.** After staring at code, you read what you meant to write, not what you wrote. Fresh eyes catch typos in variable names, wrong constants, and logic inversions that authors routinely miss.

**Specialization.** A security engineer reviewing code finds different bugs than a performance engineer or a domain expert. Broader review coverage is richer review.

## Practical implications for teams

**Make code review a non-negotiable practice.**
The research on code review is clear: it is one of the highest-ROI quality practices in software engineering. Even one additional reviewer catches a significant fraction of defects before they reach production.

**Vary your reviewers.**
Don't always have the same person review the same person's code. Cross-domain reviews — someone less familiar with the code — catch different bugs than deep-expert reviews.

**Make it easy to review.**
Small PRs, clear descriptions, linked context. Long PRs get shallow reviews. The review process should reduce friction for reviewers, not just for authors.

**Use open source for security-critical components.**
Closed-source security components can't be audited externally. Open source components under wide use benefit from thousands of eyeballs, including security researchers actively looking for problems. This is why open source cryptographic libraries are generally trusted more than proprietary ones.

**Bake in review time.**
Code review has a time cost, but the cost of not doing it — in bugs shipped, security incidents, maintenance debt — is higher. Treat review time as part of the development process, not as optional overhead.

## The limits of the law

Linus's Law is not unconditional. More eyeballs help, but:
- The eyeballs need to be competent and engaged. Rubber-stamp reviews don't count.
- There are diminishing returns — the 50th reviewer provides much less value than the 2nd.
- Some bugs require deep domain knowledge to find, and aren't helped by more generalist reviewers.
- Complex, interleaved concurrency bugs can be invisible to even expert reviewers.

## Key questions to surface

1. How many people reviewed this code before it shipped?
2. Did reviewers include someone unfamiliar with the implementation, who might spot assumptions the author made?
3. Are our reviews substantive, or are they approvals?
4. For security-critical code: has anyone with security expertise reviewed it specifically?
5. Are our PRs small enough that reviewers can give them the attention they deserve?

