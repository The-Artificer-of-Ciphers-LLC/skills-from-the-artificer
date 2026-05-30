---
name: zawinskis-law
description: Apply Zawinski's Law when discussing feature creep, scope expansion, the tendency for software to grow beyond its original purpose, or when evaluating whether to add a communication feature to a non-communication product. Trigger on phrases like "should we add messaging?", "every app becomes a platform", "our product is becoming too broad", "why does this tool have so many features?", "feature creep", or any discussion about the pressure on software to expand into adjacent functionality. Zawinski's Law is darkly funny and deeply true.
---

# Zawinski's Law

> "Every program attempts to expand until it can read mail. Those programs which cannot so expand are replaced by ones which can."
> — Jamie Zawinski, ~1995

## The core idea

Software has a natural tendency to expand its feature set over time, acquiring functionality far beyond its original purpose. Zawinski — one of the original Netscape engineers and a key developer of Mozilla — observed this with dark humor: the endpoint of uncontrolled expansion is that every program eventually tries to become an email client (or equivalent communication hub).

The law is both a diagnosis and a warning: feature growth has a logic of its own, and unless deliberately resisted, it tends toward bloat.

## Why software expands

**User requests accumulate.** Users always want more. Every feature request seems individually reasonable. Aggregated over years, they produce a monster.

**Competitive pressure.** If competitor A adds messaging, product managers feel pressure to add messaging. If competitor B adds file sharing, the feature gets queued. Convergence happens.

**Org chart pressure.** Teams need to justify their existence. Teams looking for growth opportunities naturally suggest expanding the product's scope.

**Platform ambitions.** "We don't want to just be a task manager; we want to be a work hub." The aspiration to become a platform drives scope expansion.

**Integration demands.** Users want their tools to talk to each other. Adding an integration often means absorbing the other tool's functionality.

## What Zawinski's Law predicts

Look at the history of major software products:
- **Browsers** now manage passwords, sync files, send notifications, run applications, and show video
- **IDEs** have built-in terminals, version control UIs, debuggers, package managers, and chat integrations
- **Slack** started as team chat and now has video calls, file storage, workflow automation, and app integrations
- **Microsoft Teams** started as a chat tool and absorbed entire enterprise productivity suites
- **iOS** and **Android** started as phone OSes and now manage health, payments, home automation, and more

The expansion is often user-driven and genuinely useful. But it comes with costs.

## The costs of expansion

**Complexity.** Each additional feature adds code, interfaces, maintenance burden, and failure modes.

**Performance.** More features mean more to load, more to process, more to break.

**Focus loss.** Products that try to do everything often do nothing particularly well.

**Security surface area.** More features mean more attack vectors.

**User experience degradation.** Adding features to a UI without removing anything creates clutter and cognitive load.

## How to resist (or manage) it

**Have a clear, opinionated product philosophy.**
What does this product do, and what does it explicitly not do? Products with a strong point of view resist expansion pressure better than those without.

**Say no with a reason.**
"We don't do X" is weaker than "We don't do X because it conflicts with our goal of Y." The latter holds up under pressure; the former doesn't.

**Deprecate as you add.**
Every feature addition should come with a question: what can we remove or simplify to make room? Products that only add never stop growing.

**Distinguish integration from absorption.**
Integrating with an email client is different from becoming one. Prefer APIs and plugins over absorbing adjacent functionality.

**Recognize Zawinski dynamics early.**
When you're considering adding a communication or collaboration feature, ask explicitly: are we on the path Zawinski described? Is this the right path for this product?

## Key questions to surface

1. Does adding this feature move us toward becoming something we didn't intend to be?
2. Is this feature request coming from a few loud users or from a broad, genuine need?
3. What would we need to remove or simplify to make room for this addition?
4. Are we adding this because it genuinely serves our users, or because we're reacting to competitive pressure?
5. What's our explicit scope boundary, and does this feature respect it?

