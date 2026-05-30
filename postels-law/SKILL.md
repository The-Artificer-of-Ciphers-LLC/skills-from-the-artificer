---
name: postels-law
description: Apply Postel's Law when designing APIs, data interchange formats, network protocols, input validation, or any interface that will receive data from other systems or users. Trigger on phrases like "how strict should our API be?", "should we accept slightly malformed input?", "what should we send vs. accept?", "how do we handle unexpected fields?", or any question about the balance between strictness and permissiveness in an interface design. Postel's Law is a foundational principle of robust interface design, with important modern caveats.
---

# Postel's Law (Robustness Principle)

> "Be conservative in what you send, liberal in what you accept."
> — Jon Postel, RFC 760, 1980

## The core idea

When building systems that communicate with other systems, Postel recommended:
- **Send only well-formed, minimal, correct data.** Don't rely on the other side tolerating your quirks.
- **Accept data that is slightly off.** Be forgiving of minor variations, extra fields, or slightly non-standard inputs from senders.

This principle shaped the early internet. HTML parsers that accepted malformed tags, TCP stacks that handled variations in packet formatting — the early web grew partly because implementors were lenient about what they accepted.

## The case for it

**Real-world senders make mistakes.** Other systems, other developers, other versions of software — they will send you data that is slightly wrong. If you reject anything imperfect, you become brittle and hard to integrate with.

**Interoperability requires tolerance.** When you have many producers of data and many consumers, allowing slightly varied input enables the ecosystem to grow. Strict rejection creates integration friction.

**Graceful degradation.** A system that accepts imperfect input can provide partial value; one that rejects it provides none.

## The modern critique — and important caveats

Postel's Law has critics, and their arguments are strong enough to warrant caution:

**Permissive acceptance hides bugs.** When you silently accept malformed input and make sense of it, the sender never finds out they're sending bad data. You've obscured an error that should have been fixed at the source. Over time this creates "compatibility debt" — everyone depends on your interpretation of malformed data.

**Security vulnerabilities.** Many security exploits rely on parsers accepting inputs that are technically invalid. Permissive HTML parsing has been a rich source of XSS vulnerabilities. Permissive SQL parsing has enabled injection attacks. Being liberal in what you accept often means being liberal in what you execute.

**The "HTML lesson."** The web's legacy of permissive HTML parsing created enormous complexity. Browsers must maintain compatibility with decades of broken HTML, and the parsing rules are extraordinarily complex as a result.

## How to apply it thoughtfully

**Be conservative in what you send — always.**
Don't rely on the other side tolerating your quirks. Send clean, minimal, well-specified data. This is almost universally good advice.

**Be "liberal" carefully and visibly — not silently.**
When accepting imperfect input, prefer to:
- Log what you received and what you did with it
- Return warnings alongside the response
- Normalize input and tell the sender what you normalized
- Reject with a clear, helpful error message rather than silently "fixing" it

**Fail loudly on ambiguous input.**
"Liberal" should not mean "guess silently." Prefer explicit handling over implicit interpretation.

**Apply the principle at different levels differently.**
- Public APIs used by many developers: stricter acceptance, better error messages
- Internal system-to-system: stricter on both sides; control both ends
- User-facing input (forms, natural language): more liberal; users make typos

## Key questions to surface

1. If we accept this slightly malformed input silently, will the sender ever know they're sending bad data?
2. Does being liberal in what we accept here create a security risk?
3. Can we be liberal but visible — accepting the input while logging or warning?
4. Are we being conservative enough in what we send, so we don't impose our quirks on receivers?

