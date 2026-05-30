---
name: shirky-principle
description: Apply the Shirky Principle when analyzing why legacy systems persist, why incumbents resist disruptive solutions, why organizations seem to make self-defeating decisions, or why a tool or institution appears to be prolonging the problem it was meant to solve. Trigger on phrases like "why do they keep the old system running?", "this tool is creating the problem it's supposed to fix", "why won't they just adopt the better solution?", "why does this bureaucracy exist?", or any situation where an institution's incentives seem misaligned with its stated purpose.
---

# Shirky Principle

> "Institutions will try to preserve the problem to which they are the solution."
> — Clay Shirky, 2010

## The core idea

Organizations — companies, government agencies, industry groups, software tools — are built to solve a problem. Over time, their continued existence depends on the problem continuing to exist. This creates a perverse incentive: the institution has structural reasons to resist, undermine, or slow the permanent resolution of the very problem it was founded to address.

This isn't always conscious or malicious. It's often structural: the people in an institution have careers, salaries, and identities tied to the institution's continued relevance.

## Examples in software and tech

**Legacy vendors:**
A company selling expensive middleware solutions has every incentive to argue that cloud-native alternatives "aren't mature enough," "lack enterprise features," or "present security risks" — even as those alternatives become clearly superior. Killing the problem kills the business.

**Security compliance organizations:**
A compliance framework that provides checklists and certifications has incentives to ensure compliance remains complex and requires annual renewal. Simple, automatically verified security would undermine the certification industry.

**Internal tools teams:**
An internal developer tools team whose purpose was to manage a painful deployment process has subtle incentives to resist adopting off-the-shelf solutions that would eliminate the pain entirely — because eliminating the pain eliminates the team's reason to exist.

**Monitoring and ops tools:**
Tools built around the chaos of microservices have incentives for systems to remain complex and opaque.

## Why this happens

**Organizational identity.** People define themselves by their role. An expert in "legacy system integration" resists eliminating legacy systems.

**Budget and headcount.** A team's budget is often proportional to the size of the problem they manage. Solved problems get smaller budgets.

**Risk aversion.** "Better the devil you know." Proposing that the current approach is obsolete is professionally risky.

**Genuine expertise misapplied.** People deeply expert in a problem domain often have trouble imagining its absence. The problem feels permanent because they've lived in it.

## How to use this principle

**When evaluating vendor recommendations:**
Ask: does this vendor benefit from this problem being hard to solve? Does their proposed solution actually eliminate the problem, or manage it indefinitely?

**When diagnosing organizational resistance:**
When an internal team resists adopting a solution that would eliminate their problem, ask: would solving the problem eliminate the team? That's the Shirky dynamic in action.

**When building products:**
Build toward genuine resolution rather than indefinite management. Products that actually solve their users' problems create loyalty and referrals, even if the user "doesn't need you anymore" for the original problem. Chase the next problem they have.

**When assessing legacy system decisions:**
The people deciding whether to migrate off a legacy system are often the people whose jobs depend on it staying. Factor that into how you interpret their assessments.

## Key questions to surface

1. Does this organization/team/tool benefit from this problem being permanently solved, or from it being permanently managed?
2. Who would lose their role, budget, or relevance if this problem were fully resolved?
3. Is the proposed solution genuinely addressing the problem, or creating a managed dependency on the solution?
4. Are we confusing "we haven't solved this" with "this is unsolvable"?

