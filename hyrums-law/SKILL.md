---
name: hyrums-law
description: Apply Hyrum's Law when discussing API design, backward compatibility, deprecation, versioning, or any situation where a system has enough users that its observable behavior—not just its documented interface—has become depended upon. Trigger on phrases like "can we change this behavior?", "is this a breaking change?", "users are depending on a bug we fixed", "we want to deprecate this", or any discussion about evolving a public or widely-used API. Hyrum's Law is essential reading for anyone building platforms, libraries, or APIs.
---

# Hyrum's Law

> "With a sufficient number of users of an API, it does not matter what you promise in the contract: all observable behaviors of your system will be depended on by somebody."
> — Hyrum Wright, 2012

## The core idea

If enough people use your API, every behavior — documented or not, intentional or not, even bugs — will be depended upon by someone. Your documented interface is not the real interface. The real interface is everything observable: response times, error message text, ordering of results, whitespace in JSON output, HTTP headers, memory usage patterns.

This has a humbling implication: **as an API grows, your ability to change anything without breaking someone approaches zero.**

## Why it matters

When you're building for a small set of users, you can coordinate changes. When your API is used by thousands of developers, you can't know what they've built. Some of them will have:
- Parsed your error messages with regex
- Depended on the alphabetical ordering of a field that you return in hash order
- Built retry logic around your specific timeout behavior
- Cached responses based on headers you didn't intend to be cacheable
- Worked around a bug in a way that breaks when you fix the bug

## Real-world examples

- Python 2→3 migration: even behavior never in the spec was depended on
- Google's web infrastructure: engineers found users depending on specific memory layouts and response ordering
- Any bug fix that "breaks" existing users who had worked around it

## How to design defensively

**Minimize observable surface area.**
The less you expose, the less gets depended on. Keep internals genuinely internal. Be deliberate about what is observable versus what is an implementation detail.

**Version your APIs.**
Versioning is the escape hatch. When you need to change behavior, version the API and give users a migration path. `/v1/` and `/v2/` coexist; users migrate on their timeline.

**Deprecate slowly and loudly.**
Give users long warning periods before removing or changing behavior. Emit deprecation warnings in responses. Document the change prominently. Provide migration guides.

**Test your actual observable behavior, not just your documented interface.**
If you have a contract you want to preserve, write tests that encode it explicitly — including behaviors you consider "implementation details" that you don't want locked in.

**Be careful about "fixing" bugs in stable APIs.**
A bug that has been in production long enough is effectively a feature. Evaluate whether fixing it is worth breaking users who depend on the buggy behavior. Sometimes the answer is yes; often it's "add a new endpoint that behaves correctly."

**Document what is stable and what is not.**
Explicitly marking something as "internal," "unstable," or "do not depend on this" doesn't prevent all dependence — but it gives you standing to break it later without feeling you've betrayed your users.

## Key questions to surface

1. If we change this behavior, who might be depending on it in ways we can't see?
2. Have we been in production long enough that this "implementation detail" is now effectively a contract?
3. Do we have a versioning strategy so we can evolve this without breaking existing users?
4. What is our deprecation process, and how much lead time are we giving users?
5. Are we treating this as a "private" behavior that users should never have depended on — and if so, did we ever make that clear?

