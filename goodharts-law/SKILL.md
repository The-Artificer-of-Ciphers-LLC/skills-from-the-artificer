---
name: goodharts-law
description: Apply Goodhart's Law when designing metrics, OKRs, KPIs, performance reviews, engineering productivity measures, or any system where people are evaluated by a number. Trigger on phrases like "how should we measure this?", "our metrics aren't capturing what we want", "people are gaming the metric", "velocity doesn't feel like a real measure of progress", or any situation where a measurement has become a target. Goodhart's Law is critical for anyone designing incentive systems or interpreting data.
---

# Goodhart's Law

> "When a measure becomes a target, it ceases to be a good measure."
> — Charles Goodhart, 1975 (popularized by Marilyn Strathern)

## The core idea

The moment you tell people they'll be evaluated by a number, they start optimizing for that number — often in ways that are disconnected from, or actively harmful to, the underlying goal the number was meant to represent.

This isn't because people are bad. It's because optimizing for a proxy is easier and more legible than optimizing for the underlying reality.

## Classic examples in software

| What you measure | What gets gamed |
|---|---|
| Lines of code written | Verbose, redundant code |
| Bugs closed | Bugs closed without fixing, or marked as duplicates |
| Velocity (story points) | Points inflated per story |
| Test coverage % | Trivial tests that don't assert anything meaningful |
| PR count | Many tiny, low-value PRs |
| Support tickets resolved | Quick closes without real resolution |
| Time to first response | Auto-responses that count as "responses" |

## Why it happens

A measurement is a proxy for the thing you actually care about. When you turn the proxy into the goal, you create pressure to optimize the proxy — and the path of least resistance is often to do that *without* actually improving the underlying thing.

A good engineering team and a mediocre one can produce the same velocity number. A resolved ticket doesn't mean a happy customer. The number gets decoupled from reality.

## How to defend against it

**Use multiple metrics together, not any one metric in isolation.**
Gaming one metric is easy. Gaming five simultaneously, when they pull in different directions, is much harder. Pair velocity with defect rates. Pair ticket resolution with customer satisfaction.

**Audit the proxy-to-reality relationship regularly.**
Ask: does this metric still represent what we want? Talk to people. Watch their behavior. A metric that's being gamed will show up as suspicious patterns.

**Weight outcomes over outputs.**
Outputs (PRs merged, tickets closed) are easy to count. Outcomes (users retained, errors reduced, feature adoption) are harder to fake. Wherever possible, measure outcomes.

**Make the goal transparent, not just the metric.**
If people understand *why* you're measuring something, they're less likely to optimize the measure at the expense of the goal. "We measure velocity to understand predictability, not to evaluate individual performance" changes how people relate to the number.

**Don't use a metric for evaluation if it's also used for improvement.**
Measurement used purely for learning stays honest. Measurement tied to compensation or promotion gets gamed.

## Key questions to surface

1. If someone wanted to make this metric look good without improving what it represents, how would they do it?
2. Are we seeing suspicious patterns in this data that might indicate gaming?
3. What are the leading indicators (harder to fake) versus lagging indicators (easy to manipulate)?
4. Is this metric driving the behavior we actually want, or just the behavior that looks like what we want?

